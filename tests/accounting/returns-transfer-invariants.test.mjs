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

test("sales-return posting acquires the stock lock before journal and stock writes", async () => {
  const sql = await read("0032_serialize_sales_return_stock_writes.sql");
  const lock = sql.indexOf("perform pg_advisory_xact_lock");
  const journalWrite = sql.indexOf("insert into public.journal_entries");
  const stockWrite = sql.indexOf("insert into public.stock_movements");
  assert.ok(lock >= 0 && journalWrite > lock && stockWrite > journalWrite);
  assert.doesNotMatch(sql, /from public\.stock_on_hand/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /auth\.uid\(\) is null/i);
  assert.match(sql, /public\.current_app_user_id\(\)/i);
  assert.match(sql, /where id=r\.id and status='draft'/i);
  assert.match(sql, /revoke all on function public\.post_sales_return\(uuid\) from public,anon/i);
  assert.match(sql, /grant execute on function public\.post_sales_return\(uuid\) to authenticated/i);
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

test("sales, purchase and return posting share one company stock advisory lock", async () => {
  const files = await Promise.all([
    read("0027_serialize_sales_stock_availability_check.sql"),
    read("0029_harden_purchase_return_posting.sql"),
    read("0032_serialize_sales_return_stock_writes.sql")
  ]);
  const lock = "pg_advisory_xact_lock(hashtextextended(";
  for (const sql of files) {
    assert.ok(sql.includes(lock), "each stock writer must use the shared company advisory lock");
    assert.match(sql, /hashtextextended\([^,]+::text,\s*0\)/i);
  }
  const expressions = files.map(sql => {
    const match = sql.match(/pg_advisory_xact_lock\(hashtextextended\((\w+)\.company_id::text,\s*0\)\)/i);
    assert.ok(match, "company advisory lock must be keyed by company_id");
    return match[0].replace(match[1] + ".company_id", "<company_id>");
  });
  assert.equal(new Set(expressions).size, 1, "stock writers must use an identical advisory-lock key");
});
