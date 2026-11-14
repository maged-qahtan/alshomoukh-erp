-- Prevent premature fiscal-period closure and validate posted journal integrity.
create or replace function public.close_fiscal_period(p_fiscal_period_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_period public.fiscal_periods%rowtype;
  v_user_id uuid;
  v_drafts integer;
  v_unbalanced integer;
  v_out_of_range integer;
  v_debits numeric(20,2);
  v_credits numeric(20,2);
begin
  v_user_id := public.current_app_user_id();
  if v_user_id is null then raise exception 'Authenticated application profile is required.'; end if;
  select * into v_period from public.fiscal_periods where id=p_fiscal_period_id for update;
  if not found then raise exception 'Fiscal period not found.'; end if;
  if not public.can_manage_company(v_period.company_id) then raise exception 'Company management permission required.'; end if;
  if v_period.status <> 'open' then raise exception 'Fiscal period is already closed.'; end if;
  if v_period.ends_on >= current_date then raise exception 'Cannot close a fiscal period before its end date has passed.'; end if;
  select count(*) into v_drafts from public.journal_entries
   where fiscal_period_id=p_fiscal_period_id and company_id=v_period.company_id and status='draft';
  if v_drafts>0 then raise exception 'Cannot close period while draft journal entries remain.'; end if;
  select count(*) into v_unbalanced from (
   select e.id from public.journal_entries e
   left join public.journal_lines l on l.journal_entry_id=e.id and l.company_id=e.company_id
   where e.fiscal_period_id=p_fiscal_period_id and e.company_id=v_period.company_id and e.status='posted'
   group by e.id
   having count(l.id)<2 or coalesce(sum(l.debit),0)<=0 or coalesce(sum(l.credit),0)<=0
      or coalesce(sum(l.debit),0)<>coalesce(sum(l.credit),0)
  ) q;
  if v_unbalanced>0 then raise exception 'Cannot close period: one or more posted entries are unbalanced.'; end if;
  select count(*) into v_out_of_range from public.journal_entries
   where company_id=v_period.company_id and fiscal_period_id=p_fiscal_period_id
     and status in('posted','reversed') and (entry_date<v_period.starts_on or entry_date>v_period.ends_on);
  if v_out_of_range>0 then raise exception 'Cannot close period: entries exist outside the fiscal-period date range.'; end if;
  select coalesce(sum(l.debit),0)::numeric(20,2),coalesce(sum(l.credit),0)::numeric(20,2)
   into v_debits,v_credits
   from public.journal_entries e join public.journal_lines l on l.journal_entry_id=e.id and l.company_id=e.company_id
   where e.company_id=v_period.company_id and e.fiscal_period_id=p_fiscal_period_id and e.status='posted';
  if v_debits<>v_credits then
   raise exception 'Cannot close period: posted trial balance is not balanced (debit %, credit %).',v_debits,v_credits;
  end if;
  update public.fiscal_periods set status='closed',closed_at=now(),closed_by=v_user_id where id=p_fiscal_period_id;
  insert into public.audit_logs(company_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
  values(v_period.company_id,v_user_id,'fiscal_period.closed','fiscal_period',p_fiscal_period_id,
   jsonb_build_object('status','open'),
   jsonb_build_object('status','closed','starts_on',v_period.starts_on,'ends_on',v_period.ends_on,
    'posted_debit_total',v_debits,'posted_credit_total',v_credits));
end;
$function$;
revoke all on function public.close_fiscal_period(uuid) from public,anon;
grant execute on function public.close_fiscal_period(uuid) to authenticated;
