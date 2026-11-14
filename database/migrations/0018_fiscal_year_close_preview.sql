create or replace function public.get_fiscal_year_close_preview(p_fiscal_period_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, auth
as $$
declare
  v_period public.fiscal_periods%rowtype;
  v_result jsonb;
  v_user_id uuid;
begin
  v_user_id := public.current_app_user_id();
  if v_user_id is null then raise exception 'Authenticated application profile is required.'; end if;
  select * into v_period from public.fiscal_periods where id=p_fiscal_period_id;
  if not found then raise exception 'Fiscal period not found.'; end if;
  if not public.can_manage_company(v_period.company_id) then raise exception 'Company access denied.'; end if;
  if v_period.status <> 'closed' then raise exception 'Fiscal year preview requires a closed fiscal period.'; end if;
  if exists(select 1 from public.journal_entries where company_id=v_period.company_id and fiscal_period_id=v_period.id and status='draft') then
    raise exception 'Draft journal entries remain in this period.';
  end if;

  with balances as (
    select a.id account_id,a.code account_code,a.name_ar account_name,a.type account_type,
      coalesce(sum(l.debit),0)::numeric(20,2) debit_total,
      coalesce(sum(l.credit),0)::numeric(20,2) credit_total
    from public.accounts a
    left join public.journal_lines l on l.account_id=a.id
    left join public.journal_entries e on e.id=l.journal_entry_id
      and e.company_id=v_period.company_id and e.fiscal_period_id=v_period.id and e.status='posted'
    where a.company_id=v_period.company_id and a.is_active and a.is_posting
    group by a.id,a.code,a.name_ar,a.type
  ), enriched as (
    select *, case when account_type in ('asset','expense') then debit_total-credit_total else credit_total-debit_total end::numeric(20,2) signed_balance
    from balances
  )
  select jsonb_build_object(
    'period',jsonb_build_object('id',v_period.id,'name',v_period.name,'starts_on',v_period.starts_on,'ends_on',v_period.ends_on,'status',v_period.status),
    'income_accounts',coalesce((select jsonb_agg(jsonb_build_object('account_id',account_id,'code',account_code,'name',account_name,'type',account_type,'debit',debit_total,'credit',credit_total,'balance',signed_balance) order by account_code) from enriched where account_type in ('revenue','expense') and signed_balance<>0),'[]'::jsonb),
    'balance_sheet_accounts',coalesce((select jsonb_agg(jsonb_build_object('account_id',account_id,'code',account_code,'name',account_name,'type',account_type,'debit',debit_total,'credit',credit_total,'balance',signed_balance) order by account_code) from enriched where account_type in ('asset','liability','equity') and signed_balance<>0),'[]'::jsonb),
    'revenue_total',coalesce((select sum(credit_total-debit_total) from enriched where account_type='revenue'),0),
    'expense_total',coalesce((select sum(debit_total-credit_total) from enriched where account_type='expense'),0),
    'net_income',coalesce((select sum(credit_total-debit_total) from enriched where account_type='revenue'),0)-coalesce((select sum(debit_total-credit_total) from enriched where account_type='expense'),0),
    'posted_entry_count',(select count(*) from public.journal_entries where company_id=v_period.company_id and fiscal_period_id=v_period.id and status='posted')
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_fiscal_year_close_preview(uuid) from anon, public;
grant execute on function public.get_fiscal_year_close_preview(uuid) to authenticated;