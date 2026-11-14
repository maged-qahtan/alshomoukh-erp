-- Correct carry-forward annual result: expenses reduce profit instead of increasing it.
create or replace function public.create_next_fiscal_year_opening_draft(
  p_closed_period_id uuid,
  p_retained_earnings_account_id uuid,
  p_new_period_name text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $function$
declare
  v_old public.fiscal_periods%rowtype;
  v_new_id uuid;
  v_new_name text;
  v_start date;
  v_end date;
  v_net_income numeric(20,2);
  v_debit numeric(20,2);
  v_credit numeric(20,2);
  v_lines jsonb;
  v_entry_id uuid;
  v_user_id uuid;
begin
  v_user_id := public.current_app_user_id();
  if v_user_id is null then raise exception 'Authenticated application profile is required.'; end if;
  select * into v_old from public.fiscal_periods where id=p_closed_period_id for update;
  if not found then raise exception 'Fiscal period not found.'; end if;
  if not public.can_manage_company(v_old.company_id) then raise exception 'Company management permission required.'; end if;
  if v_old.status <> 'closed' then raise exception 'Close the previous fiscal period before creating the next year.'; end if;
  if v_old.ends_on >= current_date then raise exception 'The previous fiscal period must have ended before opening the next year.'; end if;
  if exists(select 1 from public.journal_entries where company_id=v_old.company_id and fiscal_period_id=v_old.id and status='draft') then
    raise exception 'Draft journal entries remain in the previous period.';
  end if;
  if exists(select 1 from public.fiscal_periods where company_id=v_old.company_id and starts_on=v_old.ends_on+1) then
    raise exception 'The next fiscal period already exists.';
  end if;
  if not exists(select 1 from public.accounts where id=p_retained_earnings_account_id and company_id=v_old.company_id and type='equity' and is_active and is_posting) then
    raise exception 'Select an active posting equity account for retained earnings.';
  end if;
  v_start := v_old.ends_on + 1;
  v_end := (v_old.ends_on + interval '1 year')::date;
  v_new_name := coalesce(nullif(trim(p_new_period_name),''),'FY '||extract(year from v_start)::int);
  with posted_totals as (
    select l.account_id,sum(l.debit)::numeric(20,2) debit_total,sum(l.credit)::numeric(20,2) credit_total
    from public.journal_lines l join public.journal_entries e on e.id=l.journal_entry_id
    where e.company_id=v_old.company_id and e.fiscal_period_id=v_old.id and e.status='posted'
    group by l.account_id
  )
  select coalesce(sum(case
    when a.type='revenue' then t.credit_total-t.debit_total
    when a.type='expense' then -(t.debit_total-t.credit_total)
    else 0 end),0)::numeric(20,2)
  into v_net_income
  from public.accounts a join posted_totals t on t.account_id=a.id
  where a.company_id=v_old.company_id and a.is_active and a.is_posting and a.type in('revenue','expense');
  with posted_totals as (
    select l.account_id,sum(l.debit)::numeric(20,2) debit_total,sum(l.credit)::numeric(20,2) credit_total
    from public.journal_lines l join public.journal_entries e on e.id=l.journal_entry_id
    where e.company_id=v_old.company_id and e.fiscal_period_id=v_old.id and e.status='posted'
    group by l.account_id
  ), balances as (
    select a.id,a.type,
      case when a.type='asset' then coalesce(t.debit_total,0)-coalesce(t.credit_total,0)
           else coalesce(t.credit_total,0)-coalesce(t.debit_total,0) end::numeric(20,2) balance
    from public.accounts a left join posted_totals t on t.account_id=a.id
    where a.company_id=v_old.company_id and a.is_active and a.is_posting and a.type in('asset','liability','equity')
  ), opening_lines as (
    select id account_id,
      case when type='asset' then greatest(balance,0) else greatest(-balance,0) end::numeric(20,2) debit,
      case when type='asset' then greatest(-balance,0) else greatest(balance,0) end::numeric(20,2) credit,
      'رصيد مرحل من '||v_old.name description
    from balances where balance<>0
    union all
    select p_retained_earnings_account_id,greatest(-v_net_income,0),greatest(v_net_income,0),
      'نتيجة السنة السابقة — '||v_old.name where v_net_income<>0
  )
  select coalesce(jsonb_agg(jsonb_build_object('account_id',account_id,'debit',debit,'credit',credit,'description',description)),'[]'::jsonb),
    coalesce(sum(debit),0),coalesce(sum(credit),0)
  into v_lines,v_debit,v_credit from opening_lines;
  if v_debit<=0 or v_debit<>v_credit then
    raise exception 'Opening balances do not balance after applying annual net income (debit %, credit %). Review the previous trial balance.',v_debit,v_credit;
  end if;
  insert into public.fiscal_periods(company_id,name,starts_on,ends_on,status)
  values(v_old.company_id,v_new_name,v_start,v_end,'open') returning id into v_new_id;
  v_entry_id := public.save_opening_balance_draft(v_old.company_id,v_new_id,v_lines);
  insert into public.audit_logs(company_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
  values(v_old.company_id,v_user_id,'fiscal_year.opening_draft_created','fiscal_period',v_new_id,
    jsonb_build_object('previous_period_id',v_old.id),
    jsonb_build_object('period_name',v_new_name,'starts_on',v_start,'ends_on',v_end,
      'opening_entry_id',v_entry_id,'net_income',v_net_income,'debit_total',v_debit,'credit_total',v_credit));
  return jsonb_build_object('period_id',v_new_id,'period_name',v_new_name,'starts_on',v_start,'ends_on',v_end,
    'opening_entry_id',v_entry_id,'net_income',v_net_income,'debit_total',v_debit,'credit_total',v_credit,'status','draft');
end;
$function$;
revoke all on function public.create_next_fiscal_year_opening_draft(uuid,uuid,text) from public,anon;
grant execute on function public.create_next_fiscal_year_opening_draft(uuid,uuid,text) to authenticated;
