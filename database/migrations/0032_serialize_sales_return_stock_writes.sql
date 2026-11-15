-- Remove an unused pre-lock stock snapshot from sales-return posting.
-- The returned goods are an inbound movement; availability is not a precondition.
-- Keep the company stock lock before journal and stock movement writes.
begin;

create or replace function public.post_sales_return(p_return_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $function$
declare
 r public.sales_returns%rowtype;
 v_user uuid;
 v_period uuid;
 v_journal uuid;
 v_cash_ar uuid;
 v_rev uuid;
 v_vat uuid;
 v_inv uuid;
 v_cogs uuid;
 v_cost numeric;
 n int:=0;
begin
 if auth.uid() is null then
  raise exception 'Authentication required' using errcode='42501';
 end if;
 select * into r from public.sales_returns where id=p_return_id for update;
 if not found or not public.can_manage_company(r.company_id) then
  raise exception 'Return not found or not authorized' using errcode='42501';
 end if;
 if r.status<>'draft' or r.journal_entry_id is not null then
  raise exception 'Only draft sales returns can be posted';
 end if;
 v_user:=public.current_app_user_id();
 if v_user is null then raise exception 'Active application user not found'; end if;

 select id into v_period from public.fiscal_periods
 where company_id=r.company_id and status='open'
 and r.return_date between starts_on and ends_on for update;
 if v_period is null then raise exception 'No open fiscal period contains return date'; end if;

 select id into v_cash_ar from public.accounts
 where company_id=r.company_id
 and code=case when (select customer_id from public.sales_invoices where id=r.original_invoice_id) is null then '1101' else '1103' end
 and is_active and is_posting;
 select id into v_rev from public.accounts where company_id=r.company_id and code='4101' and is_active and is_posting;
 select id into v_vat from public.accounts where company_id=r.company_id and code='2102' and is_active and is_posting;
 select id into v_inv from public.accounts where company_id=r.company_id and code='1104' and is_active and is_posting;
 select id into v_cogs from public.accounts where company_id=r.company_id and code='5101' and is_active and is_posting;
 if v_cash_ar is null or v_rev is null or v_inv is null or v_cogs is null or (r.vat_total>0 and v_vat is null) then
  raise exception 'Required return posting accounts are missing';
 end if;

 v_cost:=round(r.quantity*r.unit_cost,2);
 -- Serialize stock-writing operations using the same company lock as invoice posting.
 perform pg_advisory_xact_lock(hashtextextended(r.company_id::text,0));

 insert into public.journal_entries(company_id,fiscal_period_id,entry_date,description,reference,source_type,source_id,created_by)
 values(r.company_id,v_period,r.return_date,'مرتجع مبيعات '||r.return_number,r.return_number,'sales_return',r.id,v_user)
 returning id into v_journal;

 insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,party_id,debit,credit)
 values(r.company_id,v_journal,1,v_rev,'عكس إيراد المبيعات',
 (select customer_id from public.sales_invoices where id=r.original_invoice_id),r.subtotal,0);
 n:=1;
 if r.vat_total>0 then
  n:=n+1;
  insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
  values(r.company_id,v_journal,n,v_vat,'عكس ضريبة مخرجات المبيعات',r.vat_total,0);
 end if;
 n:=n+1;
 insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,party_id,debit,credit)
 values(r.company_id,v_journal,n,v_cash_ar,'رد قيمة مرتجع المبيعات',
 (select customer_id from public.sales_invoices where id=r.original_invoice_id),0,r.grand_total);
 if v_cost>0 then
  n:=n+1;
  insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
  values(r.company_id,v_journal,n,v_inv,'إعادة تكلفة البضاعة المرتجعة للمخزون',v_cost,0);
  n:=n+1;
  insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
  values(r.company_id,v_journal,n,v_cogs,'عكس تكلفة البضاعة المباعة',0,v_cost);
 end if;

 perform public.post_journal_entry(v_journal,v_user);

 insert into public.stock_movements(company_id,product_id,warehouse_id,movement_type,quantity_in,quantity_out,unit_cost,reference_type,reference_id,notes,created_by)
 values(r.company_id,r.product_id,r.warehouse_id,'sale_return',r.quantity,0,r.unit_cost,'sales_return',r.id,'إضافة مخزون من مرتجع المبيعات',v_user);

 update public.sales_returns
 set status='posted',journal_entry_id=v_journal,posted_at=now(),posted_by=v_user
 where id=r.id and status='draft';
 if not found then raise exception 'Sales return changed during posting'; end if;

 insert into public.audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data)
 values(r.company_id,v_user,'sales_return.posted','sales_return',r.id,
 jsonb_build_object('journal_entry_id',v_journal,'quantity',r.quantity,'grand_total',r.grand_total));
 return v_journal;
end
$function$;

revoke all on function public.post_sales_return(uuid) from public,anon;
grant execute on function public.post_sales_return(uuid) to authenticated;

commit;
