create unique index if not exists journal_entries_one_opening_balance_per_period
on public.journal_entries(company_id, fiscal_period_id)
where source_type = 'opening_balance' and status <> 'reversed';

create or replace function public.save_opening_balance_draft(
  p_company_id uuid,
  p_fiscal_period_id uuid,
  p_lines jsonb
)
returns uuid
language plpgsql
set search_path = pg_catalog, public, auth
as $$
declare
  v_user_id uuid;
  v_period public.fiscal_periods%rowtype;
  v_entry_id uuid;
  v_count integer;
  v_debit numeric(20,2);
  v_credit numeric(20,2);
begin
  v_user_id := public.current_app_user_id();
  if v_user_id is null then raise exception 'Authenticated application profile is required.'; end if;
  if not public.can_manage_company(p_company_id) then raise exception 'Company management permission required.'; end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'Opening balance lines must be a JSON array.'; end if;
  select * into v_period from public.fiscal_periods
   where id=p_fiscal_period_id and company_id=p_company_id for update;
  if not found or v_period.status <> 'open' then raise exception 'Open fiscal period not found.'; end if;
  if exists(select 1 from public.journal_entries where company_id=p_company_id and fiscal_period_id=p_fiscal_period_id and source_type='opening_balance' and status <> 'reversed') then
    raise exception 'An opening balance entry already exists for this fiscal period.';
  end if;
  select count(*),coalesce(sum(x.debit),0),coalesce(sum(x.credit),0)
    into v_count,v_debit,v_credit
  from jsonb_to_recordset(p_lines) as x(account_id uuid,debit numeric,credit numeric,description text,party_id uuid,cost_center_id uuid);
  if v_count < 2 then raise exception 'At least two opening balance lines are required.'; end if;
  if v_debit <= 0 or v_credit <= 0 or v_debit <> v_credit then raise exception 'Opening balances must be balanced.'; end if;
  if exists(
    select 1 from jsonb_to_recordset(p_lines) as x(account_id uuid,debit numeric,credit numeric,description text,party_id uuid,cost_center_id uuid)
    left join public.accounts a on a.id=x.account_id and a.company_id=p_company_id
    where a.id is null or not a.is_active or not a.is_posting
      or x.debit < 0 or x.credit < 0
      or (x.debit > 0 and x.credit > 0) or (x.debit=0 and x.credit=0)
      or (x.party_id is not null and not exists(select 1 from public.parties p where p.id=x.party_id and p.company_id=p_company_id))
      or (x.cost_center_id is not null and not exists(select 1 from public.cost_centers c where c.id=x.cost_center_id and c.company_id=p_company_id))
  ) then raise exception 'An opening balance line contains an invalid account, party, cost center, or amount.'; end if;
  insert into public.journal_entries(company_id,fiscal_period_id,entry_date,description,source_type,created_by)
  values(p_company_id,p_fiscal_period_id,v_period.starts_on,'الأرصدة الافتتاحية — '||v_period.name,'opening_balance',v_user_id)
  returning id into v_entry_id;
  insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,party_id,cost_center_id,debit,credit)
  select p_company_id,v_entry_id,row_number() over (),x.account_id,nullif(trim(x.description),''),x.party_id,x.cost_center_id,x.debit,x.credit
  from jsonb_to_recordset(p_lines) as x(account_id uuid,debit numeric,credit numeric,description text,party_id uuid,cost_center_id uuid);
  return v_entry_id;
end;
$$;
revoke all on function public.save_opening_balance_draft(uuid,uuid,jsonb) from public;
grant execute on function public.save_opening_balance_draft(uuid,uuid,jsonb) to authenticated;