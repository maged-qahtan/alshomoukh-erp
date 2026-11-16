import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("journal draft RPCs revoke anonymous execution without removing authenticated access", async () => {
  const sql = await readFile(
    new URL("../../database/migrations/0035_revoke_anon_journal_rpc.sql", import.meta.url),
    "utf8",
  );

  for (const signature of [
    "public.update_draft_journal_entry(uuid, date, text, jsonb)",
    "public.save_opening_balance_draft(uuid, uuid, jsonb)",
  ]) {
    assert.match(
      sql,
      new RegExp("revoke all on function " + signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " from anon", "i"),
    );
    assert.match(
      sql,
      new RegExp("grant execute on function " + signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " to authenticated", "i"),
    );
  }

  assert.match(sql, /begin\s*;/i);
  assert.match(sql, /commit\s*;/i);
  assert.doesNotMatch(sql, /from\s+public\s*,\s*authenticated/i);
});
