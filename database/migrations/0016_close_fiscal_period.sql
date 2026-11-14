create or replace function public.close_fiscal_period(p_fiscal_period_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_period public.fiscal_periods%rowtype;
  v_user_id uuid;
  v_drafts integer;
  v_unbalanced integer;
begin
  v_user_id := public.current_app_user_id();
  if v_user_id is null then raise exception 'Authenticated application profile is required.'; end if;
  select * into v_period from public.fiscal_periods where id=p_fiscal_period_id for update;
  if not found then raise exception 'Fiscal period not found.'; end if;
  if not public.can_manage_company(v_period.company_id) then raise exception 'Company management permission required.'; end if;
  if v_period.status <> 'open' then raise exception 'Fiscal period is already closed.'; end if;
  select count(*) into v_drafts from public.journal_entries
    where fiscal_period_id=p_fiscal_period_id and company_id=v_period.company_id and status='draft';
  if v_drafts > 0 then raise exception 'Cannot close period while draft journal entries remain.'; end if;
  select count(*) into v_unbalanced
  from (
    select e.id
    from public.journal_entries e
    left join public.journal_lines l on l.journal_entry_id=e.id
    where e.fiscal_period_id=p_fiscal_period_id and e.company_id=v_period.company_id and e.status='posted'
    group by e.id
    having count(l.id)<2 or coalesce(sum(l.debit),0)<=0 or coalesce(sum(l.credit),0)<=0 or coalesce(sum(l.debit),0)<>coalesce(sum(l.credit),0)
  ) q;
  if v_unbalanced > 0 then raise exception 'Cannot close period: one or more posted entries are unbalanced.'; end if;
  update public.fiscal_periods set status='closed',closed_at=now(),closed_by=v_user_id where id=p_fiscal_period_id;
  insert into public.audit_logs(company_id,actor_user_id,action,entity_type,entity_id,before_data,after_data)
  values(v_period.company_id,v_user_id,'fiscal_period.closed','fiscal_period',p_fiscal_period_id,
    jsonb_build_object('status','open'),
    jsonb_build_object('status','closed','starts_on',v_period.starts_on,'ends_on',v_period.ends_on));
end;
$$;
revoke all on function public.close_fiscal_period(uuid) from anon, public;
grant execute on function public.close_fiscal_period(uuid) to authenticated;