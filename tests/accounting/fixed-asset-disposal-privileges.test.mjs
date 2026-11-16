import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../../database/migrations/0034_restrict_asset_disposal_writes_to_rpc.sql", import.meta.url), "utf8");
const base = await readFile(new URL("../../database/migrations/0031_fixed_asset_disposal_posting.sql", import.meta.url), "utf8");

test("asset disposal table is read-only to authenticated users", () => {
  assert.match(sql, /revoke insert, update, delete on public\.fixed_asset_disposals from authenticated/i);
  assert.match(sql, /grant select on public\.fixed_asset_disposals to authenticated/i);
  assert.match(sql, /drop policy if exists fixed_asset_disposals_manager_insert/i);
  assert.match(sql, /drop policy if exists fixed_asset_disposals_manager_update/i);
  assert.match(sql, /drop policy if exists fixed_asset_disposals_manager_delete/i);
});

test("asset disposal posting remains an authenticated, company-authorized atomic RPC", () => {
  assert.match(base, /create or replace function public\.post_fixed_asset_disposal\([\s\S]*?if auth\.uid\(\) is null then/i);
  assert.match(base, /not public\.can_manage_company\(a\.company_id\)/i);
  assert.match(base, /perform public\.post_journal_entry\(v_journal,v_user\)/i);
  assert.match(base, /update public\.fixed_assets set is_active=false/i);
  assert.match(sql, /alter function public\.post_fixed_asset_disposal\(uuid, date, numeric, uuid\)\s+security definer/i);
  assert.match(sql, /set search_path = pg_catalog, public, auth/i);
  assert.match(sql, /grant execute on function public\.post_fixed_asset_disposal\(uuid, date, numeric, uuid\)\s+to authenticated/i);
});
