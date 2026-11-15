import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../../database/migrations/0029_harden_purchase_return_posting.sql", import.meta.url),
  "utf8",
);

test("purchase return acquires company stock lock before availability read", () => {
  const lock = migration.indexOf("perform pg_advisory_xact_lock");
  const stockRead = migration.indexOf("from public.stock_on_hand");
  assert.ok(lock >= 0 && stockRead > lock);
});

test("purchase return checks available stock before posting journal", () => {
  const stockRead = migration.indexOf("from public.stock_on_hand");
  const stockGuard = migration.indexOf("if v_stock<r.quantity");
  const journal = migration.indexOf("insert into public.journal_entries");
  assert.ok(stockRead >= 0 && stockGuard > stockRead && journal > stockGuard);
});

test("posted returns are protected against update and delete", () => {
  assert.match(migration, /before update or delete on public\.sales_returns/i);
  assert.match(migration, /before update or delete on public\.purchase_returns/i);
  assert.match(migration, /old\.status = 'posted'/i);
});

test("purchase return posting is authenticated and idempotent", () => {
  assert.match(migration, /auth\.uid\(\) is null/i);
  assert.match(migration, /r\.status<>'draft' or r\.journal_entry_id is not null/i);
  assert.match(migration, /if not found then raise exception 'Purchase return changed during posting'/i);
});
