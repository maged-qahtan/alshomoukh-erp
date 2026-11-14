-- Supabase Auth integration and company-scoped Row Level Security.
-- Apply after migrations 0001-0003. Run as the database owner in Supabase SQL Editor.
begin;

create table if not exists company_users (
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  role_id uuid not null references roles(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create index if not exists company_users_user_idx on company_users(user_id, company_id);

create or replace function current_app_user_id()
returns uuid
language sql stable security definer
set search_path = pg_catalog
as $
  select id from public.app_users
  where auth_subject = auth.uid()::text and is_active = true
  limit 1
$$;

create or replace function can_access_company(target_company_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog
as $
  select exists (
    select 1 from public.company_users cu
    where cu.company_id = target_company_id
      and cu.user_id = public.current_app_user_id()
      and cu.is_active = true
  )
$$;

revoke all on function current_app_user_id() from public;
revoke all on function can_access_company(uuid) from public;
grant execute on function current_app_user_id() to authenticated;
grant execute on function can_access_company(uuid) to authenticated;

alter table companies enable row level security;
alter table app_users enable row level security;
alter table roles enable row level security;
alter table user_roles enable row level security;
alter table company_users enable row level security;
alter table fiscal_periods enable row level security;
alter table accounts enable row level security;
alter table cost_centers enable row level security;
alter table parties enable row level security;
alter table journal_entries enable row level security;
alter table journal_lines enable row level security;
alter table audit_logs enable row level security;

create policy "users read own profile" on app_users
for select to authenticated
using (auth_subject = auth.uid()::text);

create policy "authenticated read role definitions" on roles
for select to authenticated using (true);

create policy "users read own role links" on user_roles
for select to authenticated
using (user_id = current_app_user_id());

create policy "users read own company memberships" on company_users
for select to authenticated
using (user_id = current_app_user_id());

create policy "members read company" on companies
for select to authenticated
using (can_access_company(id));

create policy "members read fiscal periods" on fiscal_periods
for select to authenticated
using (can_access_company(company_id));

create policy "members read accounts" on accounts
for select to authenticated
using (can_access_company(company_id));

create policy "members manage accounts" on accounts
for all to authenticated
using (can_access_company(company_id))
with check (can_access_company(company_id));

create policy "members read cost centers" on cost_centers
for select to authenticated
using (can_access_company(company_id));

create policy "members manage cost centers" on cost_centers
for all to authenticated
using (can_access_company(company_id))
with check (can_access_company(company_id));

create policy "members read parties" on parties
for select to authenticated
using (can_access_company(company_id));

create policy "members manage parties" on parties
for all to authenticated
using (can_access_company(company_id))
with check (can_access_company(company_id));

create policy "members read journal entries" on journal_entries
for select to authenticated
using (can_access_company(company_id));

create policy "members create draft journal entries" on journal_entries
for insert to authenticated
with check (can_access_company(company_id) and status = 'draft');

create policy "members update company journal entries" on journal_entries
for update to authenticated
using (can_access_company(company_id))
with check (can_access_company(company_id));

create policy "members read journal lines" on journal_lines
for select to authenticated
using (can_access_company(company_id));

create policy "members edit lines of draft entries" on journal_lines
for all to authenticated
using (
  can_access_company(company_id)
  and exists (
    select 1 from journal_entries e
    where e.id = journal_entry_id and e.company_id = company_id and e.status = 'draft'
  )
)
with check (
  can_access_company(company_id)
  and exists (
    select 1 from journal_entries e
    where e.id = journal_entry_id and e.company_id = company_id and e.status = 'draft'
  )
);

create policy "members read audit log" on audit_logs
for select to authenticated
using (can_access_company(company_id));

commit;

-- Provisioning note:
-- 1) Create the user in Supabase Auth.
-- 2) As a trusted administrator, insert app_users(auth_subject, full_name, email).
--    auth_subject must equal the Supabase Auth user's UUID string.
-- 3) Insert company_users(company_id, user_id, role_id) for the permitted company.
-- Never expose the service-role key in the browser.
