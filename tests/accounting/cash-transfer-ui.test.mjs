import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ui = await readFile(new URL("../../src/app/operations.tsx", import.meta.url), "utf8");

test("cash accounts expose active state and currency for safe transfer selection", () => {
  assert.match(ui, /cash_accounts"\)\.select\("id,code,name_ar,account_type,opening_balance,ledger_account_id,currency_code,is_active"/i);
  assert.match(ui, /cashAccounts\.filter\(a=>a\.is_active&&a\.ledger_account_id/i);
});

test("cash transfer drafts are created as transfer_out without posting side effects", () => {
  assert.match(ui, /transaction_type:"transfer_out"/i);
  assert.match(ui, /تم حفظ مسودة التحويل\. لم تتغير أرصدة الحسابات بعد/i);
});

test("cash transfer posting calls the atomic database RPC with source and destination", () => {
  assert.match(ui, /rpc\("post_cash_transfer",\{p_source_transaction_id:id,p_destination_cash_account_id:destination\}\)/i);
  assert.match(ui, /row\.cash_account_id/i);
  assert.match(ui, /row\.transfer_counter_account_id/i);
});

test("cash transfer UI validates same currency and distinct ledger accounts", () => {
  assert.match(ui, /التحويل الداخلي يتطلب تطابق عملة الحسابين/i);
  assert.match(ui, /source\.ledger_account_id===destination\.ledger_account_id/i);
  assert.match(ui, /a\.id!==transferSource/i);
});

test("cash transfer posting does not use free-text destination prompts", () => {
  assert.doesNotMatch(ui, /window\.prompt\(/i);
  assert.match(ui, /حساب المصدر أو الوجهة في مسودة التحويل غير نشط أو غير موجود/i);
});

test("cash transfer UI persists destination and posts using the saved draft value", () => {
  assert.match(ui, /transfer_counter_account_id:destination\.id/i);
  assert.match(ui, /row\.transfer_counter_account_id/i);
  assert.match(ui, /select\("id,cash_account_id,transfer_counter_account_id,/i);
});
