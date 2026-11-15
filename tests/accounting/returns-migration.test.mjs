import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../../database/migrations/0024_atomic_sales_purchase_returns.sql", import.meta.url),
  "utf8",
);

test("reconstructed returns migration defines both return ledgers", () => {
  assert.match(migration, /create table if not exists public\.sales_returns/i);
  assert.match(migration, /create table if not exists public\.purchase_returns/i);
  assert.match(migration, /unique\(company_id, return_number\)/i);
});

test("returns migration defines draft creation and controlled posting RPCs", () => {
  for (const fn of [
    "create_sales_return_draft",
    "create_purchase_return_draft",
    "post_sales_return",
    "post_purchase_return",
  ]) assert.match(migration, new RegExp(`create or replace function public\\.${fn}`, "i"));
});

test("returns tables are protected by company-scoped RLS", () => {
  assert.match(migration, /alter table public\.sales_returns enable row level security/i);
  assert.match(migration, /alter table public\.purchase_returns enable row level security/i);
  assert.equal((migration.match(/public\.can_manage_company\(company_id\)/g) || []).length, 4);
});

test("return RPCs enforce authentication and company authorization", () => {
  assert.equal((migration.match(/auth\.uid\(\) is null/g) || []).length, 4);
  assert.equal((migration.match(/public\.can_manage_company\(p_company_id\)/g) || []).length, 2);
});

test("return RPC execute privileges are limited to authenticated users", () => {
  assert.match(migration, /revoke all on function public\.post_sales_return\(uuid\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.post_purchase_return\(uuid\) to authenticated/i);
});
