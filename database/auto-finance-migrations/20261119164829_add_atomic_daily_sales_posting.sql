-- AUTO-FINANCE only. Daily sales ledger foundation and state guard.
insert into public.accounts(company_id,parent_account_id,code,name_ar,name_en,account_class,normal_balance,is_posting,is_active,description)
select c.id,p.id,v.code,v.name_ar,v.name_en,v.account_class,v.normal_balance,true,true,v.description
from public.companies c
cross join (values
 ('1180','مستحقات مدى','Mada clearing','asset','debit','مبالغ مدى قيد التسوية'),
 ('1181','مستحقات تابي','Tabby clearing','asset','debit','مبالغ تابي قيد التسوية'),
 ('1182','مستحقات تمارا','Tamara clearing','asset','debit','مبالغ تمارا قيد التسوية'),
 ('1183','مستحقات بوابات دفع أخرى','Other payment clearing','asset','debit','مبالغ بوابات الدفع الأخرى قيد التسوية')
) v(code,name_ar,name_en,account_class,normal_balance,description)
join public.accounts p on p.company_id=c.id and p.code='1100'
where not exists(select 1 from public.accounts a where a.company_id=c.id and a.code=v.code);

insert into public.accounts(company_id,parent_account_id,code,name_ar,name_en,account_class,normal_balance,is_posting,is_active,description)
select c.id,p.id,v.code,v.name_ar,v.name_en,'revenue','debit',true,true,v.description
from public.companies c
cross join (values
 ('4190','خصومات المبيعات','Sales discounts','الخصومات الممنوحة للعملاء'),
 ('4191','مردودات المبيعات','Sales returns','مرتجعات ومردودات المبيعات')
) v(code,name_ar,name_en,description)
join public.accounts p on p.company_id=c.id and p.code='4000'
where not exists(select 1 from public.accounts a where a.company_id=c.id and a.code=v.code);

create or replace function private.guard_daily_sale_state()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then
   if old.status='posted' then raise exception 'Posted daily sales are immutable; use a reversal workflow'; end if;
   return old;
 end if;
 if old.status='posted' then raise exception 'Posted daily sales are immutable; use a reversal workflow'; end if;
 if new.status='posted' and coalesce(current_setting('app.allow_daily_sale_post',true),'') <> old.id::text then
   raise exception 'Daily sales must be posted through the controlled posting function';
 end if;
 return new;
end;
$$;
drop trigger if exists daily_sales_state_guard on public.daily_sales;
create trigger daily_sales_state_guard before update or delete on public.daily_sales
for each row execute function private.guard_daily_sale_state();
