-- Period-aware financial reporting RPCs; invoker rights preserve underlying RLS.
begin;
create or replace function public.report_trial_balance(p_company_id uuid,p_from date,p_to date)
returns table(account_id uuid,account_code varchar,account_name text,account_type public.account_type,is_posting boolean,opening_debit numeric,opening_credit numeric,period_debit numeric,period_credit numeric,closing_debit numeric,closing_credit numeric)
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
begin
 if p_from is null or p_to is null or p_from>p_to then raise exception 'Invalid reporting date range'; end if;
 if not public.can_access_company(p_company_id) then raise exception 'Company access denied'; end if;
 return query with x as (
  select l.account_id,
   coalesce(sum(l.debit) filter(where e.entry_date<p_from),0)::numeric(20,2) od,
   coalesce(sum(l.credit) filter(where e.entry_date<p_from),0)::numeric(20,2) oc,
   coalesce(sum(l.debit) filter(where e.entry_date between p_from and p_to),0)::numeric(20,2) pd,
   coalesce(sum(l.credit) filter(where e.entry_date between p_from and p_to),0)::numeric(20,2) pc
  from public.journal_entries e join public.journal_lines l on l.journal_entry_id=e.id and l.company_id=e.company_id
  where e.company_id=p_company_id and e.status in('posted','reversed') and e.entry_date<=p_to group by l.account_id
 )
 select a.id,a.code,a.name_ar,a.type,a.is_posting,coalesce(x.od,0),coalesce(x.oc,0),coalesce(x.pd,0),coalesce(x.pc,0),
 greatest(coalesce(x.od,0)+coalesce(x.pd,0)-coalesce(x.oc,0)-coalesce(x.pc,0),0),
 greatest(coalesce(x.oc,0)+coalesce(x.pc,0)-coalesce(x.od,0)-coalesce(x.pd,0),0)
 from public.accounts a left join x on x.account_id=a.id where a.company_id=p_company_id and a.is_active order by a.code;
end $$;

create or replace function public.report_income_statement(p_company_id uuid,p_from date,p_to date,p_cost_center_id uuid default null)
returns table(account_id uuid,account_code varchar,account_name text,account_type public.account_type,period_amount numeric)
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
begin
 if p_from is null or p_to is null or p_from>p_to then raise exception 'Invalid reporting date range'; end if;
 if not public.can_access_company(p_company_id) then raise exception 'Company access denied'; end if;
 if p_cost_center_id is not null and not exists(select 1 from public.cost_centers c where c.id=p_cost_center_id and c.company_id=p_company_id) then raise exception 'Invalid cost center'; end if;
 return query select a.id,a.code,a.name_ar,a.type,
 sum(case when a.type='revenue' then l.credit-l.debit else l.debit-l.credit end)::numeric(20,2)
 from public.journal_entries e join public.journal_lines l on l.journal_entry_id=e.id and l.company_id=e.company_id
 join public.accounts a on a.id=l.account_id and a.company_id=e.company_id
 where e.company_id=p_company_id and e.status in('posted','reversed') and e.entry_date between p_from and p_to
 and a.type in('revenue','expense') and (p_cost_center_id is null or l.cost_center_id=p_cost_center_id)
 group by a.id,a.code,a.name_ar,a.type order by a.code;
end $$;

create or replace function public.report_balance_sheet(p_company_id uuid,p_as_of date)
returns table(account_id uuid,account_code varchar,account_name text,account_type public.account_type,debit_total numeric,credit_total numeric,balance numeric)
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
begin
 if p_as_of is null then raise exception 'Reporting date required'; end if;
 if not public.can_access_company(p_company_id) then raise exception 'Company access denied'; end if;
 return query select a.id,a.code,a.name_ar,a.type,
 coalesce(sum(l.debit) filter(where e.id is not null),0)::numeric(20,2),
 coalesce(sum(l.credit) filter(where e.id is not null),0)::numeric(20,2),
 (case when a.type='asset' then coalesce(sum(l.debit-l.credit) filter(where e.id is not null),0)
 else coalesce(sum(l.credit-l.debit) filter(where e.id is not null),0) end)::numeric(20,2)
 from public.accounts a left join public.journal_lines l on l.account_id=a.id and l.company_id=a.company_id
 left join public.journal_entries e on e.id=l.journal_entry_id and e.company_id=l.company_id
 and e.status in('posted','reversed') and e.entry_date<=p_as_of
 where a.company_id=p_company_id and a.is_active and a.type in('asset','liability','equity')
 group by a.id,a.code,a.name_ar,a.type order by a.code;
end $$;

create or replace function public.report_general_ledger(p_company_id uuid,p_from date,p_to date,p_account_id uuid default null,p_cost_center_id uuid default null)
returns table(account_id uuid,account_code varchar,account_name text,account_type public.account_type,journal_entry_id uuid,entry_number bigint,entry_date date,reference text,entry_description text,line_number integer,line_description text,party_id uuid,cost_center_id uuid,debit numeric,credit numeric,opening_balance numeric,signed_amount numeric,running_balance numeric)
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
begin
 if p_from is null or p_to is null or p_from>p_to then raise exception 'Invalid reporting date range'; end if;
 if not public.can_access_company(p_company_id) then raise exception 'Company access denied'; end if;
 if p_account_id is not null and not exists(select 1 from public.accounts a where a.id=p_account_id and a.company_id=p_company_id) then raise exception 'Invalid account'; end if;
 if p_cost_center_id is not null and not exists(select 1 from public.cost_centers c where c.id=p_cost_center_id and c.company_id=p_company_id) then raise exception 'Invalid cost center'; end if;
 return query with op as (
  select l.account_id,sum(case when a.type in('asset','expense') then l.debit-l.credit else l.credit-l.debit end)::numeric(20,2) bal
  from public.journal_entries e join public.journal_lines l on l.journal_entry_id=e.id and l.company_id=e.company_id
  join public.accounts a on a.id=l.account_id and a.company_id=e.company_id
  where e.company_id=p_company_id and e.status in('posted','reversed') and e.entry_date<p_from
  and (p_account_id is null or l.account_id=p_account_id) and (p_cost_center_id is null or l.cost_center_id=p_cost_center_id)
  group by l.account_id
 ), rows_period as (
  select a.id aid,a.code acode,a.name_ar aname,a.type atype,e.id eid,e.entry_number eno,e.entry_date edate,e.reference eref,e.description edesc,
  l.line_number lno,l.description ldesc,l.party_id pid,l.cost_center_id ccid,l.debit d,l.credit c,coalesce(op.bal,0)::numeric(20,2) opening,
  (case when a.type in('asset','expense') then l.debit-l.credit else l.credit-l.debit end)::numeric(20,2) signed
  from public.journal_entries e join public.journal_lines l on l.journal_entry_id=e.id and l.company_id=e.company_id
  join public.accounts a on a.id=l.account_id and a.company_id=e.company_id left join op on op.account_id=l.account_id
  where e.company_id=p_company_id and e.status in('posted','reversed') and e.entry_date between p_from and p_to
  and (p_account_id is null or l.account_id=p_account_id) and (p_cost_center_id is null or l.cost_center_id=p_cost_center_id)
 )
 select r.aid,r.acode,r.aname,r.atype,r.eid,r.eno,r.edate,r.eref,r.edesc,r.lno,r.ldesc,r.pid,r.ccid,r.d,r.c,r.opening,r.signed,
 (r.opening+sum(r.signed) over(partition by r.aid order by r.edate,r.eno,r.lno rows between unbounded preceding and current row))::numeric(20,2)
 from rows_period r order by r.acode,r.edate,r.eno,r.lno;
end $$;

revoke all on function public.report_trial_balance(uuid,date,date) from public,anon;
revoke all on function public.report_income_statement(uuid,date,date,uuid) from public,anon;
revoke all on function public.report_balance_sheet(uuid,date) from public,anon;
revoke all on function public.report_general_ledger(uuid,date,date,uuid,uuid) from public,anon;
grant execute on function public.report_trial_balance(uuid,date,date) to authenticated;
grant execute on function public.report_income_statement(uuid,date,date,uuid) to authenticated;
grant execute on function public.report_balance_sheet(uuid,date) to authenticated;
grant execute on function public.report_general_ledger(uuid,date,date,uuid,uuid) to authenticated;
commit;