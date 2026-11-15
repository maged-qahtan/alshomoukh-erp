import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../../database/migrations/0031_fixed_asset_disposal_posting.sql", import.meta.url),
  "utf8",
);

test("asset disposal is unique per company asset and immutable after posting", () => {
  assert.match(migration, /unique\(company_id,asset_id\)/i);
  assert.match(migration, /before update or delete on public\.fixed_asset_disposals/i);
  assert.match(migration, /Posted asset disposals are immutable/i);
});

test("asset disposal requires authorization, active asset and open fiscal period", () => {
  assert.match(migration, /auth\.uid\(\) is null/i);
  assert.match(migration, /public\.can_manage_company\(a\.company_id\)/i);
  assert.match(migration, /if not a\.is_active then/i);
  assert.match(migration, /status='open'/i);
});

test("disposal closes asset cost and accumulated depreciation", () => {
  assert.match(migration, /code='1201'/i);
  assert.match(migration, /code='1202'/i);
  assert.match(migration, /v_accumulated_account,'إقفال مجمع إهلاك الأصل/);
  assert.match(migration, /v_asset_account,'إقفال تكلفة الأصل/);
});

test("disposal calculates balanced gain or loss and posts the journal", () => {
  assert.match(migration, /v_gain:=greatest\(p_proceeds-v_book_value,0\)/i);
  assert.match(migration, /v_loss:=greatest\(v_book_value-p_proceeds,0\)/i);
  assert.match(migration, /code='4201'/i);
  assert.match(migration, /code='5205'/i);
  assert.match(migration, /perform public\.post_journal_entry\(v_journal,v_user\)/i);
});

test("successful disposal deactivates asset and writes audit log", () => {
  assert.match(migration, /update public\.fixed_assets set is_active=false/i);
  assert.match(migration, /'fixed_asset\.disposed'/i);
});
