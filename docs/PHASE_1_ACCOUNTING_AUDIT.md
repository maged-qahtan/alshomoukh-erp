# Phase 1 accounting and technical audit

**Repository:** `maged-qahtan/alshomoukh-erp`  
**Audited baseline:** `4ce87fec185972f21c6ec1ae2e3b05db5698a1bb`  
**Review type:** Static source review of the repository tree, SQL migrations, accounting helpers, dashboard and operations components.  
**Important limitation:** This is not a live Supabase database inspection and does not prove which migrations are applied in production. No production data or schema was changed.

## Immediate finding addressed in this branch

### Sales stock availability check was outside the serialization lock

In migration `0022_atomic_invoice_posting_stock_accounting.sql`, `post_sales_invoice` read `stock_on_hand`, checked available quantities and calculated weighted cost before acquiring the company advisory transaction lock. The purchase posting function uses the same advisory lock for stock receipts. In deployments with overlapping open fiscal periods, concurrent posting transactions could therefore calculate stock from stale snapshots before entering the critical section.

**Change proposed:** migration `0027_serialize_sales_stock_availability_check.sql` acquires the same company advisory lock before stock availability and costing reads, and adds a defensive remaining-quantity check. This change is on a draft PR and has not been applied to Supabase or merged.

**Remaining coverage:** direct/manual stock movement writes must also use the same lock (or a database-side stock ledger enforcement mechanism) for a complete concurrency guarantee. A staging concurrency test is required before production use.

## Findings requiring follow-up

### P0 — Migration history and deployment reproducibility

- Multiple migration files share the same numeric version prefix: `0014`, `0015`, `0016`, `0017`, `0018`, and `0019`. This is incompatible with migration runners that require a unique version per migration. Confirm the actual Supabase migration history before renaming or consolidating anything; do not rename already-applied migrations blindly.
- The repository tree has no `0024` migration file, but the linked Supabase project's remote history contains an applied migration named `0024_atomic_sales_purchase_returns`. Recover and verify the exact source migration before attempting a fresh environment rebuild; do not fabricate a replacement from the remote name alone.
- `database/README.md` describes only the first three migrations and therefore is not a reliable deployment guide for the current schema.
- A Node test script and 10 journal-validation unit tests have now been added. CI run #135 passed `npm install`, `npm run test`, `npm run typecheck`, and `npm run build`. SQL integration, RLS, and concurrency tests are still outstanding.

### P1 — Operational accounting completeness

- `post_cash_transaction` currently accepts only `receipt` and `payment`, while the `cash_transactions` table also allows `transfer_in` and `transfer_out`. A transfer must be implemented as one atomic paired movement with a balanced journal, not as two unrelated records.
- The fixed-assets schema includes `asset_depreciation`, but the inspected application and migration set do not yet establish a complete scheduled depreciation workflow (calculation, idempotent posting, disposal, and accumulated-depreciation reporting).
- Returns are exposed in the operations UI; their full accounting and inventory reversal lifecycle needs dedicated verification, including source-document linkage, posting idempotency, and reversal behavior.
- Sales and purchase invoice posting need database-level immutability controls equivalent to posted-expense protection. Verify that posted invoice headers and lines cannot be edited or deleted through direct API calls, not merely hidden or disabled in the UI.

### P1 — Accounting report validation

- Verify trial balance opening/period/closing calculations against a known fixture including debit-normal and credit-normal accounts.
- Verify income statement period filters and cost-center filters.
- Verify balance sheet equation (assets = liabilities + equity), including current-period profit/loss and prior retained earnings.
- Verify fiscal-year carry-forward for profit and loss, including an account already used as retained earnings.
- Verify reversals are included exactly once in ledger, trial balance, income statement, and year-end close preview.
- Verify cash-flow report classification and reconciliation to cash/bank ledger balances.

### P2 — User experience and operational controls

- Add repeatable PDF and spreadsheet exports for all major reports, with date/account/party/cost-center filters.
- Add batch/expiry controls and expiry alerts for stock tracked with expiry dates.
- Add bank reconciliation, receivables/payables aging, and low-stock reporting.
- Add audit-log review screens and a tested backup/restore procedure.

## Recommended execution order

1. Remote Supabase migration history and environment boundaries have been inspected read-only. The linked project currently records migrations through `0026_expense_accounting_posting`; migrations 0027 and 0028 are not applied. The remote history includes 0024 although its source file is absent from this repository.
2. Apply the sales stock-lock migration to a disposable staging database and run concurrent sales/purchase tests.
3. Add a database test harness for posting, reversal, period closing, year-end carry-forward, RLS, and report invariants.
4. Resolve migration version uniqueness and recover the missing 0024 source based on the actual remote migration history; update the deployment guide.
5. Apply and verify the atomic cash/bank transfer migration in staging, then add the UI workflow. The migration is drafted in `0028_atomic_cash_bank_transfers.sql`; it has not been applied.
6. Complete fixed-asset depreciation and returns accounting.
7. Reconcile all financial reports to controlled test ledgers before production approval.

## Validation status

- Source review: completed for the listed baseline files.
- TypeScript/Next.js CI: run #135 passed all four steps; later CI runs for the newest commits are pending at the time of this update.
- SQL syntax/integration tests: not run against PostgreSQL.
- Staging concurrency tests: not run.
- Remote Supabase migration state: inspected read-only; current history ends at 0026.
- Production database: unchanged; no migrations applied.
- Production deployment: unchanged.
