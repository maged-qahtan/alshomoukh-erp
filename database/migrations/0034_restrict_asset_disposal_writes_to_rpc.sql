-- Restrict fixed-asset disposal writes to the validated atomic posting RPC.
-- Direct table inserts could otherwise create a disposal marker without deactivating
-- the asset or creating its balanced journal entry.
begin;

drop policy if exists fixed_asset_disposals_manager_insert on public.fixed_asset_disposals;
drop policy if exists fixed_asset_disposals_manager_update on public.fixed_asset_disposals;
drop policy if exists fixed_asset_disposals_manager_delete on public.fixed_asset_disposals;

revoke insert, update, delete on public.fixed_asset_disposals from authenticated;
grant select on public.fixed_asset_disposals to authenticated;

-- The RPC performs explicit auth.uid() and can_manage_company() checks before
-- writing the disposal, journal, asset state, and audit log in one transaction.
-- SECURITY DEFINER is required because authenticated users no longer have
-- direct table-write privileges.
alter function public.post_fixed_asset_disposal(uuid, date, numeric, uuid)
  security definer;
alter function public.post_fixed_asset_disposal(uuid, date, numeric, uuid)
  set search_path = pg_catalog, public, auth;

revoke all on function public.post_fixed_asset_disposal(uuid, date, numeric, uuid)
  from public, anon;
grant execute on function public.post_fixed_asset_disposal(uuid, date, numeric, uuid)
  to authenticated;

commit;
