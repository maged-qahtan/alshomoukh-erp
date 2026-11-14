create or replace function public.update_draft_journal_entry(
  p_entry_id uuid,
  p_entry_date date,
  p_description text,
  p_lines jsonb
)
returns void
language plpgsql
set search_path = pg_catalog, public, auth
as $$
declare
  v_entry public.journal_entries%rowtype;
  v_period public.fiscal_periods%rowtype;
  v_user_id uuid;
  v_line_count integer;
  v_debit numeric(20,2);
  v_credit numeric(20,2);
begin
  v_user_id := public.current_app_user_id();
  if v_user_id is null then raise exception 'Authenticated application profile is required.'; end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'Journal lines must be a JSON array.'; end if;
  select * into v_entry from public.journal_entries where id = p_entry_id for update;
  if not found then raise exception 'Journal entry not found.'; end if;
  if not public.can_manage_company(v_entry.company_id) then raise exception 'Company management permission required.'; end if;
  if v_entry.status <> 'draft' then raise exception 'Only draft entries can be edited.'; end if;
  select * into v_period from public.fiscal_periods where id = v_entry.fiscal_period_id and company_id = v_entry.company_id;
  if not found or v_period.status <> 'open' then raise exception 'Open fiscal period not found.'; end if;
  if p_entry_date < v_period.starts_on or p_entry_date > v_period.ends_on then raise exception 'Journal date is outside the fiscal period.'; end if;
  if nullif(trim(p_description), '') is null then raise exception 'Journal description is required.'; end if;
  select count(*), coalesce(sum(x.debit),0), coalesce(sum(x.credit),0)
    into v_line_count, v_debit, v_credit
  from jsonb_to_recordset(p_lines) as x(account_id uuid, debit numeric, credit numeric, description text, party_id uuid, cost_center_id uuid);
  if v_line_count < 2 then raise exception 'At least two journal lines are required.'; end if;
  if v_debit <= 0 or v_credit <= 0 or v_debit <> v_credit then raise exception 'Journal is not balanced.'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_lines) as x(account_id uuid, debit numeric, credit numeric, description text, party_id uuid, cost_center_id uuid)
    left join public.accounts a on a.id=x.account_id and a.company_id=v_entry.company_id
    where a.id is null or not a.is_active or not a.is_posting or x.debit < 0 or x.credit < 0
       or (x.debit > 0 and x.credit > 0) or (x.debit = 0 and x.credit = 0)
       or (x.party_id is not null and not exists (select 1 from public.parties p where p.id=x.party_id and p.company_id=v_entry.company_id))
       or (x.cost_center_id is not null and not exists (select 1 from public.cost_centers c where c.id=x.cost_center_id and c.company_id=v_entry.company_id))
  ) then raise exception 'A journal line contains an invalid account, party, cost center, or amount.'; end if;
  update public.journal_entries set entry_date=p_entry_date, description=trim(p_description)
   where id=p_entry_id and company_id=v_entry.company_id and status='draft';
  delete from public.journal_lines where journal_entry_id=p_entry_id and company_id=v_entry.company_id;
  insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,party_id,cost_center_id,debit,credit)
  select v_entry.company_id,p_entry_id,row_number() over (),x.account_id,nullif(trim(x.description),''),x.party_id,x.cost_center_id,x.debit,x.credit
  from jsonb_to_recordset(p_lines) as x(account_id uuid,debit numeric,credit numeric,description text,party_id uuid,cost_center_id uuid);
  insert into public.audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data)
  values(v_entry.company_id,v_user_id,'journal.draft_updated','journal_entry',p_entry_id,
         jsonb_build_object('entry_date',p_entry_date,'description',trim(p_description),'line_count',v_line_count));
end;
$$;
revoke all on function public.update_draft_journal_entry(uuid,date,text,jsonb) from public;
grant execute on function public.update_draft_journal_entry(uuid,date,text,jsonb) to authenticated;
