-- Add covering indexes for foreign keys reported by Supabase's database advisor.
-- These indexes improve joins and parent-row update/delete checks; they do not
-- change row visibility, posting rules, or accounting results.
begin;

create index if not exists cash_accounts_company_ledger_fk_idx
  on public.cash_accounts (company_id, ledger_account_id);

create index if not exists cash_tx_company_contra_fk_idx
  on public.cash_transactions (company_id, contra_account_id);
create index if not exists cash_tx_journal_entry_fk_idx
  on public.cash_transactions (journal_entry_id);
create index if not exists cash_tx_posted_by_fk_idx
  on public.cash_transactions (posted_by);

create index if not exists expenses_company_cost_center_fk_idx
  on public.expenses (company_id, cost_center_id);
create index if not exists expenses_company_expense_account_fk_idx
  on public.expenses (company_id, expense_account_id);
create index if not exists expenses_company_journal_fk_idx
  on public.expenses (company_id, journal_entry_id);

create index if not exists purchase_invoices_journal_entry_fk_idx
  on public.purchase_invoices (journal_entry_id);
create index if not exists purchase_invoices_posted_by_fk_idx
  on public.purchase_invoices (posted_by);

create index if not exists purchase_returns_created_by_fk_idx
  on public.purchase_returns (created_by);
create index if not exists purchase_returns_journal_entry_fk_idx
  on public.purchase_returns (journal_entry_id);
create index if not exists purchase_returns_original_invoice_fk_idx
  on public.purchase_returns (original_invoice_id);
create index if not exists purchase_returns_original_line_fk_idx
  on public.purchase_returns (original_line_id);
create index if not exists purchase_returns_posted_by_fk_idx
  on public.purchase_returns (posted_by);
create index if not exists purchase_returns_product_fk_idx
  on public.purchase_returns (product_id);
create index if not exists purchase_returns_warehouse_fk_idx
  on public.purchase_returns (warehouse_id);

create index if not exists sales_invoices_journal_entry_fk_idx
  on public.sales_invoices (journal_entry_id);
create index if not exists sales_invoices_posted_by_fk_idx
  on public.sales_invoices (posted_by);

create index if not exists sales_returns_created_by_fk_idx
  on public.sales_returns (created_by);
create index if not exists sales_returns_journal_entry_fk_idx
  on public.sales_returns (journal_entry_id);
create index if not exists sales_returns_original_invoice_fk_idx
  on public.sales_returns (original_invoice_id);
create index if not exists sales_returns_original_line_fk_idx
  on public.sales_returns (original_line_id);
create index if not exists sales_returns_posted_by_fk_idx
  on public.sales_returns (posted_by);
create index if not exists sales_returns_product_fk_idx
  on public.sales_returns (product_id);
create index if not exists sales_returns_warehouse_fk_idx
  on public.sales_returns (warehouse_id);

commit;
