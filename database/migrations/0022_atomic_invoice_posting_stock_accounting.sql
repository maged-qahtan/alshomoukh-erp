-- Atomic posting of operational invoices: stock, journal and invoice status move together.
alter table public.sales_invoices
  add column if not exists journal_entry_id uuid references public.journal_entries(id),
  add column if not exists posted_at timestamptz,
  add column if not exists posted_by uuid references public.app_users(id);

alter table public.purchase_invoices
  add column if not exists journal_entry_id uuid references public.journal_entries(id),
  add column if not exists posted_at timestamptz,
  add column if not exists posted_by uuid references public.app_users(id);

create unique index if not exists sales_invoices_journal_entry_uidx
  on public.sales_invoices(journal_entry_id) where journal_entry_id is not null;
create unique index if not exists purchase_invoices_journal_entry_uidx
  on public.purchase_invoices(journal_entry_id) where journal_entry_id is not null;

-- Recoverable input VAT is an asset, distinct from output VAT payable.
insert into public.accounts(company_id,parent_id,code,name_ar,name_en,type,is_posting,is_active)
select c.id,p.id,'1105','ضريبة القيمة المضافة المدخلة','Input VAT','asset',true,true
from public.companies c
join public.accounts p on p.company_id=c.id and p.code='11'
where not exists (select 1 from public.accounts a where a.company_id=c.id and a.code='1105');

create or replace function public.post_sales_invoice(p_invoice_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $$
declare
  v_invoice public.sales_invoices%rowtype;
  v_user_id uuid;
  v_period_id uuid;
  v_journal_id uuid;
  v_entry_no bigint;
  v_cash_or_ar uuid;
  v_revenue uuid;
  v_vat_out uuid;
  v_inventory uuid;
  v_cogs uuid;
  v_qty numeric;
  v_cost numeric(20,2) := 0;
  v_line_no integer := 0;
  v_line record;
  v_stock record;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_invoice from public.sales_invoices where id=p_invoice_id for update;
  if not found then raise exception 'Sales invoice not found'; end if;
  if not public.can_manage_company(v_invoice.company_id) then raise exception 'Not authorized' using errcode='42501'; end if;
  if v_invoice.status <> 'draft' or v_invoice.journal_entry_id is not null then
    raise exception 'Only an unposted draft sales invoice can be posted';
  end if;
  v_user_id := public.current_app_user_id();
  if v_user_id is null then raise exception 'Active application user not found' using errcode='42501'; end if;

  select id into v_period_id from public.fiscal_periods
   where company_id=v_invoice.company_id and status='open'
     and v_invoice.invoice_date between starts_on and ends_on
   for update;
  if v_period_id is null then raise exception 'No open fiscal period contains the invoice date'; end if;

  select id into v_cash_or_ar from public.accounts where company_id=v_invoice.company_id
    and code=case when v_invoice.customer_id is null then '1101' else '1103' end
    and is_active and is_posting;
  select id into v_revenue from public.accounts where company_id=v_invoice.company_id and code='4101' and is_active and is_posting;
  select id into v_vat_out from public.accounts where company_id=v_invoice.company_id and code='2102' and is_active and is_posting;
  select id into v_inventory from public.accounts where company_id=v_invoice.company_id and code='1104' and is_active and is_posting;
  select id into v_cogs from public.accounts where company_id=v_invoice.company_id and code='5101' and is_active and is_posting;
  if v_cash_or_ar is null or v_revenue is null or v_inventory is null or v_cogs is null
     or (v_invoice.vat_total>0 and v_vat_out is null) then
    raise exception 'Required active posting accounts are missing (1101/1103, 4101, 1104, 5101, 2102)';
  end if;

  if not exists(select 1 from public.sales_invoice_lines where invoice_id=p_invoice_id and company_id=v_invoice.company_id) then
    raise exception 'Invoice has no detail lines';
  end if;

  for v_line in
    select l.* from public.sales_invoice_lines l
    where l.invoice_id=p_invoice_id and l.company_id=v_invoice.company_id
    order by l.id
  loop
    select quantity_on_hand,weighted_unit_cost into v_stock
    from public.stock_on_hand
    where company_id=v_invoice.company_id and product_id=v_line.product_id
    order by warehouse_id;
    if not found or coalesce(v_stock.quantity_on_hand,0) < v_line.quantity then
      raise exception 'Insufficient stock for product %',v_line.product_id;
    end if;
    v_qty := v_line.quantity;
    v_cost := v_cost + round(v_qty * coalesce(v_stock.weighted_unit_cost,0),2);
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(v_invoice.company_id::text,0));
  select coalesce(max(entry_number),0)+1 into v_entry_no from public.journal_entries where company_id=v_invoice.company_id;
  insert into public.journal_entries(company_id,fiscal_period_id,entry_number,entry_date,description,reference,source_type,source_id,created_by)
  values(v_invoice.company_id,v_period_id,v_entry_no,v_invoice.invoice_date,'ترحيل فاتورة مبيعات '||v_invoice.invoice_number,
    v_invoice.invoice_number,'sales_invoice',p_invoice_id,v_user_id)
  returning id into v_journal_id;

  insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,party_id,debit,credit)
  values(v_invoice.company_id,v_journal_id,1,v_cash_or_ar,'إجمالي فاتورة المبيعات',v_invoice.customer_id,v_invoice.grand_total,0);
  v_line_no:=1;
  v_line_no:=v_line_no+1;
  insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,credit,debit)
  values(v_invoice.company_id,v_journal_id,v_line_no,v_revenue,'صافي المبيعات',v_invoice.subtotal,0);
  if v_invoice.vat_total>0 then
    v_line_no:=v_line_no+1;
    insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,credit,debit)
    values(v_invoice.company_id,v_journal_id,v_line_no,v_vat_out,'ضريبة مخرجات المبيعات',v_invoice.vat_total,0);
  end if;
  if v_cost>0 then
    v_line_no:=v_line_no+1;
    insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
    values(v_invoice.company_id,v_journal_id,v_line_no,v_cogs,'تكلفة البضاعة المباعة',v_cost,0);
    v_line_no:=v_line_no+1;
    insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
    values(v_invoice.company_id,v_journal_id,v_line_no,v_inventory,'إخراج مخزون مقابل البيع',0,v_cost);
  end if;

  perform public.post_journal_entry(v_journal_id,v_user_id);

  for v_line in
    select l.* from public.sales_invoice_lines l
    where l.invoice_id=p_invoice_id and l.company_id=v_invoice.company_id
    order by l.id
  loop
    select quantity_on_hand,weighted_unit_cost into v_stock
    from public.stock_on_hand
    where company_id=v_invoice.company_id and product_id=v_line.product_id
    order by warehouse_id;
    insert into public.stock_movements(company_id,product_id,warehouse_id,movement_type,quantity_in,quantity_out,unit_cost,reference_type,reference_id,notes,created_by)
    select v_invoice.company_id,v_line.product_id,s.warehouse_id,'sale',0,v_line.quantity,
      coalesce(s.weighted_unit_cost,0),'sales_invoice',p_invoice_id,'صرف آلي عند ترحيل فاتورة المبيعات',v_user_id
    from public.stock_on_hand s
    where s.company_id=v_invoice.company_id and s.product_id=v_line.product_id
    order by s.warehouse_id
    limit 1;
  end loop;

  update public.sales_invoices set status='posted',journal_entry_id=v_journal_id,posted_at=now(),posted_by=v_user_id
   where id=p_invoice_id and company_id=v_invoice.company_id and status='draft';
  if not found then raise exception 'Sales invoice status changed during posting'; end if;
  insert into public.audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data)
  values(v_invoice.company_id,v_user_id,'sales_invoice.posted','sales_invoice',p_invoice_id,
    jsonb_build_object('journal_entry_id',v_journal_id,'grand_total',v_invoice.grand_total,'cost_of_goods_sold',v_cost));
  return v_journal_id;
end;
$$;

create or replace function public.post_purchase_invoice(p_invoice_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $$
declare
  v_invoice public.purchase_invoices%rowtype;
  v_user_id uuid;
  v_period_id uuid;
  v_journal_id uuid;
  v_entry_no bigint;
  v_cash_or_ap uuid;
  v_inventory uuid;
  v_vat_in uuid;
  v_line_no integer := 0;
  v_line record;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_invoice from public.purchase_invoices where id=p_invoice_id for update;
  if not found then raise exception 'Purchase invoice not found'; end if;
  if not public.can_manage_company(v_invoice.company_id) then raise exception 'Not authorized' using errcode='42501'; end if;
  if v_invoice.status <> 'draft' or v_invoice.journal_entry_id is not null then
    raise exception 'Only an unposted draft purchase invoice can be posted';
  end if;
  v_user_id := public.current_app_user_id();
  if v_user_id is null then raise exception 'Active application user not found' using errcode='42501'; end if;

  select id into v_period_id from public.fiscal_periods
   where company_id=v_invoice.company_id and status='open'
     and v_invoice.invoice_date between starts_on and ends_on
   for update;
  if v_period_id is null then raise exception 'No open fiscal period contains the invoice date'; end if;

  select id into v_cash_or_ap from public.accounts where company_id=v_invoice.company_id
    and code=case when v_invoice.supplier_id is null then '1101' else '2101' end
    and is_active and is_posting;
  select id into v_inventory from public.accounts where company_id=v_invoice.company_id and code='1104' and is_active and is_posting;
  select id into v_vat_in from public.accounts where company_id=v_invoice.company_id and code='1105' and is_active and is_posting;
  if v_cash_or_ap is null or v_inventory is null or (v_invoice.vat_total>0 and v_vat_in is null) then
    raise exception 'Required active posting accounts are missing (1101/2101, 1104, 1105)';
  end if;
  if not exists(select 1 from public.purchase_invoice_lines where invoice_id=p_invoice_id and company_id=v_invoice.company_id) then
    raise exception 'Invoice has no detail lines';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_invoice.company_id::text,0));
  select coalesce(max(entry_number),0)+1 into v_entry_no from public.journal_entries where company_id=v_invoice.company_id;
  insert into public.journal_entries(company_id,fiscal_period_id,entry_number,entry_date,description,reference,source_type,source_id,created_by)
  values(v_invoice.company_id,v_period_id,v_entry_no,v_invoice.invoice_date,'ترحيل فاتورة مشتريات '||v_invoice.invoice_number,
    v_invoice.invoice_number,'purchase_invoice',p_invoice_id,v_user_id)
  returning id into v_journal_id;

  v_line_no:=1;
  insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
  values(v_invoice.company_id,v_journal_id,v_line_no,v_inventory,'إضافة مخزون من فاتورة المشتريات',v_invoice.subtotal,0);
  if v_invoice.vat_total>0 then
    v_line_no:=v_line_no+1;
    insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
    values(v_invoice.company_id,v_journal_id,v_line_no,v_vat_in,'ضريبة مدخلات المشتريات',v_invoice.vat_total,0);
  end if;
  v_line_no:=v_line_no+1;
  insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,party_id,debit,credit)
  values(v_invoice.company_id,v_journal_id,v_line_no,v_cash_or_ap,'إجمالي فاتورة المشتريات',v_invoice.supplier_id,0,v_invoice.grand_total);

  perform public.post_journal_entry(v_journal_id,v_user_id);

  for v_line in
    select l.* from public.purchase_invoice_lines l
    where l.invoice_id=p_invoice_id and l.company_id=v_invoice.company_id
    order by l.id
  loop
    insert into public.stock_movements(company_id,product_id,warehouse_id,movement_type,quantity_in,quantity_out,unit_cost,reference_type,reference_id,notes,created_by)
    values(v_invoice.company_id,v_line.product_id,v_invoice.warehouse_id,'purchase',v_line.quantity,0,v_line.unit_cost,
      'purchase_invoice',p_invoice_id,'استلام آلي عند ترحيل فاتورة المشتريات',v_user_id);
  end loop;

  update public.purchase_invoices set status='posted',journal_entry_id=v_journal_id,posted_at=now(),posted_by=v_user_id
   where id=p_invoice_id and company_id=v_invoice.company_id and status='draft';
  if not found then raise exception 'Purchase invoice status changed during posting'; end if;
  insert into public.audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data)
  values(v_invoice.company_id,v_user_id,'purchase_invoice.posted','purchase_invoice',p_invoice_id,
    jsonb_build_object('journal_entry_id',v_journal_id,'grand_total',v_invoice.grand_total));
  return v_journal_id;
end;
$$;

revoke all on function public.post_sales_invoice(uuid) from public, anon;
revoke all on function public.post_purchase_invoice(uuid) from public, anon;
grant execute on function public.post_sales_invoice(uuid) to authenticated;
grant execute on function public.post_purchase_invoice(uuid) to authenticated;
