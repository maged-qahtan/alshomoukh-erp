# Cash and bank transfer rollout

## Scope

Migration `0028_atomic_cash_bank_transfers.sql` adds the database posting workflow for an internal transfer between two cash/bank accounts in the same company and currency.

A transfer is represented by:
- one draft `cash_transactions` row with `transaction_type = 'transfer_out'`;
- one generated `transfer_in` row for the destination account;
- one balanced journal entry (debit destination ledger account, credit source ledger account);
- one shared `transfer_group_id` and journal entry ID on both transaction rows.

The RPC is:

```sql
select public.post_cash_transfer(
  p_source_transaction_id := '<draft-transfer-out-uuid>',
  p_destination_cash_account_id := '<destination-cash-account-uuid>'
);
```

The RPC validates company authorization, source/destination account status and ledger mappings, same-currency requirement, distinct accounts, open fiscal period, and draft-only posting. It locks the source transaction and both cash accounts, posts the journal and both cash movements in one database transaction, and records an audit event. A retry cannot post the same source row twice.

Posted cash transactions are immutable. Corrections must use a documented reversal workflow; direct editing/deletion is rejected.

## Repository and database status

- The transfer UI was merged into `main` in PR #4. The old statement that it remains only on `development/cash-bank-transfer-ui` is obsolete.
- The UI merge and a successful CI run do not apply database migrations.
- The linked Supabase project was checked read-only and currently records migrations only through `0026_expense_accounting_posting`.
- Migrations `0027_serialize_sales_stock_availability_check.sql` and `0028_atomic_cash_bank_transfers.sql` are not recorded in that database.
- Therefore the transfer feature is present in the repository but is **not verified or approved for production use** against the linked database schema.
- No migration or production database change was made as part of this documentation update.

## Required rollout order

1. Provision a separate staging Supabase project. Do not use production data for these tests.
2. Resolve and document the duplicate migration sequence numbers in the repository and validate a clean database bootstrap path.
3. Apply migration `0027_serialize_sales_stock_availability_check.sql` to staging.
4. Apply migration `0028_atomic_cash_bank_transfers.sql` to staging.
5. Verify the schema, RPC signature, grants, and generated database types.
6. Run every staging check below, including negative authorization, retry/idempotency, and concurrent transfer tests.
7. Only after staging acceptance, plan the production migration and UI release with backup and rollback steps. Production changes require separate explicit approval.

Do not enable or rely on the transfer UI against a database that lacks the transfer columns and RPC. The UI creates `transfer_out` drafts and calls `post_cash_transfer` only when the user explicitly posts the draft; the destination account must match the destination persisted on the draft.

## Staging verification checklist

Use two active cash/bank accounts in one company, each linked to a different active posting ledger account, and an open fiscal period covering the test date.

- [ ] Post a valid transfer: exactly two cash transaction rows exist (one `transfer_out`, one `transfer_in`) with the same transfer group and journal entry.
- [ ] Verify journal debit equals credit and equals the transfer amount.
- [ ] Verify destination ledger account is debited and source ledger account is credited.
- [ ] Verify both transaction rows are posted and carry the same journal entry ID.
- [ ] Retry the RPC: it must reject the already-posted source transaction without creating another journal or destination row.
- [ ] Reject same source and destination account.
- [ ] Reject inactive or unlinked cash/bank accounts.
- [ ] Reject cross-company destination accounts.
- [ ] Reject different currencies.
- [ ] Reject a date outside an open fiscal period.
- [ ] Reject a non-draft source row or a row that is not `transfer_out`.
- [ ] Attempt to update/delete either posted transfer row: the immutability trigger must reject it.
- [ ] Verify unauthorized users cannot post the transfer.
- [ ] Verify the audit log contains the transfer group, both transaction IDs, journal ID, accounts, amount, and currency.
- [ ] Run two simultaneous attempts against the same draft: at most one may post.
- [ ] Run opposite-direction transfers between the same two accounts concurrently: no duplicate posting or unhandled deadlock.

## Current environment status

The linked Supabase project migration history was inspected read-only. It currently contains migrations through `0026_expense_accounting_posting`; migrations 0027 and 0028 are not recorded there. No database migration has been applied by this change. Do not apply 0028 before 0027, and do not apply either to production before staging verification and separate approval.
