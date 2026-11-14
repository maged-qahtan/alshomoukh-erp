-- Security hardening for the initial accounting release.
begin;

-- A signed-in user may only post a journal entry under their own app profile.
create or replace function guard_journal_entry_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('posted', 'reversed') then
      raise exception 'Posted journal entries cannot be deleted.';
    end if;
    return old;
  end if;

  if old.status = 'reversed' then
    raise exception 'Reversed journal entries are immutable.';
  end if;

  if old.status = 'posted' then
    if new.status <> 'reversed'
       or current_setting('app.reversing_entry_id', true) is distinct from old.id::text then
      raise exception 'Posted journal entries are immutable; use reverse_journal_entry().';
    end if;
  end if;

  if old.status = 'draft' and new.status <> 'draft' then
    if new.status <> 'posted'
       or current_setting('app.posting_entry_id', true) is distinct from old.id::text then
      raise exception 'Draft status changes must use the controlled posting procedure.';
    end if;
    if auth.uid() is not null
       and new.posted_by is distinct from public.current_app_user_id() then
      raise exception 'posted_by must match the authenticated application user.';
    end if;
  end if;
  return new;
end;
$$;

-- The journal routines are authenticated RPC operations, not anonymous endpoints.
revoke all on function public.post_journal_entry(uuid, uuid) from public, anon;
grant execute on function public.post_journal_entry(uuid, uuid) to authenticated;

revoke all on function public.reverse_journal_entry(uuid, date, uuid, uuid) from public, anon;
grant execute on function public.reverse_journal_entry(uuid, date, uuid, uuid) to authenticated;

-- Company creation is an administrative provisioning operation; do not expose it as a public RPC.
revoke all on function public.initialize_company(text, text, date, date) from public, anon, authenticated;

-- Chart seeding is safe for authenticated users only when the account-table RLS policy
-- confirms membership in the supplied company.
revoke all on function public.seed_default_chart_of_accounts(uuid) from public, anon;
grant execute on function public.seed_default_chart_of_accounts(uuid) to authenticated;

-- Helpers are only needed by authenticated RLS policies.
revoke all on function public.current_app_user_id() from public, anon;
grant execute on function public.current_app_user_id() to authenticated;
revoke all on function public.can_access_company(uuid) from public, anon;
grant execute on function public.can_access_company(uuid) to authenticated;

-- Permit an authenticated member to append audit events only as their own app identity.
create policy "members append own audit events" on public.audit_logs
for insert to authenticated
with check (
  public.can_access_company(company_id)
  and actor_user_id = public.current_app_user_id()
);

-- Audit events are append-only.
create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'Audit log records are append-only.';
end;
$$;

revoke all on function public.prevent_audit_log_mutation() from public, anon, authenticated;
create trigger audit_logs_immutable
before update or delete on public.audit_logs
for each row execute function public.prevent_audit_log_mutation();

grant select on public.general_ledger, public.trial_balance, public.income_statement_accounts to authenticated;

commit;
