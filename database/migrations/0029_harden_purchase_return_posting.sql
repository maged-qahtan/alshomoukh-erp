-- Harden purchase-return stock availability checks and protect posted returns.
begin;

create or replace function public.guard_posted_return_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $guard$
begin
  if old.status = 'posted' then
    raise exception 'Posted returns are immutable; create a documented reversal instead';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$guard$;

drop trigger if exists sales_returns_posted_immutable on public.sales_returns;
create trigger sales_returns_posted_immutable
before update or delete on public.sales_returns
for each row execute function public.guard_posted_return_immutable();

drop trigger if exists purchase_returns_posted_immutable on public.purchase_returns;
create trigger purchase_returns_posted_immutable
before update or delete on public.purchase_returns
for each row execute function public.guard_posted_return_immutable();

create or replace function public.post_purchase_return(p_return_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $function$
declare
 r public.purchase_returns%rowtype;
 v_user uuid;
 v_period uuid;
 v_journal uuid;
 v_cash_ap uuid;
 v_inv uuid;
 v_vat uuid;
 v_stock numeric;
 n int := 0;
begin
 if auth.uid() is null then
  raise exception 'Authentication required' using errcode='42501';
 end if;

 select * into r from public.purchase_returns where id=p_return_id for update;
 if not found or not public.can_manage_company(r.company_id) then
  raise exception 'Return not found or not authorized' using errcode='42501';
 end if;
 if r.status<>'draft' or r.journal_entry_id is not null then
  raise exception 'Only draft purchase returns can be posted';
 end if;

 v_user:=public.current_app_user_id();
 if v_user is null then raise exception 'Active application user not found'; end if;

 select id into v_period
 from public.fiscal_periods
 where company_id=r.company_id and status='open'
   and r.return_date between starts_on and ends_on
 for update;
 if v_period is null then raise exception 'No open fiscal period contains return date'; end if;

 select id into v_cash_ap from public.accounts
 where company_id=r.company_id
   and code=case when (select supplier_id from public.purchase_invoices where id=r.original_invoice_id) is null then '1101' else '2101' end
   and is_active and is_posting;
 select id into v_inv from public.accounts
 where company_id=r.company_id and code='1104' and is_active and is_posting;
 select id into v_vat from public.accounts
 where company_id=r.company_id and code='1105' and is_active and is_posting;
 if v_cash_ap is null or v_inv is null or (r.vat_total>0 and v_vat is null) then
  raise exception 'Required return posting accounts are missing';
 end if;

 -- Serialize stock availability read with invoice and other stock posting operations.
 perform pg_advisory_xact_lock(hashtextextended(r.company_id::text,0));
 select coalesce(sum(quantity_on_hand),0) into v_stock
 from public.stock_on_hand
 where company_id=r.company_id and product_id=r.product_id and warehouse_id=r.warehouse_id;
 if v_stock<r.quantity then
  raise exception 'Insufficient stock in original warehouse to return to supplier';
 end if;

 insert into public.journal_entries(
  company_id,fiscal_period_id,entry_date,description,reference,source_type,source_id,created_by
 )
 values(
  r.company_id,v_period,r.return_date,'مرتجع مشتريات '||r.return_number,
  r.return_number,'purchase_return',r.id,v_user
 ) returning id into v_journal;

 n:=1;
 insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
 values(r.company_id,v_journal,n,v_cash_ap,'تخفيض مستحق المورد/رد قيمة المشتريات',r.grand_total,0);
 n:=n+1;
 insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
 values(r.company_id,v_journal,n,v_inv,'إخراج مخزون مرتجع للمورد',0,r.subtotal);
 if r.vat_total>0 then
  n:=n+1;
  insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
  values(r.company_id,v_journal,n,v_vat,'عكس ضريبة مدخلات المشتريات',0,r.vat_total);
 end if;

 perform public.post_journal_entry(v_journal,v_user);

 insert into public.stock_movements(
  company_id,product_id,warehouse_id,movement_type,quantity_in,quantity_out,
  unit_cost,reference_type,reference_id,notes,created_by
 )
 values(
  r.company_id,r.product_id,r.warehouse_id,'purchase_return',0,r.quantity,
  r.unit_cost,'purchase_return',r.id,'إخراج مخزون من مرتجع المشتريات',v_user
 );

 update public.purchase_returns
 set status='posted',journal_entry_id=v_journal,posted_at=now(),posted_by=v_user
 where id=r.id and status='draft';
 if not found then raise exception 'Purchase return changed during posting'; end if;

 insert into public.audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data)
 values(
  r.company_id,v_user,'purchase_return.posted','purchase_return',r.id,
  jsonb_build_object('journal_entry_id',v_journal,'quantity',r.quantity,'grand_total',r.grand_total)
 );
 return v_journal;
end
$function$;

revoke all on function public.post_purchase_return(uuid) from public, anon;
grant execute on function public.post_purchase_return(uuid) to authenticated;

commit;
