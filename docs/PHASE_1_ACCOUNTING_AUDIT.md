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
- The original `0024` file was missing from GitHub although the linked Supabase project had applied it. A recovery source file is now reconstructed from read-only catalog evidence: live table columns/types/defaults, constraints, indexes, RLS policies, grants, and the four deployed function definitions. This is a catalog-derived reconstruction, not a byte-for-byte recovery of the historical file; compare its behavior on a disposable database before treating it as canonical.
- `database/README.md` describes only the first three migrations and therefore is not a reliable deployment guide for the current schema.
- A Node test script and 10 journal-validation unit tests have now been added. CI run #135 passed `npm install`, `npm run test`, `npm run typecheck`, and `npm run build`. SQL integration, RLS, and concurrency tests are still outstanding.

### P1 — Operational accounting completeness

- `post_cash_transaction` accepts only `receipt` and `payment`, while `cash_transactions` also allows `transfer_in` and `transfer_out`. A new atomic transfer RPC is drafted in `0028_atomic_cash_bank_transfers.sql`; it creates paired movements and one balanced journal. The cash UI is intentionally not wired to it until the database migration is tested and applied.
- Migration `0030_fixed_asset_depreciation_posting.sql` now adds monthly straight-line depreciation posting through accounts 5204/1202, idempotency per asset/month, residual-value cap, fiscal-period checks, audit logging, and a `fixed_asset_balances` view for accumulated depreciation and net book value. Migration `0031_fixed_asset_disposal_posting.sql` now adds controlled disposal with accumulated-depreciation clearing, cash proceeds, gain/loss recognition, audit logging, and asset deactivation. The operations UI now exposes monthly depreciation posting, book-value reporting, and disposal entry/history. These workflows depend on migrations 0030–0031 being applied after staging validation.
- Returns are exposed in the operations UI and the four live return RPC definitions plus both table schemas are now represented in reconstructed migration `0024_atomic_sales_purchase_returns.sql`. Catalog review found follow-up risks: sales return posting reads stock before acquiring the advisory lock, and its `v_onhand` result is not used to validate stock; purchase return checks stock before acquiring the lock. Migration `0029_harden_purchase_return_posting.sql` now moves the company advisory lock ahead of the stock availability read, checks the stock quantity under that lock, adds a post-status race guard, and protects posted returns from direct update/delete. Static regression tests were added; PostgreSQL staging/concurrency tests are still required.
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

1. Remote Supabase migration history and environment boundaries have been inspected read-only. The linked project currently records migrations through `0026_expense_accounting_posting`; migrations 0027 and 0028 are not applied. The missing 0024 source has been reconstructed from the live catalog, but still requires a clean-database comparison.
2. Apply the sales stock-lock migration to a disposable staging database and run concurrent sales/purchase tests.
3. Add a database test harness for posting, reversal, period closing, year-end carry-forward, RLS, and report invariants.
4. Resolve migration version uniqueness based on remote migration history; compare reconstructed 0024 against a clean database before approving fresh installs.
5. Apply and verify migrations 0027–0029 in staging in order, including the cash/bank transfer and purchase-return concurrency checks. None has been applied to the linked project.
6. Stage and validate fixed-asset migrations 0030–0031 and verify depreciation/disposal accounting with real test fixtures; finish returns integration tests.
7. Reconcile all financial reports to controlled test ledgers before production approval.

## Validation status

- Source review: completed for the listed baseline files.
- TypeScript/Next.js CI: run #142 passed all four steps before the latest SQL/test additions; the newest commit's CI is pending.
- Static migration guard tests: added for sales stock locking 0027, reconstructed 0024, cash-transfer 0028, purchase-return hardening 0029, fixed-asset depreciation 0030, and disposal 0031.
- SQL syntax/integration tests: not run against PostgreSQL.
- Staging concurrency tests: not run.
- Remote Supabase migration state: inspected read-only; current history ends at 0026.
- Production database: unchanged; no migrations applied.
- Production deployment: unchanged.
