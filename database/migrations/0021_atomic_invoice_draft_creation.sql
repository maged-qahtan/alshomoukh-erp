-- Atomic draft creation for sales and purchase invoices.
-- Header and its single initial line are committed or rolled back together.

create or replace function public.create_sales_invoice_draft(
  p_company_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_customer_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_unit_price numeric,
  p_vat_rate numeric
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_invoice_id uuid;
  v_user_id uuid;
  v_subtotal numeric(20,2);
  v_vat numeric(20,2);
  v_total numeric(20,2);
  v_product_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.can_manage_company(p_company_id) then
    raise exception 'Not authorized to create invoices for this company' using errcode = '42501';
  end if;
  v_user_id := public.current_app_user_id();
  if v_user_id is null then
    raise exception 'Active application user not found' using errcode = '42501';
  end if;
  if nullif(btrim(p_invoice_number), '') is null or p_invoice_date is null then
    raise exception 'Invoice number and date are required' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_unit_price is null or p_unit_price < 0
     or p_vat_rate is null or p_vat_rate < 0 or p_vat_rate > 100 then
    raise exception 'Invalid quantity, unit price, or VAT rate' using errcode = '22023';
  end if;

  select p.name_ar into v_product_name
  from public.products p
  where p.id = p_product_id
    and p.company_id = p_company_id
    and p.is_active = true;
  if not found then
    raise exception 'Active product not found in this company' using errcode = '22023';
  end if;

  if p_customer_id is not null and not exists (
    select 1 from public.parties c
    where c.id = p_customer_id and c.company_id = p_company_id
      and c.is_active = true and c.party_type in ('customer','both')
  ) then
    raise exception 'Active customer not found in this company' using errcode = '22023';
  end if;

  v_subtotal := round(p_quantity * p_unit_price, 2);
  v_vat := round(v_subtotal * p_vat_rate / 100, 2);
  v_total := v_subtotal + v_vat;

  insert into public.sales_invoices (
    company_id, invoice_number, invoice_date, customer_id,
    subtotal, discount_total, vat_total, grand_total, created_by
  ) values (
    p_company_id, btrim(p_invoice_number), p_invoice_date, p_customer_id,
    v_subtotal, 0, v_vat, v_total, v_user_id
  ) returning id into v_invoice_id;

  insert into public.sales_invoice_lines (
    company_id, invoice_id, product_id, description,
    quantity, unit_price, discount, vat_rate, line_total
  ) values (
    p_company_id, v_invoice_id, p_product_id, v_product_name,
    p_quantity, p_unit_price, 0, p_vat_rate, v_total
  );

  return v_invoice_id;
end;
$$;

create or replace function public.create_purchase_invoice_draft(
  p_company_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_supplier_id uuid,
  p_warehouse_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_unit_cost numeric,
  p_vat_rate numeric
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_invoice_id uuid;
  v_user_id uuid;
  v_subtotal numeric(20,2);
  v_vat numeric(20,2);
  v_total numeric(20,2);
  v_product_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.can_manage_company(p_company_id) then
    raise exception 'Not authorized to create invoices for this company' using errcode = '42501';
  end if;
  v_user_id := public.current_app_user_id();
  if v_user_id is null then
    raise exception 'Active application user not found' using errcode = '42501';
  end if;
  if nullif(btrim(p_invoice_number), '') is null or p_invoice_date is null then
    raise exception 'Invoice number and date are required' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_unit_cost is null or p_unit_cost < 0
     or p_vat_rate is null or p_vat_rate < 0 or p_vat_rate > 100 then
    raise exception 'Invalid quantity, unit cost, or VAT rate' using errcode = '22023';
  end if;

  select p.name_ar into v_product_name
  from public.products p
  where p.id = p_product_id
    and p.company_id = p_company_id
    and p.is_active = true;
  if not found then
    raise exception 'Active product not found in this company' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.warehouses w
    where w.id = p_warehouse_id and w.company_id = p_company_id
      and w.is_active = true
  ) then
    raise exception 'Active warehouse not found in this company' using errcode = '22023';
  end if;

  if p_supplier_id is not null and not exists (
    select 1 from public.parties s
    where s.id = p_supplier_id and s.company_id = p_company_id
      and s.is_active = true and s.party_type in ('supplier','both')
  ) then
    raise exception 'Active supplier not found in this company' using errcode = '22023';
  end if;

  v_subtotal := round(p_quantity * p_unit_cost, 2);
  v_vat := round(v_subtotal * p_vat_rate / 100, 2);
  v_total := v_subtotal + v_vat;

  insert into public.purchase_invoices (
    company_id, invoice_number, invoice_date, supplier_id, warehouse_id,
    subtotal, discount_total, vat_total, grand_total, created_by
  ) values (
    p_company_id, btrim(p_invoice_number), p_invoice_date, p_supplier_id, p_warehouse_id,
    v_subtotal, 0, v_vat, v_total, v_user_id
  ) returning id into v_invoice_id;

  insert into public.purchase_invoice_lines (
    company_id, invoice_id, product_id, description,
    quantity, unit_cost, discount, vat_rate, line_total
  ) values (
    p_company_id, v_invoice_id, p_product_id, v_product_name,
    p_quantity, p_unit_cost, 0, p_vat_rate, v_total
  );

  return v_invoice_id;
end;
$$;

revoke all on function public.create_sales_invoice_draft(uuid,text,date,uuid,uuid,numeric,numeric,numeric) from public, anon;
revoke all on function public.create_purchase_invoice_draft(uuid,text,date,uuid,uuid,uuid,numeric,numeric,numeric) from public, anon;
grant execute on function public.create_sales_invoice_draft(uuid,text,date,uuid,uuid,numeric,numeric,numeric) to authenticated;
grant execute on function public.create_purchase_invoice_draft(uuid,text,date,uuid,uuid,uuid,numeric,numeric,numeric) to authenticated;
