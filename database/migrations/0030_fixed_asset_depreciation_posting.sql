-- Monthly straight-line depreciation with idempotent journal posting.
begin;

create or replace function public.post_asset_depreciation(
  p_asset_id uuid,
  p_period_start date,
  p_period_end date
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $function$
declare
  a public.fixed_assets%rowtype;
  v_user uuid;
  v_period uuid;
  v_expense_account uuid;
  v_accumulated_account uuid;
  v_existing uuid;
  v_journal uuid;
  v_monthly numeric(20,2);
  v_accumulated numeric(20,2);
  v_remaining_basis numeric(20,2);
  v_amount numeric(20,2);
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;

  if p_period_start is null or p_period_end is null
     or p_period_start <> date_trunc('month', p_period_start)::date
     or p_period_end <> (date_trunc('month', p_period_start) + interval '1 month - 1 day')::date then
    raise exception 'Depreciation period must be one complete calendar month' using errcode='22023';
  end if;

  select * into a
  from public.fixed_assets
  where id=p_asset_id
  for update;

  if not found or not public.can_manage_company(a.company_id) then
    raise exception 'Asset not found or not authorized' using errcode='42501';
  end if;
  if not a.is_active then
    raise exception 'Inactive assets cannot be depreciated';
  end if;
  if p_period_start <= date_trunc('month', a.acquisition_date)::date then
    raise exception 'Depreciation starts in the first full month after acquisition';
  end if;

  v_user := public.current_app_user_id();
  if v_user is null then
    raise exception 'Active application user not found' using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(a.company_id::text,0));

  select journal_entry_id into v_existing
  from public.asset_depreciation
  where company_id=a.company_id and asset_id=a.id
    and period_start=p_period_start and period_end=p_period_end
  for update;

  if found then
    if v_existing is not null then
      return v_existing;
    end if;
    raise exception 'A depreciation record already exists for this asset and period';
  end if;

  select id into v_period
  from public.fiscal_periods
  where company_id=a.company_id and status='open'
    and p_period_start >= starts_on and p_period_end <= ends_on
  for update;

  if v_period is null then
    raise exception 'No single open fiscal period contains the full depreciation month';
  end if;

  select id into v_expense_account
  from public.accounts
  where company_id=a.company_id and code='5204' and is_active and is_posting;
  select id into v_accumulated_account
  from public.accounts
  where company_id=a.company_id and code='1202' and is_active and is_posting;

  if v_expense_account is null or v_accumulated_account is null then
    raise exception 'Depreciation accounts 5204 and 1202 must exist and be active posting accounts';
  end if;

  v_remaining_basis := a.acquisition_cost - a.residual_value;
  select coalesce(sum(depreciation_amount),0)::numeric(20,2)
  into v_accumulated
  from public.asset_depreciation
  where company_id=a.company_id and asset_id=a.id and journal_entry_id is not null;

  v_monthly := round(v_remaining_basis / a.useful_life_months,2);
  v_amount := least(v_monthly, greatest(v_remaining_basis-v_accumulated,0));

  if v_amount <= 0 then
    raise exception 'Asset is fully depreciated to its residual value';
  end if;

  insert into public.journal_entries(
    company_id,fiscal_period_id,entry_date,description,reference,source_type,source_id,created_by
  )
  values(
    a.company_id,v_period,p_period_end,
    'إهلاك الأصل '||a.name_ar||' عن شهر '||to_char(p_period_start,'YYYY-MM'),
    a.asset_code||'-DEP-'||to_char(p_period_start,'YYYYMM'),
    'asset_depreciation',a.id,v_user
  )
  returning id into v_journal;

  insert into public.journal_lines(
    company_id,journal_entry_id,line_number,account_id,description,debit,credit
  )
  values
    (a.company_id,v_journal,1,v_expense_account,'مصروف إهلاك '||a.name_ar,v_amount,0),
    (a.company_id,v_journal,2,v_accumulated_account,'مجمع إهلاك '||a.name_ar,0,v_amount);

  perform public.post_journal_entry(v_journal,v_user);

  insert into public.asset_depreciation(
    company_id,asset_id,period_start,period_end,depreciation_amount,journal_entry_id
  )
  values(a.company_id,a.id,p_period_start,p_period_end,v_amount,v_journal);

  insert into public.audit_logs(
    company_id,actor_user_id,action,entity_type,entity_id,after_data
  )
  values(
    a.company_id,v_user,'asset_depreciation.posted','fixed_asset',a.id,
    jsonb_build_object(
      'journal_entry_id',v_journal,
      'period_start',p_period_start,
      'period_end',p_period_end,
      'depreciation_amount',v_amount,
      'accumulated_depreciation',v_accumulated+v_amount
    )
  );

  return v_journal;
end
$function$;

create or replace view public.fixed_asset_balances
with (security_invoker = true) as
select
  a.company_id,
  a.id as asset_id,
  a.asset_code,
  a.name_ar,
  a.acquisition_date,
  a.acquisition_cost,
  a.residual_value,
  a.useful_life_months,
  a.is_active,
  coalesce(sum(d.depreciation_amount) filter (where d.journal_entry_id is not null),0)::numeric(20,2)
    as accumulated_depreciation,
  (a.acquisition_cost - coalesce(sum(d.depreciation_amount) filter (where d.journal_entry_id is not null),0))::numeric(20,2)
    as net_book_value
from public.fixed_assets a
left join public.asset_depreciation d
  on d.company_id=a.company_id and d.asset_id=a.id
group by a.company_id,a.id,a.asset_code,a.name_ar,a.acquisition_date,
  a.acquisition_cost,a.residual_value,a.useful_life_months,a.is_active;

grant select on public.fixed_asset_balances to authenticated;
revoke all on function public.post_asset_depreciation(uuid,date,date) from public, anon;
grant execute on function public.post_asset_depreciation(uuid,date,date) to authenticated;

commit;
