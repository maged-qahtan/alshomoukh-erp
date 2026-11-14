-- Fix row-lock checks that were hidden by read-only fiscal-period RLS policies.
begin;
create or replace function post_journal_entry(p_entry_id uuid, p_user_id uuid)
returns void language plpgsql as $$
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
   where id = entry_row.fiscal_period_id and company_id = entry_row.company_id;
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

create or replace function reverse_journal_entry(
  p_entry_id uuid,
  p_reversal_date date,
  p_fiscal_period_id uuid,
  p_user_id uuid
) returns uuid language plpgsql as $$
declare
  original journal_entries%rowtype;
  reversal_id uuid;
  target_period fiscal_periods%rowtype;
begin
  select * into original from journal_entries where id = p_entry_id for update;
  if not found then raise exception 'Original journal entry not found.'; end if;
  if original.status <> 'posted' then raise exception 'Only posted entries can be reversed.'; end if;

  select * into target_period from fiscal_periods
   where id = p_fiscal_period_id and company_id = original.company_id;
  if not found then raise exception 'Reversal fiscal period not found.'; end if;
  if target_period.status <> 'open' then raise exception 'Reversal fiscal period is closed.'; end if;
  if p_reversal_date < target_period.starts_on or p_reversal_date > target_period.ends_on then
    raise exception 'Reversal date is outside the selected fiscal period.';
  end if;

  insert into journal_entries(
    company_id, fiscal_period_id, entry_date, description, reference,
    source_type, source_id, currency_code, created_by
  ) values (
    original.company_id, p_fiscal_period_id, p_reversal_date,
    'عكس القيد رقم ' || original.entry_number || ' - ' || original.description,
    original.reference, 'reversal', original.id, original.currency_code, p_user_id
  ) returning id into reversal_id;

  insert into journal_lines(
    company_id, journal_entry_id, line_number, account_id, description,
    party_id, cost_center_id, debit, credit
  )
  select company_id, reversal_id, line_number, account_id, description,
         party_id, cost_center_id, credit, debit
    from journal_lines
   where journal_entry_id = original.id
   order by line_number;

  perform post_journal_entry(reversal_id, p_user_id);

  perform set_config('app.reversing_entry_id', original.id::text, true);
  update journal_entries
     set status = 'reversed', reversed_entry_id = reversal_id
   where id = original.id;
  perform set_config('app.reversing_entry_id', '', true);

  insert into audit_logs(company_id, actor_user_id, action, entity_type, entity_id, after_data)
  values (original.company_id, p_user_id, 'journal.reversed', 'journal_entry', original.id,
          jsonb_build_object('reversal_entry_id', reversal_id));
  return reversal_id;
end;
$$;

create or replace function public.save_draft_journal_entry(
  p_company_id uuid,
  p_fiscal_period_id uuid,
  p_entry_date date,
  p_description text,
  p_lines jsonb
) returns uuid
language plpgsql
set search_path = pg_catalog, public, auth
as $$
declare
  v_user_id uuid;
  v_entry_id uuid;
  v_period public.fiscal_periods%rowtype;
  v_line_count integer;
  v_debit numeric(20,2);
  v_credit numeric(20,2);
begin
  v_user_id := public.current_app_user_id();
  if v_user_id is null then raise exception 'Authenticated application profile is required.'; end if;
  if not public.can_access_company(p_company_id) then raise exception 'Company access denied.'; end if;
  if nullif(trim(p_description), '') is null then raise exception 'Journal description is required.'; end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'Journal lines must be a JSON array.'; end if;

  select * into v_period from public.fiscal_periods
   where id = p_fiscal_period_id and company_id = p_company_id;
  if not found or v_period.status <> 'open' then raise exception 'Open fiscal period not found.'; end if;
  if p_entry_date < v_period.starts_on or p_entry_date > v_period.ends_on then
    raise exception 'Journal date is outside the fiscal period.';
  end if;

  select count(*), coalesce(sum(x.debit),0), coalesce(sum(x.credit),0)
    into v_line_count, v_debit, v_credit
  from jsonb_to_recordset(p_lines) as x(account_id uuid, debit numeric, credit numeric, description text);
  if v_line_count < 2 then raise exception 'At least two journal lines are required.'; end if;
  if v_debit <= 0 or v_credit <= 0 or v_debit <> v_credit then
    raise exception 'Journal is not balanced.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_lines) as x(account_id uuid, debit numeric, credit numeric, description text)
    left join public.accounts a on a.id = x.account_id and a.company_id = p_company_id
    where a.id is null or not a.is_active or not a.is_posting
       or x.debit < 0 or x.credit < 0
       or (x.debit > 0 and x.credit > 0)
       or (x.debit = 0 and x.credit = 0)
  ) then raise exception 'A journal line contains an invalid account or amount.'; end if;

  insert into public.journal_entries(company_id, fiscal_period_id, entry_date, description, created_by)
  values (p_company_id, p_fiscal_period_id, p_entry_date, trim(p_description), v_user_id)
  returning id into v_entry_id;

  insert into public.journal_lines(company_id, journal_entry_id, line_number, account_id, description, debit, credit)
  select p_company_id, v_entry_id, row_number() over (), x.account_id,
         nullif(trim(x.description),''), x.debit, x.credit
  from jsonb_to_recordset(p_lines) as x(account_id uuid, debit numeric, credit numeric, description text);

  return v_entry_id;
end;
$$;
alter function public.post_journal_entry(uuid, uuid) set search_path = pg_catalog, public, auth;
alter function public.reverse_journal_entry(uuid, date, uuid, uuid) set search_path = pg_catalog, public, auth;
alter function public.save_draft_journal_entry(uuid, uuid, date, text, jsonb) set search_path = pg_catalog, public, auth;
commit;
