-- Enforce company role permissions on all accounting writes.
begin;
create or replace function public.can_manage_company(target_company_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.company_users cu
    join public.roles r on r.id = cu.role_id
    where cu.company_id = target_company_id
      and cu.user_id = public.current_app_user_id()
      and cu.is_active = true
      and r.code in ('owner','accountant')
  )
$$;
revoke all on function public.can_manage_company(uuid) from public, anon;
grant execute on function public.can_manage_company(uuid) to authenticated;

-- Accounts: all members can read; only owners/accountants can write.
drop policy if exists "members insert accounts" on public.accounts;
drop policy if exists "members update accounts" on public.accounts;
drop policy if exists "members delete accounts" on public.accounts;
create policy "managers insert accounts" on public.accounts
for insert to authenticated with check (public.can_manage_company(company_id));
create policy "managers update accounts" on public.accounts
for update to authenticated using (public.can_manage_company(company_id))
with check (public.can_manage_company(company_id));
create policy "managers delete accounts" on public.accounts
for delete to authenticated using (public.can_manage_company(company_id));

drop policy if exists "members insert cost centers" on public.cost_centers;
drop policy if exists "members update cost centers" on public.cost_centers;
drop policy if exists "members delete cost centers" on public.cost_centers;
create policy "managers insert cost centers" on public.cost_centers
for insert to authenticated with check (public.can_manage_company(company_id));
create policy "managers update cost centers" on public.cost_centers
for update to authenticated using (public.can_manage_company(company_id))
with check (public.can_manage_company(company_id));
create policy "managers delete cost centers" on public.cost_centers
for delete to authenticated using (public.can_manage_company(company_id));

drop policy if exists "members insert parties" on public.parties;
drop policy if exists "members update parties" on public.parties;
drop policy if exists "members delete parties" on public.parties;
create policy "managers insert parties" on public.parties
for insert to authenticated with check (public.can_manage_company(company_id));
create policy "managers update parties" on public.parties
for update to authenticated using (public.can_manage_company(company_id))
with check (public.can_manage_company(company_id));
create policy "managers delete parties" on public.parties
for delete to authenticated using (public.can_manage_company(company_id));

drop policy if exists "members create draft journal entries" on public.journal_entries;
drop policy if exists "members update company journal entries" on public.journal_entries;
create policy "managers create draft journal entries" on public.journal_entries
for insert to authenticated
with check (public.can_manage_company(company_id) and status = 'draft');
create policy "managers update company journal entries" on public.journal_entries
for update to authenticated
using (public.can_manage_company(company_id))
with check (public.can_manage_company(company_id));

drop policy if exists "members insert lines of draft entries" on public.journal_lines;
drop policy if exists "members update lines of draft entries" on public.journal_lines;
drop policy if exists "members delete lines of draft entries" on public.journal_lines;
create policy "managers insert lines of draft entries" on public.journal_lines
for insert to authenticated with check (
  public.can_manage_company(company_id)
  and exists (select 1 from public.journal_entries e
    where e.id = public.journal_lines.journal_entry_id
      and e.company_id = public.journal_lines.company_id and e.status = 'draft')
);
create policy "managers update lines of draft entries" on public.journal_lines
for update to authenticated using (
  public.can_manage_company(company_id)
  and exists (select 1 from public.journal_entries e
    where e.id = public.journal_lines.journal_entry_id
      and e.company_id = public.journal_lines.company_id and e.status = 'draft')
) with check (
  public.can_manage_company(company_id)
  and exists (select 1 from public.journal_entries e
    where e.id = public.journal_lines.journal_entry_id
      and e.company_id = public.journal_lines.company_id and e.status = 'draft')
);
create policy "managers delete lines of draft entries" on public.journal_lines
for delete to authenticated using (
  public.can_manage_company(company_id)
  and exists (select 1 from public.journal_entries e
    where e.id = public.journal_lines.journal_entry_id
      and e.company_id = public.journal_lines.company_id and e.status = 'draft')
);

drop policy if exists "members append own audit events" on public.audit_logs;
create policy "managers append own audit events" on public.audit_logs
for insert to authenticated
with check (
  public.can_manage_company(company_id)
  and actor_user_id = public.current_app_user_id()
);
commit;
