-- Remove the stale explicit anon grants discovered in the live ACL audit.
-- Authenticated users retain access; service_role grants are left unchanged.
begin;

revoke all on function public.update_draft_journal_entry(uuid, date, text, jsonb) from anon;
revoke all on function public.save_opening_balance_draft(uuid, uuid, jsonb) from anon;

grant execute on function public.update_draft_journal_entry(uuid, date, text, jsonb) to authenticated;
grant execute on function public.save_opening_balance_draft(uuid, uuid, jsonb) to authenticated;

commit;
