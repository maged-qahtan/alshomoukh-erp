-- Alshomoukh ERP / PostgreSQL
-- Initial single-company, accrual-basis accounting schema.
begin;

create extension if not exists pgcrypto;

create type account_type as enum ('asset', 'liability', 'equity', 'revenue', 'expense');
create type journal_status as enum ('draft', 'posted', 'reversed');
create type fiscal_period_status as enum ('open', 'closed');

create table companies (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  display_name text not null,
  base_currency char(3) not null default 'SAR',
  fiscal_year_start_month smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  created_at timestamptz not null default now()
);

create table app_users (
  id uuid primary key default gen_random_uuid(),
  auth_subject text not null unique,
  full_name text not null,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ar text not null,
  name_en text not null
);

create table user_roles (
  user_id uuid not null references app_users(id),
  role_id uuid not null references roles(id),
  primary key (user_id, role_id)
);

create table fiscal_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  status fiscal_period_status not null default 'open',
  closed_at timestamptz,
  closed_by uuid references app_users(id),
  check (ends_on >= starts_on),
  unique (company_id, name),
  unique (company_id, id),
  unique (company_id, starts_on, ends_on)
);

create table accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  parent_id uuid,
  code varchar(30) not null,
  name_ar text not null,
  name_en text not null,
  type account_type not null,
  is_posting boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, code),
  unique (company_id, id),
  foreign key (company_id, parent_id) references accounts(company_id, id),
  check (parent_id is null or parent_id <> id)
);

create table cost_centers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  code varchar(30) not null,
  name_ar text not null,
  name_en text not null,
  is_active boolean not null default true,
  unique (company_id, code),
  unique (company_id, id)
);

create table parties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  party_type text not null check (party_type in ('customer', 'supplier', 'both')),
  code varchar(30) not null,
  name text not null,
  tax_number text,
  phone text,
  email text,
  is_active boolean not null default true,
  unique (company_id, code),
  unique (company_id, id)
);

create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  fiscal_period_id uuid not null,
  entry_number bigint generated always as identity,
  entry_date date not null,
  description text not null,
  reference text,
  source_type text not null default 'manual',
  source_id uuid,
  status journal_status not null default 'draft',
  currency_code char(3) not null default 'SAR',
  created_by uuid references app_users(id),
  posted_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  reversed_entry_id uuid references journal_entries(id),
  unique (company_id, entry_number),
  unique (company_id, id),
  foreign key (company_id, fiscal_period_id) references fiscal_periods(company_id, id)
);

create table journal_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  journal_entry_id uuid not null,
  line_number integer not null check (line_number > 0),
  account_id uuid not null,
  description text,
  party_id uuid,
  cost_center_id uuid,
  debit numeric(20, 2) not null default 0 check (debit >= 0),
  credit numeric(20, 2) not null default 0 check (credit >= 0),
  foreign key (company_id, journal_entry_id) references journal_entries(company_id, id),
  foreign key (company_id, account_id) references accounts(company_id, id),
  foreign key (company_id, party_id) references parties(company_id, id),
  foreign key (company_id, cost_center_id) references cost_centers(company_id, id),
  unique (journal_entry_id, line_number),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);

create index journal_entries_company_date_idx on journal_entries(company_id, entry_date);
create index journal_entries_status_idx on journal_entries(company_id, status);
create index journal_lines_account_idx on journal_lines(company_id, account_id);

create table audit_logs (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id),
  actor_user_id uuid references app_users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);


-- Only the posting procedure may move a draft entry to posted.
create or replace function guard_journal_entry_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('posted', 'reversed') then
      raise exception 'Posted journal entries cannot be deleted.';
    end if;
    return old;
  end if;

  if old.status in ('posted', 'reversed') then
    raise exception 'Posted journal entries are immutable.';
  end if;

  if old.status = 'draft' and new.status <> 'draft'
     and not (new.status = 'posted' and current_setting('app.posting_entry_id', true) = old.id::text) then
    raise exception 'Draft status changes must use the controlled posting procedure.';
  end if;
  return new;
end;
$;

create trigger journal_entries_guard
before update or delete on journal_entries
for each row execute function guard_journal_entry_mutation();

-- Posted journal entries are immutable. Corrections must use reversal/adjustment entries.
create or replace function prevent_posted_journal_mutation()
returns trigger language plpgsql as $
declare
  target_entry_id uuid;
  current_status journal_status;
begin
  target_entry_id := coalesce(new.journal_entry_id, old.journal_entry_id);
  select status into current_status from journal_entries where id = target_entry_id for update;
  if current_status in ('posted', 'reversed') then
    raise exception 'Posted journal lines are immutable; create a reversal or adjustment.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger journal_lines_immutable
before insert or update or delete on journal_lines
for each row execute function prevent_posted_journal_mutation();

create or replace function post_journal_entry(p_entry_id uuid, p_user_id uuid)
returns void language plpgsql as $
declare
  entry_row journal_entries%rowtype;
  debit_total numeric(20,2);
  credit_total numeric(20,2);
  line_count integer;
  period_row fiscal_periods%rowtype;
begin
  select * into entry_row from journal_entries where id = p_entry_id for update;
  if not found then raise exception 'Journal entry not found.'; end if;
  if entry_row.status <> 'draft' then raise exception 'Only draft entries can be posted.'; end if;

  select * into period_row from fiscal_periods
   where id = entry_row.fiscal_period_id and company_id = entry_row.company_id for update;
  if not found then raise exception 'Fiscal period not found.'; end if;
  if period_row.status <> 'open' then raise exception 'Fiscal period is closed.'; end if;
  if entry_row.entry_date < period_row.starts_on or entry_row.entry_date > period_row.ends_on then
    raise exception 'Entry date is outside the selected fiscal period.';
  end if;

  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into line_count, debit_total, credit_total
    from journal_lines where journal_entry_id = p_entry_id;

  if line_count < 2 then raise exception 'A journal entry needs at least two lines.'; end if;
  if debit_total <= 0 or credit_total <= 0 or debit_total <> credit_total then
    raise exception 'Journal entry is not balanced. Debit must equal credit.';
  end if;

  if exists (
    select 1 from journal_lines l join accounts a on a.id = l.account_id
     where l.journal_entry_id = p_entry_id and (not a.is_active or not a.is_posting)
  ) then raise exception 'An account is inactive or is a non-posting parent account.'; end if;

  perform set_config('app.posting_entry_id', p_entry_id::text, true);
  update journal_entries
     set status = 'posted', posted_by = p_user_id, posted_at = now()
   where id = p_entry_id;
  perform set_config('app.posting_entry_id', '', true);

  insert into audit_logs(company_id, actor_user_id, action, entity_type, entity_id, after_data)
  values (entry_row.company_id, p_user_id, 'journal.posted', 'journal_entry', p_entry_id,
          jsonb_build_object('debit_total', debit_total, 'credit_total', credit_total));
end;
$$;

insert into roles(code, name_ar, name_en) values
 ('owner', 'مالك النظام', 'System owner'),
 ('accountant', 'محاسب', 'Accountant'),
 ('reviewer', 'مراجع', 'Reviewer'),
 ('viewer', 'قارئ التقارير', 'Reports viewer')
on conflict (code) do nothing;

commit;
