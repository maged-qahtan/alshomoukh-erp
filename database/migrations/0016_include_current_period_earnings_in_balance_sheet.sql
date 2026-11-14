-- Include unclosed current-period earnings in the balance sheet presentation only.
-- No journal entry or ledger balance is created or modified.
begin;
create or replace function public.report_balance_sheet(p_company_id uuid,p_as_of date)
returns table(account_id uuid,account_code varchar,account_name text,account_type public.account_type,debit_total numeric,credit_total numeric,balance numeric)
language plpgsql stable security invoker set search_path=pg_catalog,public as $$
declare
 v_period_start date;
 v_net_result numeric(20,2);
begin
 if p_as_of is null then raise exception 'Reporting date required'; end if;
 if not public.can_access_company(p_company_id) then raise exception 'Company access denied'; end if;
 select fp.starts_on into v_period_start from public.fiscal_periods fp
 where fp.company_id=p_company_id and p_as_of between fp.starts_on and fp.ends_on
 order by fp.starts_on desc limit 1;
 if v_period_start is null then raise exception 'No fiscal period contains the reporting date'; end if;
 return query
 select a.id,a.code,a.name_ar,a.type,
  coalesce(sum(l.debit) filter(where e.id is not null),0)::numeric(20,2),
  coalesce(sum(l.credit) filter(where e.id is not null),0)::numeric(20,2),
  (case when a.type='asset' then coalesce(sum(l.debit-l.credit) filter(where e.id is not null),0)
   else coalesce(sum(l.credit-l.debit) filter(where e.id is not null),0) end)::numeric(20,2)
 from public.accounts a
 left join public.journal_lines l on l.account_id=a.id and l.company_id=a.company_id
 left join public.journal_entries e on e.id=l.journal_entry_id and e.company_id=l.company_id
  and e.status in('posted','reversed') and e.entry_date<=p_as_of
 where a.company_id=p_company_id and a.is_active and a.type in('asset','liability','equity')
 group by a.id,a.code,a.name_ar,a.type
 union all
 select null::uuid,'—'::varchar,
  case when coalesce(x.net_result,0)>=0 then 'صافي ربح الفترة الحالية' else 'صافي خسارة الفترة الحالية' end::text,
  'equity'::public.account_type,
  greatest(-coalesce(x.net_result,0),0)::numeric(20,2),
  greatest(coalesce(x.net_result,0),0)::numeric(20,2),
  coalesce(x.net_result,0)::numeric(20,2)
 from (
  select coalesce(sum(case when a.type='revenue' then l.credit-l.debit else l.debit-l.credit end),0)::numeric(20,2) net_result
  from public.journal_entries e
  join public.journal_lines l on l.journal_entry_id=e.id and l.company_id=e.company_id
  join public.accounts a on a.id=l.account_id and a.company_id=e.company_id
  where e.company_id=p_company_id and e.status in('posted','reversed')
   and e.entry_date between v_period_start and p_as_of
   and a.is_posting and a.type in('revenue','expense')
 ) x
 where coalesce(x.net_result,0)<>0
 order by 2;
end $$;
revoke all on function public.report_balance_sheet(uuid,date) from public,anon;
grant execute on function public.report_balance_sheet(uuid,date) to authenticated;
commit;
