begin;
create or replace function public.report_trial_balance(p_company_id uuid,p_from date,p_to date)
returns table(account_id uuid,account_code varchar,account_name text,account_type public.account_type,is_posting boolean,opening_debit numeric,opening_credit numeric,period_debit numeric,period_credit numeric,closing_debit numeric,closing_credit numeric)
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
begin
 if p_from is null or p_to is null or p_from>p_to then raise exception 'Invalid reporting date range'; end if;
 if not public.can_access_company(p_company_id) then raise exception 'Company access denied'; end if;
 return query with x as (
  select l.account_id,
   greatest(coalesce(sum(l.debit-l.credit) filter(where e.entry_date<p_from),0),0)::numeric(20,2) od,
   greatest(coalesce(sum(l.credit-l.debit) filter(where e.entry_date<p_from),0),0)::numeric(20,2) oc,
   coalesce(sum(l.debit) filter(where e.entry_date between p_from and p_to),0)::numeric(20,2) pd,
   coalesce(sum(l.credit) filter(where e.entry_date between p_from and p_to),0)::numeric(20,2) pc
  from public.journal_entries e join public.journal_lines l on l.journal_entry_id=e.id and l.company_id=e.company_id
  where e.company_id=p_company_id and e.status in('posted','reversed') and e.entry_date<=p_to group by l.account_id
 ), balances as (
  select a.id,a.code,a.name_ar,a.type,a.is_posting,coalesce(x.od,0) od,coalesce(x.oc,0) oc,
   coalesce(x.pd,0) pd,coalesce(x.pc,0) pc
  from public.accounts a left join x on x.account_id=a.id where a.company_id=p_company_id and a.is_active
 )
 select b.id,b.code,b.name_ar,b.type,b.is_posting,b.od,b.oc,b.pd,b.pc,
  greatest(b.od-b.oc+b.pd-b.pc,0)::numeric(20,2),
  greatest(b.oc-b.od+b.pc-b.pd,0)::numeric(20,2)
 from balances b order by b.code;
end $$;
commit;