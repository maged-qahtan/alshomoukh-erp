-- Operational foundation: inventory, sales/purchases, cash, expenses, fixed assets and reports.
-- Applied to Supabase as operational_modules_inventory_sales_cash_assets.
begin;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  sku text not null, barcode text, name_ar text not null, name_en text, unit text not null default 'حبة',
  category text, track_expiry boolean not null default false, min_stock numeric(18,3) not null default 0 check (min_stock >= 0),
  purchase_price numeric(20,4) not null default 0 check (purchase_price >= 0), sale_price numeric(20,4) not null default 0 check (sale_price >= 0),
  vat_rate numeric(5,2) not null default 0 check (vat_rate between 0 and 100), is_active boolean not null default true,
  created_at timestamptz not null default now(), unique(company_id, sku), unique(company_id, id)
);
create unique index if not exists products_company_barcode_uq on public.products(company_id, barcode) where barcode is not null;

create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  code text not null, name_ar text not null, location text, is_active boolean not null default true,
  created_at timestamptz not null default now(), unique(company_id, code), unique(company_id, id)
);
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null, warehouse_id uuid not null,
  movement_type text not null check (movement_type in ('opening','purchase','sale','purchase_return','sale_return','adjustment','transfer_in','transfer_out')),
  quantity_in numeric(18,3) not null default 0 check (quantity_in >= 0), quantity_out numeric(18,3) not null default 0 check (quantity_out >= 0),
  unit_cost numeric(20,4) not null default 0 check (unit_cost >= 0), batch_number text, expiry_date date, reference_type text, reference_id uuid,
  notes text, created_by uuid references public.app_users(id), created_at timestamptz not null default now(),
  foreign key(company_id, product_id) references public.products(company_id,id),
  foreign key(company_id, warehouse_id) references public.warehouses(company_id,id),
  check ((quantity_in > 0 and quantity_out = 0) or (quantity_out > 0 and quantity_in = 0))
);
create index if not exists stock_movements_company_product_idx on public.stock_movements(company_id, product_id, warehouse_id, created_at);

create table if not exists public.sales_invoices (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  invoice_number text not null, invoice_date date not null default current_date, due_date date, customer_id uuid,
  status text not null default 'draft' check (status in ('draft','posted','cancelled')),
  subtotal numeric(20,2) not null default 0 check (subtotal >= 0), discount_total numeric(20,2) not null default 0 check (discount_total >= 0),
  vat_total numeric(20,2) not null default 0 check (vat_total >= 0), grand_total numeric(20,2) not null default 0 check (grand_total >= 0),
  notes text, created_by uuid references public.app_users(id), created_at timestamptz not null default now(),
  unique(company_id, invoice_number), unique(company_id,id), foreign key(company_id,customer_id) references public.parties(company_id,id)
);
create table if not exists public.sales_invoice_lines (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id uuid not null, product_id uuid not null, description text, quantity numeric(18,3) not null check (quantity > 0),
  unit_price numeric(20,4) not null check (unit_price >= 0), discount numeric(20,2) not null default 0 check (discount >= 0),
  vat_rate numeric(5,2) not null default 0 check (vat_rate between 0 and 100), line_total numeric(20,2) not null check (line_total >= 0),
  foreign key(company_id,invoice_id) references public.sales_invoices(company_id,id) on delete cascade,
  foreign key(company_id,product_id) references public.products(company_id,id)
);
create table if not exists public.purchase_invoices (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  invoice_number text not null, supplier_invoice_number text, invoice_date date not null default current_date, due_date date,
  supplier_id uuid, warehouse_id uuid, status text not null default 'draft' check (status in ('draft','posted','cancelled')),
  subtotal numeric(20,2) not null default 0 check (subtotal >= 0), discount_total numeric(20,2) not null default 0 check (discount_total >= 0),
  vat_total numeric(20,2) not null default 0 check (vat_total >= 0), grand_total numeric(20,2) not null default 0 check (grand_total >= 0),
  notes text, created_by uuid references public.app_users(id), created_at timestamptz not null default now(),
  unique(company_id, invoice_number), unique(company_id,id),
  foreign key(company_id,supplier_id) references public.parties(company_id,id),
  foreign key(company_id,warehouse_id) references public.warehouses(company_id,id)
);
create table if not exists public.purchase_invoice_lines (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  invoice_id uuid not null, product_id uuid not null, description text, quantity numeric(18,3) not null check (quantity > 0),
  unit_cost numeric(20,4) not null check (unit_cost >= 0), discount numeric(20,2) not null default 0 check (discount >= 0),
  vat_rate numeric(5,2) not null default 0 check (vat_rate between 0 and 100), line_total numeric(20,2) not null check (line_total >= 0),
  batch_number text, expiry_date date,
  foreign key(company_id,invoice_id) references public.purchase_invoices(company_id,id) on delete cascade,
  foreign key(company_id,product_id) references public.products(company_id,id)
);
create table if not exists public.cash_accounts (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  code text not null, name_ar text not null, account_type text not null check (account_type in ('cash','bank')),
  currency_code char(3) not null default 'SAR', opening_balance numeric(20,2) not null default 0, is_active boolean not null default true,
  unique(company_id,code), unique(company_id,id)
);
create table if not exists public.cash_transactions (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  cash_account_id uuid not null, transaction_date date not null default current_date,
  transaction_type text not null check (transaction_type in ('receipt','payment','transfer_in','transfer_out')),
  amount numeric(20,2) not null check (amount > 0), reference text, description text not null, party_id uuid,
  status text not null default 'posted' check (status in ('draft','posted','void')),
  created_by uuid references public.app_users(id), created_at timestamptz not null default now(),
  foreign key(company_id,cash_account_id) references public.cash_accounts(company_id,id),
  foreign key(company_id,party_id) references public.parties(company_id,id)
);
create index if not exists cash_transactions_company_date_idx on public.cash_transactions(company_id,transaction_date);
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  expense_number text not null, expense_date date not null default current_date, category text not null, description text not null,
  amount numeric(20,2) not null check (amount > 0), vat_amount numeric(20,2) not null default 0 check (vat_amount >= 0),
  party_id uuid, cash_account_id uuid, status text not null default 'draft' check (status in ('draft','posted','void')),
  created_by uuid references public.app_users(id), created_at timestamptz not null default now(), unique(company_id,expense_number),
  foreign key(company_id,party_id) references public.parties(company_id,id),
  foreign key(company_id,cash_account_id) references public.cash_accounts(company_id,id)
);
create table if not exists public.fixed_assets (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  asset_code text not null, name_ar text not null, acquisition_date date not null, acquisition_cost numeric(20,2) not null check (acquisition_cost > 0),
  useful_life_months integer not null check (useful_life_months > 0), residual_value numeric(20,2) not null default 0 check (residual_value >= 0),
  depreciation_method text not null default 'straight_line' check (depreciation_method = 'straight_line'),
  is_active boolean not null default true, created_at timestamptz not null default now(),
  unique(company_id,asset_code), unique(company_id,id), check (residual_value <= acquisition_cost)
);
create table if not exists public.asset_depreciation (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  asset_id uuid not null, period_start date not null, period_end date not null, depreciation_amount numeric(20,2) not null check (depreciation_amount >= 0),
  journal_entry_id uuid, created_at timestamptz not null default now(),
  foreign key(company_id,asset_id) references public.fixed_assets(company_id,id),
  foreign key(company_id,journal_entry_id) references public.journal_entries(company_id,id),
  unique(company_id,asset_id,period_start,period_end), check(period_end >= period_start)
);

do $$
declare t text;
begin
  foreach t in array array['products','warehouses','stock_movements','sales_invoices','sales_invoice_lines','purchase_invoices','purchase_invoice_lines','cash_accounts','cash_transactions','expenses','fixed_assets','asset_depreciation']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_access_company(company_id))', t || '_member_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_manager_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_manage_company(company_id))', t || '_manager_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_manager_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_manage_company(company_id)) with check (public.can_manage_company(company_id))', t || '_manager_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_manager_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.can_manage_company(company_id))', t || '_manager_delete', t);
  end loop;
end $$;
grant select, insert, update, delete on public.products, public.warehouses, public.stock_movements,
 public.sales_invoices, public.sales_invoice_lines, public.purchase_invoices, public.purchase_invoice_lines,
 public.cash_accounts, public.cash_transactions, public.expenses, public.fixed_assets, public.asset_depreciation to authenticated;

create or replace view public.stock_on_hand with (security_invoker = true) as
select m.company_id,m.product_id,p.sku,p.name_ar as product_name,m.warehouse_id,w.name_ar as warehouse_name,
       sum(m.quantity_in-m.quantity_out)::numeric(18,3) as quantity_on_hand,
       case when sum(m.quantity_in-m.quantity_out)=0 then 0
            else sum((m.quantity_in-m.quantity_out)*m.unit_cost)/sum(m.quantity_in-m.quantity_out) end::numeric(20,4) as weighted_unit_cost
from public.stock_movements m join public.products p on p.id=m.product_id and p.company_id=m.company_id
join public.warehouses w on w.id=m.warehouse_id and w.company_id=m.company_id
group by m.company_id,m.product_id,p.sku,p.name_ar,m.warehouse_id,w.name_ar;

create or replace view public.balance_sheet_accounts with (security_invoker = true) as
select tb.company_id,tb.account_id,tb.account_code,tb.account_name,tb.account_type,tb.debit_total,tb.credit_total,
       case when tb.account_type='asset' then tb.debit_total-tb.credit_total
            when tb.account_type in ('liability','equity') then tb.credit_total-tb.debit_total else 0 end::numeric(20,2) as balance
from public.trial_balance tb where tb.account_type in ('asset','liability','equity');

create or replace view public.vat_summary with (security_invoker = true) as
select company_id,'sales'::text as source_type,sum(vat_total)::numeric(20,2) as vat_amount,
       sum(grand_total)::numeric(20,2) as gross_amount,count(*)::bigint as document_count
from public.sales_invoices where status='posted' group by company_id
union all
select company_id,'purchases'::text,sum(vat_total)::numeric(20,2),sum(grand_total)::numeric(20,2),count(*)::bigint
from public.purchase_invoices where status='posted' group by company_id;
commit;