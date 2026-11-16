import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../../database/migrations/0028_atomic_cash_bank_transfers.sql", import.meta.url),
  "utf8",
);

test("cash transfer migration has valid tagged dollar-quoted trigger function", () => {
  assert.match(migration, /as \$guard\$[\s\S]*?end;\s*\$guard\$;/i);
  assert.doesNotMatch(migration, /as \$\s*begin/i);
  assert.doesNotMatch(migration, /\n\$;\s*\n/i);
});

test("cash transfer posting is atomic and creates paired transfer rows", () => {
  assert.match(migration, /create or replace function public\.post_cash_transfer/i);
  assert.match(migration, /'transfer_in'/i);
  assert.match(migration, /'transfer_out'/i);
  assert.match(migration, /perform public\.post_journal_entry\(v_journal, v_user\)/i);
  assert.match(migration, /transfer_group_id/i);
  assert.match(migration, /for update/i);
});

test("cash transfer validates company, currency, posting accounts, and open period", () => {
  assert.match(migration, /public\.can_manage_company\(t\.company_id\)/i);
  assert.match(migration, /source_ca\.currency_code <> destination_ca\.currency_code/i);
  assert.match(migration, /a\.is_active and a\.is_posting/i);
  assert.match(migration, /status = 'open'/i);
});

test("posted cash transactions cannot be edited or deleted", () => {
  assert.match(migration, /before update or delete on public\.cash_transactions/i);
  assert.match(migration, /old\.status = 'posted'/i);
  assert.match(migration, /posted cash transactions are immutable/i);
});

test("audit record uses the source cash account currency field", () => {
  assert.match(migration, /'currency_code', source_ca\.currency_code/i);
  assert.doesNotMatch(migration, /'currency_code', t\.currency_code/i);
});

test("cash transfer posting is bound to the destination persisted on its draft", () => {
  assert.match(migration, /t\.transfer_counter_account_id is null/i);
  assert.match(migration, /t\.transfer_counter_account_id <> p_destination_cash_account_id/i);
  assert.match(migration, /destination account does not match the saved transfer draft/i);
});
