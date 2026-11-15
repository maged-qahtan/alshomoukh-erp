import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function migration(name) {
  return readFile(new URL(`../../database/migrations/${name}`, import.meta.url), "utf8");
}

test("journal posting and period closure serialize on the same fiscal-period row", async () => {
  const posting = await migration("0017_serialize_posting_with_period_close.sql");
  const closing = await migration("0020_secure_close_fiscal_period_invoker_rls.sql");
  assert.match(posting, /from public\.fiscal_periods[\s\S]*?for update/i);
  assert.match(posting, /period_row\.status <> 'open'/i);
  assert.match(posting, /entry_row\.entry_date < period_row\.starts_on[\s\S]*?entry_row\.entry_date > period_row\.ends_on/i);
  assert.match(closing, /from public\.fiscal_periods where id=p_fiscal_period_id for update/i);
});

test("period close rejects premature closure, drafts, unbalanced entries and out-of-range entries", async () => {
  const sql = await migration("0020_secure_close_fiscal_period_invoker_rls.sql");
  assert.match(sql, /v_period\.ends_on >= current_date/i);
  assert.match(sql, /status='draft'/i);
  assert.match(sql, /having count\(l\.id\)<2[\s\S]*?sum\(l\.debit\)[\s\S]*?sum\(l\.credit\)/i);
  assert.match(sql, /v_out_of_range>0/i);
  assert.match(sql, /v_debits<>v_credits/i);
  assert.match(sql, /fiscal_period\.closed/i);
});

test("period close is permission-scoped and uses invoker security", async () => {
  const sql = await migration("0020_secure_close_fiscal_period_invoker_rls.sql");
  assert.match(sql, /security invoker/i);
  assert.match(sql, /public\.can_manage_company\(v_period\.company_id\)/i);
  assert.match(sql, /revoke all on function public\.close_fiscal_period\(uuid\) from public,anon/i);
  assert.match(sql, /grant execute on function public\.close_fiscal_period\(uuid\) to authenticated/i);
});

test("year-end preview is read-only and requires a closed period", async () => {
  const sql = await migration("0018_fiscal_year_close_preview.sql");
  assert.match(sql, /security invoker/i);
  assert.match(sql, /v_period\.status <> 'closed'/i);
  assert.match(sql, /'net_income'/i);
  assert.match(sql, /'income_accounts'/i);
  assert.match(sql, /'balance_sheet_accounts'/i);
  assert.doesNotMatch(sql, /insert into public\.journal_entries/i);
});

test("next-year opening draft carries net income with expenses reducing profit", async () => {
  const sql = await migration("0019_correct_fiscal_year_carryforward_net_income.sql");
  assert.match(sql, /when a\.type='revenue' then t\.credit_total-t\.debit_total/i);
  assert.match(sql, /when a\.type='expense' then -\(t\.debit_total-t\.credit_total\)/i);
  assert.match(sql, /v_debit<>v_credit/i);
  assert.match(sql, /public\.save_opening_balance_draft/i);
  assert.match(sql, /'status','draft'/i);
  assert.match(sql, /The next fiscal period already exists/i);
});
