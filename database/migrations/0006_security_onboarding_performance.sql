-- Security, onboarding, and query-plan hardening.
begin;

-- Pin function resolution to trusted schemas.
alter function public.guard_journal_entry_mutation() set search_path = pg_catalog, public, auth;
alter function public.prevent_posted_journal_mutation() set search_path = pg_catalog, public, auth;
alter function public.post_journal_entry(uuid, uuid) set search_path = pg_catalog, public, auth;
alter function public.reverse_journal_entry(uuid, date, uuid, uuid) set search_path = pg_catalog, public, auth;
alter function public.initialize_company(text, text, date, date) set search_path = pg_catalog, public, auth;
alter function public.seed_default_chart_of_accounts(uuid) set search_path = pg_catalog, public, auth;
alter function public.prevent_audit_log_mutation() set search_path = pg_catalog, public, auth;

-- Avoid re-evaluating auth.uid() for every row.
drop policy if exists "users read own profile" on public.app_users;
create policy "users read own profile" on public.app_users
for select to authenticated
using (auth_subject = (select auth.uid()::text));

-- Split write policies from SELECT policies to avoid redundant permissive SELECT checks.
drop policy if exists "members read accounts" on public.accounts;
drop policy if exists "members manage accounts" on public.accounts;
create policy "members read accounts" on public.accounts
for select to authenticated using (public.can_access_company(company_id));
create policy "members insert accounts" on public.accounts
for insert to authenticated with check (public.can_access_company(company_id));
create policy "members update accounts" on public.accounts
for update to authenticated using (public.can_access_company(company_id))
with check (public.can_access_company(company_id));
create policy "members delete accounts" on public.accounts
for delete to authenticated using (public.can_access_company(company_id));

drop policy if exists "members read cost centers" on public.cost_centers;
drop policy if exists "members manage cost centers" on public.cost_centers;
create policy "members read cost centers" on public.cost_centers
for select to authenticated using (public.can_access_company(company_id));
create policy "members insert cost centers" on public.cost_centers
for insert to authenticated with check (public.can_access_company(company_id));
create policy "members update cost centers" on public.cost_centers
for update to authenticated using (public.can_access_company(company_id))
with check (public.can_access_company(company_id));
create policy "members delete cost centers" on public.cost_centers
for delete to authenticated using (public.can_access_company(company_id));

drop policy if exists "members read parties" on public.parties;
drop policy if exists "members manage parties" on public.parties;
create policy "members read parties" on public.parties
for select to authenticated using (public.can_access_company(company_id));
create policy "members insert parties" on public.parties
for insert to authenticated with check (public.can_access_company(company_id));
create policy "members update parties" on public.parties
for update to authenticated using (public.can_access_company(company_id))
with check (public.can_access_company(company_id));
create policy "members delete parties" on public.parties
for delete to authenticated using (public.can_access_company(company_id));

drop policy if exists "members edit lines of draft entries" on public.journal_lines;
create policy "members insert lines of draft entries" on public.journal_lines
for insert to authenticated with check (
  public.can_access_company(company_id)
  and exists (select 1 from public.journal_entries e
    where e.id = journal_entry_id and e.company_id = company_id and e.status = 'draft')
);
create policy "members update lines of draft entries" on public.journal_lines
for update to authenticated using (
  public.can_access_company(company_id)
  and exists (select 1 from public.journal_entries e
    where e.id = journal_entry_id and e.company_id = company_id and e.status = 'draft')
) with check (
  public.can_access_company(company_id)
  and exists (select 1 from public.journal_entries e
    where e.id = journal_entry_id and e.company_id = company_id and e.status = 'draft')
);
create policy "members delete lines of draft entries" on public.journal_lines
for delete to authenticated using (
  public.can_access_company(company_id)
  and exists (select 1 from public.journal_entries e
    where e.id = journal_entry_id and e.company_id = company_id and e.status = 'draft')
);

-- Cover foreign keys used in joins, deletes, and account hierarchy lookups.
create index if not exists accounts_company_parent_idx on public.accounts(company_id, parent_id);
create index if not exists audit_logs_actor_idx on public.audit_logs(actor_user_id);
create index if not exists audit_logs_company_idx on public.audit_logs(company_id);
create index if not exists company_users_role_idx on public.company_users(role_id);
create index if not exists fiscal_periods_closed_by_idx on public.fiscal_periods(closed_by);
create index if not exists journal_entries_company_period_idx on public.journal_entries(company_id, fiscal_period_id);
create index if not exists journal_entries_created_by_idx on public.journal_entries(created_by);
create index if not exists journal_entries_posted_by_idx on public.journal_entries(posted_by);
create index if not exists journal_entries_reversed_entry_idx on public.journal_entries(reversed_entry_id);
create index if not exists journal_lines_company_cost_center_idx on public.journal_lines(company_id, cost_center_id);
create index if not exists journal_lines_company_entry_idx on public.journal_lines(company_id, journal_entry_id);
create index if not exists journal_lines_company_party_idx on public.journal_lines(company_id, party_id);
create index if not exists user_roles_role_idx on public.user_roles(role_id);

-- Secure first-run onboarding: one company per authenticated account.
create or replace function public.bootstrap_company(
  p_legal_name text,
  p_display_name text,
  p_fiscal_year_start date,
  p_fiscal_year_end date
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_auth_id uuid;
  v_app_user_id uuid;
  v_company_id uuid;
  v_role_id uuid;
  v_email text;
  v_full_name text;
begin
  v_auth_id := auth.uid();
  if v_auth_id is null then
    raise exception 'Authentication is required.';
  end if;
  if exists (select 1 from public.app_users where auth_subject = v_auth_id::text) then
    raise exception 'This user has already completed company onboarding.';
  end if;
  v_email := auth.jwt() ->> 'email';
  v_full_name := coalesce(nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
                          nullif(v_email, ''), 'مستخدم الشموخ');

  insert into public.app_users(auth_subject, full_name, email)
  values (v_auth_id::text, v_full_name, v_email)
  returning id into v_app_user_id;

  v_company_id := public.initialize_company(
    p_legal_name, p_display_name, p_fiscal_year_start, p_fiscal_year_end
  );

  select id into v_role_id from public.roles where code = 'owner';
  if v_role_id is null then raise exception 'Owner role is not configured.'; end if;

  insert into public.company_users(company_id, user_id, role_id)
  values (v_company_id, v_app_user_id, v_role_id);

  perform public.seed_default_chart_of_accounts(v_company_id);
  return v_company_id;
end;
$$;

revoke all on function public.bootstrap_company(text, text, date, date) from public, anon;
grant execute on function public.bootstrap_company(text, text, date, date) to authenticated;

commit;
