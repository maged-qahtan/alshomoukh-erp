-- Prevent direct posting or mutation/deletion of posted daily expenses.
create or replace function private.guard_daily_expense_state()
returns trigger language plpgsql set search_path = pg_catalog
as $$
begin
  if tg_op='DELETE' then
    if old.status='posted' then raise exception 'Posted daily expenses are immutable; use a reversal workflow'; end if;
    return old;
  end if;
  if old.status='posted' then raise exception 'Posted daily expenses are immutable; use a reversal workflow'; end if;
  if new.status='posted' and coalesce(current_setting('app.allow_daily_expense_post',true),'') <> old.id::text then
    raise exception 'Daily expenses must be posted through the controlled posting function';
  end if;
  return new;
end;
$$;
drop trigger if exists daily_expenses_state_guard on public.daily_expenses;
create trigger daily_expenses_state_guard before update or delete on public.daily_expenses
for each row execute function private.guard_daily_expense_state();

create or replace function public.record_daily_expense(
  p_company_id uuid,p_branch_id uuid,p_expense_date date,p_expense_account_id uuid,
  p_amount numeric,p_payment_method text,p_cash_bank_account_id uuid,p_description text,
  p_reference_number text default null,p_notes text default null,p_fiscal_period_id uuid default null
) returns uuid
language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v_user_id uuid := auth.uid();
  v_expense_id uuid := gen_random_uuid();
  v_journal_id uuid;
  v_credit_account_id uuid;
  v_lines jsonb;
  v_expense_class text;
  v_payment_class text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not private.can_access_company(p_company_id,true) then raise exception 'Company access denied'; end if;
  if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) then raise exception 'Amount must be positive and rounded to two decimals'; end if;
  if p_description is null or length(btrim(p_description))=0 then raise exception 'Description is required'; end if;
  if p_payment_method not in ('cash','bank','credit','other') then raise exception 'Unsupported payment method'; end if;
  if not exists(select 1 from public.branches b where b.id=p_branch_id and b.company_id=p_company_id and b.is_active) then raise exception 'Active company branch required'; end if;
  select a.account_class into v_expense_class from public.accounts a where a.id=p_expense_account_id and a.company_id=p_company_id and a.is_active and a.is_posting;
  if v_expense_class is null or v_expense_class not in ('expense','cost_of_revenue','other_expense') then raise exception 'Select an active posting expense account'; end if;
  if p_payment_method='cash' then
    select a.id into v_credit_account_id from public.accounts a where a.company_id=p_company_id and a.code='1110' and a.is_active and a.is_posting and a.account_class='asset';
  elsif p_payment_method='credit' then
    select a.id into v_credit_account_id from public.accounts a where a.company_id=p_company_id and a.code='2110' and a.is_active and a.is_posting and a.account_class='liability';
  else
    select a.id,a.account_class into v_credit_account_id,v_payment_class from public.accounts a where a.id=p_cash_bank_account_id and a.company_id=p_company_id and a.is_active and a.is_posting;
    if v_payment_class is null or (p_payment_method='bank' and v_payment_class<>'asset') then raise exception 'Select a valid active payment account'; end if;
  end if;
  if v_credit_account_id is null then raise exception 'Required payment account is not configured'; end if;
  insert into public.daily_expenses(id,company_id,branch_id,expense_date,expense_account_id,amount,payment_method,cash_bank_account_id,description,reference_number,status,notes,created_by)
  values(v_expense_id,p_company_id,p_branch_id,p_expense_date,p_expense_account_id,p_amount,p_payment_method,case when p_payment_method in ('bank','other') then p_cash_bank_account_id else null end,btrim(p_description),nullif(btrim(p_reference_number),''),'draft',nullif(btrim(p_notes),''),v_user_id);
  v_lines:=jsonb_build_array(
    jsonb_build_object('account_id',p_expense_account_id,'debit',p_amount,'credit',0,'description',btrim(p_description)),
    jsonb_build_object('account_id',v_credit_account_id,'debit',0,'credit',p_amount,'description',btrim(p_description))
  );
  v_journal_id:=public.create_journal_entry_draft(p_company_id,p_branch_id,p_fiscal_period_id,p_expense_date,'مصروف يومي: '||btrim(p_description),v_lines);
  perform public.post_journal_entry(p_company_id,v_journal_id);
  perform set_config('app.allow_daily_expense_post',v_expense_id::text,true);
  update public.daily_expenses set journal_entry_id=v_journal_id,status='posted',updated_at=now() where id=v_expense_id and company_id=p_company_id and status='draft';
  return v_expense_id;
end;
$$;
revoke all on function public.record_daily_expense(uuid,uuid,date,uuid,numeric,text,uuid,text,text,text,uuid) from public,anon;
grant execute on function public.record_daily_expense(uuid,uuid,date,uuid,numeric,text,uuid,text,text,text,uuid) to authenticated;
