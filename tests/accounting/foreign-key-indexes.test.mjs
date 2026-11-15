import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("performance migration adds indexes for every uncovered foreign key", async () => {
  const sql = await readFile(
    new URL("../../database/migrations/0033_index_uncovered_foreign_keys.sql", import.meta.url),
    "utf8",
  );
  const expected = [
    ["cash_accounts", "company_id, ledger_account_id"],
    ["cash_transactions", "company_id, contra_account_id"],
    ["cash_transactions", "journal_entry_id"],
    ["cash_transactions", "posted_by"],
    ["expenses", "company_id, cost_center_id"],
    ["expenses", "company_id, expense_account_id"],
    ["expenses", "company_id, journal_entry_id"],
    ["purchase_invoices", "journal_entry_id"],
    ["purchase_invoices", "posted_by"],
    ["purchase_returns", "created_by"],
    ["purchase_returns", "journal_entry_id"],
    ["purchase_returns", "original_invoice_id"],
    ["purchase_returns", "original_line_id"],
    ["purchase_returns", "posted_by"],
    ["purchase_returns", "product_id"],
    ["purchase_returns", "warehouse_id"],
    ["sales_invoices", "journal_entry_id"],
    ["sales_invoices", "posted_by"],
    ["sales_returns", "created_by"],
    ["sales_returns", "journal_entry_id"],
    ["sales_returns", "original_invoice_id"],
    ["sales_returns", "original_line_id"],
    ["sales_returns", "posted_by"],
    ["sales_returns", "product_id"],
    ["sales_returns", "warehouse_id"],
  ];

  for (const [table, columns] of expected) {
    const columnPattern = columns.split(", ").join("\\s*,\\s*");
    const pattern = new RegExp(
      `create index if not exists [a-z0-9_]+\\\\s+on public\\\\.${table}\\\\s*\\\\(\\\\s*${columnPattern}\\\\s*\\\\)`,
      "i",
    );
    assert.match(sql, pattern, `missing index for ${table}(${columns})`);
  }
  assert.equal((sql.match(/create index if not exists/gi) || []).length, expected.length);
});
