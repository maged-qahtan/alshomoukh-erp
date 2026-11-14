-- Atomic journal draft creation through an authenticated, company-scoped RPC.
begin;
create or replace function public.save_draft_journal_entry(
  p_company_id uuid,
  p_fiscal_period_id uuid,
  p_entry_date date,
  p_description text,
  p_lines jsonb
) returns uuid
language plpgsql
set search_path = pg_catalog, public, auth
as $$
declare
  v_user_id uuid;
  v_entry_id uuid;
  v_period public.fiscal_periods%rowtype;
  v_line_count integer;
  v_debit numeric(20,2);
  v_credit numeric(20,2);
begin
  v_user_id := public.current_app_user_id();
  if v_user_id is null then raise exception 'Authenticated application profile is required.'; end if;
  if not public.can_access_company(p_company_id) then raise exception 'Company access denied.'; end if;
  if nullif(trim(p_description), '') is null then raise exception 'Journal description is required.'; end if;
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'Journal lines must be a JSON array.'; end if;

  select * into v_period from public.fiscal_periods
   where id = p_fiscal_period_id and company_id = p_company_id for share;
  if not found or v_period.status <> 'open' then raise exception 'Open fiscal period not found.'; end if;
  if p_entry_date < v_period.starts_on or p_entry_date > v_period.ends_on then
    raise exception 'Journal date is outside the fiscal period.';
  end if;

  select count(*), coalesce(sum(x.debit),0), coalesce(sum(x.credit),0)
    into v_line_count, v_debit, v_credit
  from jsonb_to_recordset(p_lines) as x(account_id uuid, debit numeric, credit numeric, description text);
  if v_line_count < 2 then raise exception 'At least two journal lines are required.'; end if;
  if v_debit <= 0 or v_credit <= 0 or v_debit <> v_credit then
    raise exception 'Journal is not balanced.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_lines) as x(account_id uuid, debit numeric, credit numeric, description text)
    left join public.accounts a on a.id = x.account_id and a.company_id = p_company_id
    where a.id is null or not a.is_active or not a.is_posting
       or x.debit < 0 or x.credit < 0
       or (x.debit > 0 and x.credit > 0)
       or (x.debit = 0 and x.credit = 0)
  ) then raise exception 'A journal line contains an invalid account or amount.'; end if;

  insert into public.journal_entries(company_id, fiscal_period_id, entry_date, description, created_by)
  values (p_company_id, p_fiscal_period_id, p_entry_date, trim(p_description), v_user_id)
  returning id into v_entry_id;

  insert into public.journal_lines(company_id, journal_entry_id, line_number, account_id, description, debit, credit)
  select p_company_id, v_entry_id, row_number() over (), x.account_id,
         nullif(trim(x.description),''), x.debit, x.credit
  from jsonb_to_recordset(p_lines) as x(account_id uuid, debit numeric, credit numeric, description text);

  return v_entry_id;
end;
$$;
revoke all on function public.save_draft_journal_entry(uuid, uuid, date, text, jsonb) from public, anon;
grant execute on function public.save_draft_journal_entry(uuid, uuid, date, text, jsonb) to authenticated;
commit;
