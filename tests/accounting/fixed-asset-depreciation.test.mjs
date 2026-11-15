import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../../database/migrations/0030_fixed_asset_depreciation_posting.sql", import.meta.url),
  "utf8",
);

test("depreciation accepts only complete calendar months", () => {
  assert.match(migration, /p_period_start <> date_trunc\('month', p_period_start\)::date/i);
  assert.match(migration, /p_period_end <> \(date_trunc\('month', p_period_start\) \+ interval '1 month - 1 day'\)::date/i);
});

test("depreciation is idempotent per asset and month", () => {
  assert.match(migration, /perform pg_advisory_xact_lock/i);
  assert.match(migration, /period_start=p_period_start and period_end=p_period_end/i);
  assert.match(migration, /if v_existing is not null then\s+return v_existing/i);
});

test("depreciation uses straight-line basis and does not exceed residual value", () => {
  assert.match(migration, /a\.acquisition_cost - a\.residual_value/i);
  assert.match(migration, /v_monthly := round\(v_remaining_basis \/ a\.useful_life_months,2\)/i);
  assert.match(migration, /least\(v_monthly, greatest\(v_remaining_basis-v_accumulated,0\)\)/i);
});

test("depreciation posts expense against accumulated depreciation", () => {
  assert.match(migration, /code='5204'/i);
  assert.match(migration, /code='1202'/i);
  assert.match(migration, /perform public\.post_journal_entry\(v_journal,v_user\)/i);
  assert.match(migration, /insert into public\.asset_depreciation/i);
});

test("asset balance view reports accumulated depreciation and net book value", () => {
  assert.match(migration, /create or replace view public\.fixed_asset_balances/i);
  assert.match(migration, /as accumulated_depreciation/i);
  assert.match(migration, /as net_book_value/i);
});
