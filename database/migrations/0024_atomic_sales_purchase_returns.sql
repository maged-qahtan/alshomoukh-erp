-- Reconstructed source for the already-applied remote migration:
-- 20261115011805 / 0024_atomic_sales_purchase_returns.
-- Table columns, constraints, indexes, RLS policies, and function bodies were
-- read from the linked Supabase catalog. This file restores the missing source
-- for fresh database builds; it does not apply or alter the live database.
begin;

create table if not exists public.sales_returns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  return_number text not null,
  return_date date not null,
  original_invoice_id uuid not null references public.sales_invoices(id),
  original_line_id uuid not null references public.sales_invoice_lines(id),
  product_id uuid not null references public.products(id),
  warehouse_id uuid not null references public.warehouses(id),
  quantity numeric(18,3) not null check (quantity > 0),
  subtotal numeric(20,2) not null check (subtotal >= 0),
  vat_total numeric(20,2) not null check (vat_total >= 0),
  grand_total numeric(20,2) not null check (grand_total >= 0),
  unit_cost numeric(20,4) not null default 0 check (unit_cost >= 0),
  reason text not null,
  status text not null default 'draft' check (status in ('draft','posted','cancelled')),
  journal_entry_id uuid references public.journal_entries(id),
  created_by uuid references public.app_users(id),
  posted_by uuid references public.app_users(id),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(company_id, return_number)
);

create table if not exists public.purchase_returns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  return_number text not null,
  return_date date not null,
  original_invoice_id uuid not null references public.purchase_invoices(id),
  original_line_id uuid not null references public.purchase_invoice_lines(id),
  product_id uuid not null references public.products(id),
  warehouse_id uuid not null references public.warehouses(id),
  quantity numeric(18,3) not null check (quantity > 0),
  subtotal numeric(20,2) not null check (subtotal >= 0),
  vat_total numeric(20,2) not null check (vat_total >= 0),
  grand_total numeric(20,2) not null check (grand_total >= 0),
  unit_cost numeric(20,4) not null default 0 check (unit_cost >= 0),
  reason text not null,
  status text not null default 'draft' check (status in ('draft','posted','cancelled')),
  journal_entry_id uuid references public.journal_entries(id),
  created_by uuid references public.app_users(id),
  posted_by uuid references public.app_users(id),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(company_id, return_number)
);

create index if not exists sales_returns_original_idx
  on public.sales_returns(company_id, original_line_id, status);
create index if not exists purchase_returns_original_idx
  on public.purchase_returns(company_id, original_line_id, status);

alter table public.sales_returns enable row level security;
alter table public.purchase_returns enable row level security;

drop policy if exists sales_returns_company_access on public.sales_returns;
create policy sales_returns_company_access on public.sales_returns
  for all to authenticated
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

drop policy if exists purchase_returns_company_access on public.purchase_returns;
create policy purchase_returns_company_access on public.purchase_returns
  for all to authenticated
  using (public.can_manage_company(company_id))
  with check (public.can_manage_company(company_id));

grant select, insert, update, delete on public.sales_returns, public.purchase_returns to authenticated;

create or replace function public.create_sales_return_draft(
  p_company_id uuid, p_return_number text, p_return_date date,
  p_original_line_id uuid, p_warehouse_id uuid, p_quantity numeric, p_reason text
)
returns uuid
language plpgsql
set search_path = pg_catalog, public, auth
as $function$
declare
 v_user uuid; v_inv public.sales_invoices%rowtype; v_line public.sales_invoice_lines%rowtype;
 v_used numeric; v_sub numeric; v_vat numeric; v_total numeric; v_cost numeric; v_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if not public.can_manage_company(p_company_id) then raise exception 'Not authorized' using errcode='42501'; end if;
 v_user:=public.current_app_user_id();
 if v_user is null then raise exception 'Active application user not found'; end if;
 if p_quantity is null or p_quantity<=0 or nullif(btrim(p_return_number),'') is null or nullif(btrim(p_reason),'') is null then
  raise exception 'Return number, reason and positive quantity are required' using errcode='22023';
 end if;
 select l.* into v_line from public.sales_invoice_lines l
 join public.sales_invoices i on i.id=l.invoice_id and i.company_id=l.company_id
 where l.id=p_original_line_id and l.company_id=p_company_id and i.status='posted' for update of i,l;
 if not found then raise exception 'Original posted sales invoice line not found'; end if;
 select * into v_inv from public.sales_invoices where id=v_line.invoice_id;
 if not exists(select 1 from public.warehouses w where w.id=p_warehouse_id and w.company_id=p_company_id and w.is_active) then
  raise exception 'Active return warehouse not found in this company';
 end if;
 select coalesce(sum(quantity),0) into v_used from public.sales_returns
 where company_id=p_company_id and original_line_id=p_original_line_id and status in ('draft','posted');
 if v_used+p_quantity>v_line.quantity then raise exception 'Return quantity exceeds the unreturned original quantity'; end if;
 v_sub:=round((v_line.line_total/(1+v_line.vat_rate/100))*p_quantity/v_line.quantity,2);
 v_vat:=round(v_sub*v_line.vat_rate/100,2); v_total:=v_sub+v_vat;
 select coalesce(sum(sm.quantity_out*sm.unit_cost)/nullif(sum(sm.quantity_out),0),0) into v_cost
 from public.stock_movements sm where sm.company_id=p_company_id and sm.reference_type='sales_invoice'
 and sm.reference_id=v_inv.id and sm.product_id=v_line.product_id;
 insert into public.sales_returns(company_id,return_number,return_date,original_invoice_id,original_line_id,
 product_id,warehouse_id,quantity,subtotal,vat_total,grand_total,unit_cost,reason,created_by)
 values(p_company_id,btrim(p_return_number),p_return_date,v_inv.id,v_line.id,v_line.product_id,p_warehouse_id,
 p_quantity,v_sub,v_vat,v_total,v_cost,btrim(p_reason),v_user) returning id into v_id;
 return v_id;
end
$function$;

create or replace function public.create_purchase_return_draft(
 p_company_id uuid, p_return_number text, p_return_date date,
 p_original_line_id uuid, p_quantity numeric, p_reason text
)
returns uuid
language plpgsql
set search_path = pg_catalog, public, auth
as $function$
declare
 v_user uuid; v_inv public.purchase_invoices%rowtype; v_line public.purchase_invoice_lines%rowtype;
 v_used numeric; v_sub numeric; v_vat numeric; v_total numeric; v_id uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if not public.can_manage_company(p_company_id) then raise exception 'Not authorized' using errcode='42501'; end if;
 v_user:=public.current_app_user_id();
 if v_user is null then raise exception 'Active application user not found'; end if;
 if p_quantity is null or p_quantity<=0 or nullif(btrim(p_return_number),'') is null or nullif(btrim(p_reason),'') is null then
  raise exception 'Return number, reason and positive quantity are required' using errcode='22023';
 end if;
 select l.* into v_line from public.purchase_invoice_lines l
 join public.purchase_invoices i on i.id=l.invoice_id and i.company_id=l.company_id
 where l.id=p_original_line_id and l.company_id=p_company_id and i.status='posted' for update of i,l;
 if not found then raise exception 'Original posted purchase invoice line not found'; end if;
 select * into v_inv from public.purchase_invoices where id=v_line.invoice_id;
 select coalesce(sum(quantity),0) into v_used from public.purchase_returns
 where company_id=p_company_id and original_line_id=p_original_line_id and status in ('draft','posted');
 if v_used+p_quantity>v_line.quantity then raise exception 'Return quantity exceeds the unreturned original quantity'; end if;
 v_sub:=round((v_line.line_total/(1+v_line.vat_rate/100))*p_quantity/v_line.quantity,2);
 v_vat:=round(v_sub*v_line.vat_rate/100,2); v_total:=v_sub+v_vat;
 insert into public.purchase_returns(company_id,return_number,return_date,original_invoice_id,original_line_id,
 product_id,warehouse_id,quantity,subtotal,vat_total,grand_total,unit_cost,reason,created_by)
 values(p_company_id,btrim(p_return_number),p_return_date,v_inv.id,v_line.id,v_line.product_id,v_inv.warehouse_id,
 p_quantity,v_sub,v_vat,v_total,v_line.unit_cost,btrim(p_reason),v_user) returning id into v_id;
 return v_id;
end
$function$;

create or replace function public.post_sales_return(p_return_id uuid)
returns uuid
language plpgsql
set search_path = pg_catalog, public, auth
as $function$
declare
 r public.sales_returns%rowtype; v_user uuid; v_period uuid; v_journal uuid;
 v_cash_ar uuid; v_rev uuid; v_vat uuid; v_inv uuid; v_cogs uuid; v_onhand numeric; v_cost numeric; n int:=0;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into r from public.sales_returns where id=p_return_id for update;
 if not found or not public.can_manage_company(r.company_id) then raise exception 'Return not found or not authorized' using errcode='42501'; end if;
 if r.status<>'draft' or r.journal_entry_id is not null then raise exception 'Only draft sales returns can be posted'; end if;
 v_user:=public.current_app_user_id();
 select id into v_period from public.fiscal_periods where company_id=r.company_id and status='open' and r.return_date between starts_on and ends_on for update;
 if v_period is null then raise exception 'No open fiscal period contains return date'; end if;
 select id into v_cash_ar from public.accounts where company_id=r.company_id and code=case when (select customer_id from public.sales_invoices where id=r.original_invoice_id) is null then '1101' else '1103' end and is_active and is_posting;
 select id into v_rev from public.accounts where company_id=r.company_id and code='4101' and is_active and is_posting;
 select id into v_vat from public.accounts where company_id=r.company_id and code='2102' and is_active and is_posting;
 select id into v_inv from public.accounts where company_id=r.company_id and code='1104' and is_active and is_posting;
 select id into v_cogs from public.accounts where company_id=r.company_id and code='5101' and is_active and is_posting;
 if v_cash_ar is null or v_rev is null or v_inv is null or v_cogs is null or (r.vat_total>0 and v_vat is null) then raise exception 'Required return posting accounts are missing'; end if;
 select coalesce(sum(quantity_on_hand),0) into v_onhand from public.stock_on_hand where company_id=r.company_id and product_id=r.product_id and warehouse_id=r.warehouse_id;
 v_cost:=round(r.quantity*r.unit_cost,2);
 perform pg_advisory_xact_lock(hashtextextended(r.company_id::text,0));
 insert into public.journal_entries(company_id,fiscal_period_id,entry_date,description,reference,source_type,source_id,created_by)
 values(r.company_id,v_period,r.return_date,'مرتجع مبيعات '||r.return_number,r.return_number,'sales_return',r.id,v_user) returning id into v_journal;
 insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,party_id,debit,credit)
 values(r.company_id,v_journal,1,v_rev,'عكس إيراد المبيعات',(select customer_id from public.sales_invoices where id=r.original_invoice_id),r.subtotal,0);
 n:=1;
 if r.vat_total>0 then n:=n+1; insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
 values(r.company_id,v_journal,n,v_vat,'عكس ضريبة مخرجات المبيعات',r.vat_total,0); end if;
 n:=n+1; insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,party_id,debit,credit)
 values(r.company_id,v_journal,n,v_cash_ar,'رد قيمة مرتجع المبيعات',(select customer_id from public.sales_invoices where id=r.original_invoice_id),0,r.grand_total);
 if v_cost>0 then
 n:=n+1; insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit) values(r.company_id,v_journal,n,v_inv,'إعادة تكلفة البضاعة المرتجعة للمخزون',v_cost,0);
 n:=n+1; insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit) values(r.company_id,v_journal,n,v_cogs,'عكس تكلفة البضاعة المباعة',0,v_cost); end if;
 perform public.post_journal_entry(v_journal,v_user);
 insert into public.stock_movements(company_id,product_id,warehouse_id,movement_type,quantity_in,quantity_out,unit_cost,reference_type,reference_id,notes,created_by)
 values(r.company_id,r.product_id,r.warehouse_id,'sale_return',r.quantity,0,r.unit_cost,'sales_return',r.id,'إضافة مخزون من مرتجع المبيعات',v_user);
 update public.sales_returns set status='posted',journal_entry_id=v_journal,posted_at=now(),posted_by=v_user where id=r.id and status='draft';
 insert into public.audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data)
 values(r.company_id,v_user,'sales_return.posted','sales_return',r.id,jsonb_build_object('journal_entry_id',v_journal,'quantity',r.quantity,'grand_total',r.grand_total));
 return v_journal;
end
$function$;

create or replace function public.post_purchase_return(p_return_id uuid)
returns uuid
language plpgsql
set search_path = pg_catalog, public, auth
as $function$
declare
 r public.purchase_returns%rowtype; v_user uuid; v_period uuid; v_journal uuid;
 v_cash_ap uuid; v_inv uuid; v_vat uuid; v_stock numeric; n int:=0;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into r from public.purchase_returns where id=p_return_id for update;
 if not found or not public.can_manage_company(r.company_id) then raise exception 'Return not found or not authorized' using errcode='42501'; end if;
 if r.status<>'draft' or r.journal_entry_id is not null then raise exception 'Only draft purchase returns can be posted'; end if;
 v_user:=public.current_app_user_id();
 select id into v_period from public.fiscal_periods where company_id=r.company_id and status='open' and r.return_date between starts_on and ends_on for update;
 if v_period is null then raise exception 'No open fiscal period contains return date'; end if;
 select id into v_cash_ap from public.accounts where company_id=r.company_id and code=case when (select supplier_id from public.purchase_invoices where id=r.original_invoice_id) is null then '1101' else '2101' end and is_active and is_posting;
 select id into v_inv from public.accounts where company_id=r.company_id and code='1104' and is_active and is_posting;
 select id into v_vat from public.accounts where company_id=r.company_id and code='1105' and is_active and is_posting;
 if v_cash_ap is null or v_inv is null or (r.vat_total>0 and v_vat is null) then raise exception 'Required return posting accounts are missing'; end if;
 select coalesce(sum(quantity_on_hand),0) into v_stock from public.stock_on_hand where company_id=r.company_id and product_id=r.product_id and warehouse_id=r.warehouse_id;
 if v_stock<r.quantity then raise exception 'Insufficient stock in original warehouse to return to supplier'; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.company_id::text,0));
 insert into public.journal_entries(company_id,fiscal_period_id,entry_date,description,reference,source_type,source_id,created_by)
 values(r.company_id,v_period,r.return_date,'مرتجع مشتريات '||r.return_number,r.return_number,'purchase_return',r.id,v_user) returning id into v_journal;
 n:=1; insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
 values(r.company_id,v_journal,n,v_cash_ap,'تخفيض مستحق المورد/رد قيمة المشتريات',r.grand_total,0);
 n:=n+1; insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
 values(r.company_id,v_journal,n,v_inv,'إخراج مخزون مرتجع للمورد',0,r.subtotal);
 if r.vat_total>0 then n:=n+1; insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
 values(r.company_id,v_journal,n,v_vat,'عكس ضريبة مدخلات المشتريات',0,r.vat_total); end if;
 perform public.post_journal_entry(v_journal,v_user);
 insert into public.stock_movements(company_id,product_id,warehouse_id,movement_type,quantity_in,quantity_out,unit_cost,reference_type,reference_id,notes,created_by)
 values(r.company_id,r.product_id,r.warehouse_id,'purchase_return',0,r.quantity,r.unit_cost,'purchase_return',r.id,'إخراج مخزون من مرتجع المشتريات',v_user);
 update public.purchase_returns set status='posted',journal_entry_id=v_journal,posted_at=now(),posted_by=v_user where id=r.id and status='draft';
 insert into public.audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data)
 values(r.company_id,v_user,'purchase_return.posted','purchase_return',r.id,jsonb_build_object('journal_entry_id',v_journal,'quantity',r.quantity,'grand_total',r.grand_total));
 return v_journal;
end
$function$;

revoke all on function public.create_sales_return_draft(uuid,text,date,uuid,uuid,numeric,text) from public, anon;
revoke all on function public.create_purchase_return_draft(uuid,text,date,uuid,numeric,text) from public, anon;
revoke all on function public.post_sales_return(uuid) from public, anon;
revoke all on function public.post_purchase_return(uuid) from public, anon;
grant execute on function public.create_sales_return_draft(uuid,text,date,uuid,uuid,numeric,text) to authenticated;
grant execute on function public.create_purchase_return_draft(uuid,text,date,uuid,numeric,text) to authenticated;
grant execute on function public.post_sales_return(uuid) to authenticated;
grant execute on function public.post_purchase_return(uuid) to authenticated;

commit;
