-- Atomic sales posting. Payment totals are net tender amounts; allocations are gross revenue.
create or replace function public.record_daily_sale(
 p_company_id uuid,p_branch_id uuid,p_sales_date date,
 p_mada_gross numeric,p_cash_gross numeric,p_tabby_gross numeric,p_tamara_gross numeric,
 p_bank_transfer_gross numeric,p_other_gross numeric,p_discounts numeric,p_returns numeric,
 p_allocations jsonb,p_notes text default null,p_fiscal_period_id uuid default null
) returns uuid
language plpgsql security invoker set search_path=pg_catalog
as $$
declare
 v_user_id uuid:=auth.uid(); v_sale_id uuid:=gen_random_uuid(); v_journal_id uuid;
 v_collected numeric; v_revenue numeric; v_allocated numeric; v_bad bigint; v_lines jsonb;
 v_mada uuid; v_cash uuid; v_tabby uuid; v_tamara uuid; v_bank uuid; v_other uuid; v_discount uuid; v_returns uuid;
begin
 if v_user_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if not private.can_access_company(p_company_id,true) then raise exception 'Company access denied' using errcode='42501'; end if;
 if p_sales_date is null or p_branch_id is null or jsonb_typeof(p_allocations)<>'array' then raise exception 'Sales date, branch and revenue allocations are required' using errcode='22023'; end if;
 if num_nonnulls(p_mada_gross,p_cash_gross,p_tabby_gross,p_tamara_gross,p_bank_transfer_gross,p_other_gross,p_discounts,p_returns)<>8
  or least(p_mada_gross,p_cash_gross,p_tabby_gross,p_tamara_gross,p_bank_transfer_gross,p_other_gross,p_discounts,p_returns)<0
  or greatest(p_mada_gross,p_cash_gross,p_tabby_gross,p_tamara_gross,p_bank_transfer_gross,p_other_gross,p_discounts,p_returns)<>
     round(greatest(p_mada_gross,p_cash_gross,p_tabby_gross,p_tamara_gross,p_bank_transfer_gross,p_other_gross,p_discounts,p_returns),2)
 then raise exception 'All sales amounts must be non-negative and rounded to two decimals' using errcode='22023'; end if;
 v_collected:=p_mada_gross+p_cash_gross+p_tabby_gross+p_tamara_gross+p_bank_transfer_gross+p_other_gross;
 v_revenue:=v_collected+p_discounts+p_returns;
 if v_collected<=0 then raise exception 'At least one positive payment amount is required' using errcode='23514'; end if;
 if not exists(select 1 from public.branches b where b.id=p_branch_id and b.company_id=p_company_id and b.is_active) then raise exception 'Select an active branch belonging to this company' using errcode='23514'; end if;
 select coalesce(sum(x.amount),0),count(*) into v_allocated,v_bad from jsonb_to_recordset(p_allocations) x(account_id uuid,amount numeric);
 if v_bad<1 or v_allocated<>v_revenue then raise exception 'Revenue allocations must equal collected payments plus discounts and returns' using errcode='23514'; end if;
 select count(*) into v_bad from jsonb_to_recordset(p_allocations) x(account_id uuid,amount numeric)
 left join public.accounts a on a.id=x.account_id and a.company_id=p_company_id
 where x.account_id is null or x.amount is null or x.amount<=0 or x.amount<>round(x.amount,2)
  or a.id is null or a.is_active is not true or a.is_posting is not true or a.account_class<>'revenue';
 if v_bad>0 then raise exception 'Each allocation must use an active revenue posting account and a positive amount' using errcode='23514'; end if;
 select max(id) filter(where code='1180'),max(id) filter(where code='1110'),
  max(id) filter(where code='1181'),max(id) filter(where code='1182'),
  max(id) filter(where code='1120'),max(id) filter(where code='1183'),
  max(id) filter(where code='4190'),max(id) filter(where code='4191')
 into v_mada,v_cash,v_tabby,v_tamara,v_bank,v_other,v_discount,v_returns
 from public.accounts where company_id=p_company_id and is_active and is_posting;
 if (p_mada_gross>0 and v_mada is null) or (p_cash_gross>0 and v_cash is null)
  or (p_tabby_gross>0 and v_tabby is null) or (p_tamara_gross>0 and v_tamara is null)
  or (p_bank_transfer_gross>0 and v_bank is null) or (p_other_gross>0 and v_other is null)
  or (p_discounts>0 and v_discount is null) or (p_returns>0 and v_returns is null)
 then raise exception 'Required sales or clearing accounts are not configured' using errcode='23514'; end if;
 insert into public.daily_sales(id,company_id,branch_id,sales_date,mada_gross,cash_gross,tabby_gross,tamara_gross,bank_transfer_gross,other_gross,discounts,returns,status,notes,created_by)
 values(v_sale_id,p_company_id,p_branch_id,p_sales_date,p_mada_gross,p_cash_gross,p_tabby_gross,p_tamara_gross,p_bank_transfer_gross,p_other_gross,p_discounts,p_returns,'draft',nullif(btrim(p_notes),''),v_user_id);
 insert into public.daily_sale_allocations(company_id,daily_sale_id,revenue_account_id,amount)
 select p_company_id,v_sale_id,x.account_id,x.amount from jsonb_to_recordset(p_allocations) x(account_id uuid,amount numeric);
 select jsonb_agg(jsonb_build_object('account_id',q.account_id,'debit',q.debit,'credit',q.credit,'description',q.description) order by q.line_order) into v_lines
 from (
  select 1 line_order,v_cash account_id,p_cash_gross debit,0::numeric credit,'مبيعات نقدية'::text description where p_cash_gross>0
  union all select 2,v_mada,p_mada_gross,0,'مبيعات مدى' where p_mada_gross>0
  union all select 3,v_tabby,p_tabby_gross,0,'مبيعات تابي' where p_tabby_gross>0
  union all select 4,v_tamara,p_tamara_gross,0,'مبيعات تمارا' where p_tamara_gross>0
  union all select 5,v_bank,p_bank_transfer_gross,0,'تحويلات بنكية' where p_bank_transfer_gross>0
  union all select 6,v_other,p_other_gross,0,'وسائل دفع أخرى' where p_other_gross>0
  union all select 7,v_discount,p_discounts,0,'خصومات المبيعات' where p_discounts>0
  union all select 8,v_returns,p_returns,0,'مردودات المبيعات' where p_returns>0
  union all select 100+row_number() over(order by x.account_id),x.account_id,0::numeric,x.amount,'إيرادات المبيعات'
   from jsonb_to_recordset(p_allocations) x(account_id uuid,amount numeric)
 ) q;
 v_journal_id:=public.create_journal_entry_draft(p_company_id,p_branch_id,p_fiscal_period_id,p_sales_date,'مبيعات يومية - '||to_char(p_sales_date,'YYYY-MM-DD'),v_lines);
 perform public.post_journal_entry(p_company_id,v_journal_id);
 perform set_config('app.allow_daily_sale_post',v_sale_id::text,true);
 update public.daily_sales set journal_entry_id=v_journal_id,status='posted',updated_at=now() where id=v_sale_id and company_id=p_company_id and status='draft';
 return v_sale_id;
end;
$$;
revoke all on function public.record_daily_sale(uuid,uuid,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,jsonb,text,uuid) from public,anon;
grant execute on function public.record_daily_sale(uuid,uuid,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,jsonb,text,uuid) to authenticated;
