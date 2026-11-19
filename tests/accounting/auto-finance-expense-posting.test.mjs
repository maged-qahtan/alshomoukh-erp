import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const posting = await readFile(
  new URL("../../database/auto-finance-migrations/20261119162719_add_atomic_daily_expense_posting.sql", import.meta.url),
  "utf8",
);
const guard = await readFile(
  new URL("../../database/auto-finance-migrations/20261119162800_guard_posted_daily_expenses.sql", import.meta.url),
  "utf8",
);

test("AUTO-FINANCE expense posting is tenant-scoped and invoker-secured", () => {
  assert.match(posting, /security invoker/i);
  assert.match(posting, /private\.can_access_company\(p_company_id,true\)/i);
  assert.match(posting, /auth\.uid\(\)/i);
  assert.match(posting, /revoke all on function public\.record_daily_expense[\s\S]*from public,anon/i);
  assert.match(posting, /to authenticated/i);
});

test("daily expense posting creates a balanced journal and posts atomically", () => {
  assert.match(posting, /public\.create_journal_entry_draft/i);
  assert.match(posting, /public\.post_journal_entry/i);
  assert.match(posting, /jsonb_build_array[\s\S]*'debit',[\s\S]*'credit'/i);
  assert.match(posting, /update public\.daily_expenses[\s\S]*status='posted'/i);
});

test("expense posting validates branch, ledger classes, amount, and payment method", () => {
  assert.match(posting, /b\.company_id=p_company_id and b\.is_active/i);
  assert.match(posting, /'expense','cost_of_revenue','other_expense'/i);
  assert.match(posting, /p_amount<=0/i);
  assert.match(posting, /'cash','bank','credit','other'/i);
});

test("posted daily expenses cannot be changed or deleted or posted directly", () => {
  assert.match(guard, /before update or delete on public\.daily_expenses/i);
  assert.match(guard, /old\.status='posted'/i);
  assert.match(guard, /app\.allow_daily_expense_post/i);
  assert.match(guard, /set_config\('app\.allow_daily_expense_post'/i);
});
