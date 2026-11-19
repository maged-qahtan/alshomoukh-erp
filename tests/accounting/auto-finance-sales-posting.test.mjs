import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../database/auto-finance-migrations/", import.meta.url);
const foundation = await readFile(new URL("20261119164829_add_atomic_daily_sales_posting.sql", root), "utf8");
const posting = await readFile(new URL("20261119164851_correct_daily_sales_gross_revenue_balancing.sql", root), "utf8");
const allocationGuard = await readFile(new URL("20261119164912_restrict_daily_sales_to_credit_revenue_accounts.sql", root), "utf8");
const ui = await readFile(new URL("../../src/app/auto-finance-sales.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../../src/app/auto-finance-dashboard.tsx", import.meta.url), "utf8");

test("daily sales posting is tenant-scoped, authenticated, and invoker-secured", () => {
  assert.match(posting, /security invoker/i);
  assert.match(posting, /auth\.uid\(\)/i);
  assert.match(posting, /private\.can_access_company\(p_company_id,true\)/i);
  assert.match(posting, /revoke all on function public\.record_daily_sale[\s\S]*from public,anon/i);
  assert.match(posting, /to authenticated/i);
});

test("daily sales use net tenders plus contra-revenue debits to balance gross revenue", () => {
  assert.match(posting, /v_revenue:=v_collected\+p_discounts\+p_returns/i);
  assert.match(posting, /'4190'/i);
  assert.match(posting, /'4191'/i);
  assert.match(posting, /public\.create_journal_entry_draft/i);
  assert.match(posting, /public\.post_journal_entry/i);
  assert.match(posting, /set_config\('app\.allow_daily_sale_post'/i);
});

test("daily sales validate revenue allocations and company branch", () => {
  assert.match(posting, /v_allocated<>v_revenue/i);
  assert.match(allocationGuard, /a\.normal_balance<>'credit'/i);
  assert.match(posting, /a\.account_class<>'revenue'/i);
  assert.match(posting, /b\.company_id=p_company_id and b\.is_active/i);
  assert.match(posting, /insert into public\.daily_sale_allocations/i);
});

test("posted daily sales are immutable and direct posting is guarded", () => {
  assert.match(foundation, /before update or delete on public\.daily_sales/i);
  assert.match(foundation, /old\.status='posted'/i);
  assert.match(foundation, /app\.allow_daily_sale_post/i);
});

test("sales UI calls the atomic RPC and is reachable from the isolated workspace", () => {
  assert.match(ui, /supabase\.rpc\("record_daily_sale"/i);
  assert.match(ui, /p_allocations:/i);
  assert.match(ui, /مبيعات يومية|المبيعات اليومية/);
  assert.match(dashboard, /AutoFinanceSales/);
  assert.match(dashboard, /active === "sales"/);
});
