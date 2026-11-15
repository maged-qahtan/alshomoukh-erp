import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(`../../database/migrations/${name}`, import.meta.url), "utf8");

test("cash transfer uses one journal with destination debit and source credit", async () => {
  const sql = await read("0028_atomic_cash_bank_transfers.sql");
  assert.match(sql, /debit destination, credit source/i);
  assert.match(sql, /destination_ca\.ledger_account_id[\s\S]*?t\.amount, 0/i);
  assert.match(sql, /source_ca\.ledger_account_id[\s\S]*?0, t\.amount/i);
  assert.match(sql, /perform public\.post_journal_entry\(v_journal, v_user\)/i);
  assert.match(sql, /return v_journal/i);
});

test("cash transfer locks both company accounts in deterministic order", async () => {
  const sql = await read("0028_atomic_cash_bank_transfers.sql");
  assert.match(sql, /where company_id = t\.company_id[\s\S]*?id in \(t\.cash_account_id, p_destination_cash_account_id\)[\s\S]*?order by id[\s\S]*?for update/i);
  assert.match(sql, /source_ca\.currency_code <> destination_ca\.currency_code/i);
  assert.match(sql, /source_ca\.ledger_account_id = destination_ca\.ledger_account_id/i);
});

test("sales return serializes stock reads before checking returned stock", async () => {
  const sql = await read("0024_atomic_sales_purchase_returns.sql");
  const fn = sql.slice(sql.indexOf("create or replace function public.post_sales_return"), sql.indexOf("create or replace function public.post_purchase_return"));
  const lock = fn.indexOf("perform pg_advisory_xact_lock");
  const journalWrite = fn.indexOf("insert into public.journal_entries");
  const stockWrite = fn.indexOf("insert into public.stock_movements");
  assert.ok(lock >= 0 && journalWrite > lock && stockWrite > journalWrite);
  assert.doesNotMatch(fn, /from public\\.stock_on_hand/i);
});

test("sales and purchase return drafts prevent cumulative quantity above original invoice line", async () => {
  const sql = await read("0024_atomic_sales_purchase_returns.sql");
  assert.equal((sql.match(/v_used\+p_quantity>v_line\.quantity/g) || []).length, 2);
  assert.equal((sql.match(/status in \('draft','posted'\)/g) || []).length, 2);
  assert.match(sql, /for update of i,l/i);
});

test("purchase return stock check is protected by the same company lock before journal and stock movement", async () => {
  const sql = await read("0029_harden_purchase_return_posting.sql");
  const lock = sql.indexOf("perform pg_advisory_xact_lock");
  const readStock = sql.indexOf("from public.stock_on_hand");
  const reject = sql.indexOf("if v_stock<r.quantity");
  const journal = sql.indexOf("insert into public.journal_entries");
  const movement = sql.indexOf("insert into public.stock_movements");
  assert.ok(lock >= 0 && readStock > lock && reject > readStock && journal > reject && movement > journal);
});

test("return posting functions create balanced debit and credit totals through journal posting", async () => {
  const sql = await read("0024_atomic_sales_purchase_returns.sql");
  assert.match(sql, /perform public\.post_journal_entry\(v_journal,v_user\)/i);
  assert.match(sql, /r\.grand_total/);
  assert.match(sql, /r\.subtotal/);
  assert.match(sql, /r\.vat_total/);
  assert.match(sql, /quantity_in,quantity_out/);
});
