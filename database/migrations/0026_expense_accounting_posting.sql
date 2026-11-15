-- Atomic expense posting: expense + input VAT debit, cash/bank credit.
alter table public.expenses
  add column if not exists expense_account_id uuid,
  add column if not exists cost_center_id uuid,
  add column if not exists journal_entry_id uuid,
  add column if not exists posted_at timestamptz,
  add column if not exists posted_by uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='expenses_company_expense_account_fk') then
    alter table public.expenses add constraint expenses_company_expense_account_fk
      foreign key (company_id, expense_account_id) references public.accounts(company_id,id);
  end if;
  if not exists (select 1 from pg_constraint where conname='expenses_company_cost_center_fk') then
    alter table public.expenses add constraint expenses_company_cost_center_fk
      foreign key (company_id, cost_center_id) references public.cost_centers(company_id,id);
  end if;
  if not exists (select 1 from pg_constraint where conname='expenses_company_journal_fk') then
    alter table public.expenses add constraint expenses_company_journal_fk
      foreign key (company_id, journal_entry_id) references public.journal_entries(company_id,id);
  end if;
end $$;

create unique index if not exists expenses_journal_entry_unique
  on public.expenses(journal_entry_id) where journal_entry_id is not null;

create or replace function public.guard_posted_expense_immutable()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.status='posted' then
    raise exception 'Posted expenses are immutable; create a documented reversal instead';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists expenses_posted_immutable on public.expenses;
create trigger expenses_posted_immutable
before update or delete on public.expenses
for each row execute function public.guard_posted_expense_immutable();

create or replace function public.post_expense(p_expense_id uuid)
returns uuid language plpgsql security invoker
set search_path = pg_catalog, public, auth as $$
declare
  e public.expenses%rowtype;
  ca public.cash_accounts%rowtype;
  v_user uuid;
  v_period uuid;
  v_vat_account uuid;
  v_journal uuid;
  v_total numeric(20,4);
  v_line integer := 1;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into e from public.expenses where id=p_expense_id for update;
  if not found or not public.can_manage_company(e.company_id) then
    raise exception 'Expense not found or not authorized' using errcode='42501';
  end if;
  if e.status <> 'draft' or e.journal_entry_id is not null then raise exception 'Only unposted draft expenses can be posted'; end if;
  if e.amount <= 0 or e.vat_amount < 0 then raise exception 'Expense amount must be positive and VAT cannot be negative'; end if;
  if e.expense_account_id is null or e.cash_account_id is null then raise exception 'Select an expense account and cash/bank account before posting'; end if;
  v_user := public.current_app_user_id();
  if v_user is null then raise exception 'Active application user not found'; end if;
  if not exists (select 1 from public.accounts a where a.id=e.expense_account_id and a.company_id=e.company_id and a.is_active and a.is_posting) then
    raise exception 'Expense ledger account is inactive or non-posting';
  end if;
  select * into ca from public.cash_accounts where id=e.cash_account_id and company_id=e.company_id and is_active for update;
  if not found or ca.ledger_account_id is null then raise exception 'Cash/bank account must be active and linked to a ledger account'; end if;
  if not exists (select 1 from public.accounts a where a.id=ca.ledger_account_id and a.company_id=e.company_id and a.is_active and a.is_posting) then
    raise exception 'Linked cash/bank ledger account is inactive or non-posting';
  end if;
  if e.cost_center_id is not null and not exists (select 1 from public.cost_centers c where c.id=e.cost_center_id and c.company_id=e.company_id and c.is_active) then
    raise exception 'Cost center is inactive or does not belong to this company';
  end if;
  if e.party_id is not null and not exists (select 1 from public.parties p where p.id=e.party_id and p.company_id=e.company_id and p.is_active) then
    raise exception 'Party is inactive or does not belong to this company';
  end if;
  if e.vat_amount > 0 then
    select id into v_vat_account from public.accounts where company_id=e.company_id and code='1105' and is_active and is_posting;
    if v_vat_account is null then raise exception 'Input VAT account 1105 is missing or inactive; configure it before posting VAT expenses'; end if;
  end if;
  select id into v_period from public.fiscal_periods where company_id=e.company_id and status='open' and e.expense_date between starts_on and ends_on for update;
  if v_period is null then raise exception 'No open fiscal period contains expense date'; end if;
  v_total := e.amount + e.vat_amount;
  insert into public.journal_entries(company_id,fiscal_period_id,entry_date,description,reference,source_type,source_id,created_by)
  values(e.company_id,v_period,e.expense_date,e.description,e.expense_number,'expense',e.id,v_user) returning id into v_journal;
  insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,party_id,cost_center_id,debit,credit)
  values(e.company_id,v_journal,v_line,e.expense_account_id,e.description,e.party_id,e.cost_center_id,e.amount,0);
  v_line := v_line + 1;
  if e.vat_amount > 0 then
    insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,party_id,debit,credit)
    values(e.company_id,v_journal,v_line,v_vat_account,'ضريبة مدخلات - '||e.description,e.party_id,e.vat_amount,0);
    v_line := v_line + 1;
  end if;
  insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,party_id,debit,credit)
  values(e.company_id,v_journal,v_line,ca.ledger_account_id,e.description,e.party_id,0,v_total);
  perform public.post_journal_entry(v_journal,v_user);
  update public.expenses set status='posted',journal_entry_id=v_journal,posted_at=now(),posted_by=v_user where id=e.id and status='draft';
  insert into public.audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data)
  values(e.company_id,v_user,'expense.posted','expense',e.id,jsonb_build_object('journal_entry_id',v_journal,'amount',e.amount,'vat_amount',e.vat_amount,'cash_account_id',e.cash_account_id,'expense_account_id',e.expense_account_id,'cost_center_id',e.cost_center_id));
  return v_journal;
end $$;

revoke all on function public.post_expense(uuid) from public, anon;
grant execute on function public.post_expense(uuid) to authenticated;
