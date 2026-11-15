import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../../database/migrations/0027_serialize_sales_stock_availability_check.sql", import.meta.url),
  "utf8",
);

test("sales invoice acquires company advisory lock before stock reads", () => {
  const lock = migration.indexOf("perform pg_advisory_xact_lock");
  const stockRead = migration.indexOf("from public.stock_on_hand");
  assert.ok(lock >= 0 && stockRead > lock);
});

test("sales invoice checks remaining quantity before journal posting", () => {
  assert.match(migration, /if v_remaining > 0 then\s+raise exception 'Insufficient stock for product/i);
  const check = migration.indexOf("if v_remaining > 0 then");
  const journal = migration.indexOf("insert into public.journal_entries");
  assert.ok(check > 0 && journal > check);
});

test("sales invoice posts stock movements only after balanced journal posting", () => {
  const post = migration.indexOf("perform public.post_journal_entry");
  const movement = migration.indexOf("insert into public.stock_movements");
  assert.ok(post > 0 && movement > post);
});
