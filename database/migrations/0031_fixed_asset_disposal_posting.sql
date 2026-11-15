-- Controlled fixed-asset disposal with balanced gain/loss journal.
begin;

create table if not exists public.fixed_asset_disposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  asset_id uuid not null,
  disposal_date date not null,
  proceeds numeric(20,2) not null default 0 check (proceeds >= 0),
  cash_account_id uuid,
  journal_entry_id uuid,
  status text not null default 'posted' check (status in ('posted')),
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  foreign key(company_id,asset_id) references public.fixed_assets(company_id,id),
  foreign key(company_id,cash_account_id) references public.cash_accounts(company_id,id),
  foreign key(company_id,journal_entry_id) references public.journal_entries(company_id,id),
  unique(company_id,asset_id),
  unique(company_id,journal_entry_id),
  check ((proceeds=0 and cash_account_id is null) or (proceeds>0 and cash_account_id is not null))
);

alter table public.fixed_asset_disposals enable row level security;
create policy fixed_asset_disposals_member_read on public.fixed_asset_disposals
 for select to authenticated using (public.can_access_company(company_id));
create policy fixed_asset_disposals_manager_insert on public.fixed_asset_disposals
 for insert to authenticated with check (public.can_manage_company(company_id));
create policy fixed_asset_disposals_manager_update on public.fixed_asset_disposals
 for update to authenticated using (public.can_manage_company(company_id))
 with check (public.can_manage_company(company_id));
create policy fixed_asset_disposals_manager_delete on public.fixed_asset_disposals
 for delete to authenticated using (public.can_manage_company(company_id));
grant select,insert,update,delete on public.fixed_asset_disposals to authenticated;

insert into public.accounts(company_id,parent_id,code,name_ar,name_en,type,is_posting)
select c.id,p.id,'5205','خسائر استبعاد أصول','Loss on disposal of fixed assets','expense',true
from public.companies c
join public.accounts p on p.company_id=c.id and p.code='52'
on conflict(company_id,code) do nothing;

create or replace function public.guard_posted_asset_disposal_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $guard$
begin
 raise exception 'Posted asset disposals are immutable';
end
$guard$;

create trigger fixed_asset_disposals_immutable
before update or delete on public.fixed_asset_disposals
for each row execute function public.guard_posted_asset_disposal_immutable();

create or replace function public.post_fixed_asset_disposal(
 p_asset_id uuid,
 p_disposal_date date,
 p_proceeds numeric,
 p_cash_account_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $function$
declare
 a public.fixed_assets%rowtype;
 ca public.cash_accounts%rowtype;
 v_user uuid;
 v_period uuid;
 v_asset_account uuid;
 v_accumulated_account uuid;
 v_cash_account uuid;
 v_gain_account uuid;
 v_loss_account uuid;
 v_accumulated numeric(20,2);
 v_book_value numeric(20,2);
 v_gain numeric(20,2);
 v_loss numeric(20,2);
 v_journal uuid;
 v_line integer:=0;
begin
 if auth.uid() is null then
  raise exception 'Authentication required' using errcode='42501';
 end if;
 if p_disposal_date is null or p_proceeds is null or p_proceeds<0 then
  raise exception 'Enter a valid disposal date and non-negative proceeds' using errcode='22023';
 end if;

 select * into a from public.fixed_assets where id=p_asset_id for update;
 if not found or not public.can_manage_company(a.company_id) then
  raise exception 'Asset not found or not authorized' using errcode='42501';
 end if;
 if not a.is_active then raise exception 'Only active assets can be disposed'; end if;

 v_user:=public.current_app_user_id();
 if v_user is null then raise exception 'Active application user not found'; end if;

 perform pg_advisory_xact_lock(hashtextextended(a.company_id::text,0));

 if exists(select 1 from public.fixed_asset_disposals d where d.company_id=a.company_id and d.asset_id=a.id) then
  raise exception 'This asset has already been disposed';
 end if;

 select id into v_period from public.fiscal_periods
 where company_id=a.company_id and status='open'
 and p_disposal_date between starts_on and ends_on for update;
 if v_period is null then raise exception 'No open fiscal period contains the disposal date'; end if;

 select id into v_asset_account from public.accounts
 where company_id=a.company_id and code='1201' and is_active and is_posting;
 select id into v_accumulated_account from public.accounts
 where company_id=a.company_id and code='1202' and is_active and is_posting;
 select id into v_gain_account from public.accounts
 where company_id=a.company_id and code='4201' and is_active and is_posting;
 select id into v_loss_account from public.accounts
 where company_id=a.company_id and code='5205' and is_active and is_posting;
 if v_asset_account is null or v_accumulated_account is null or v_gain_account is null or v_loss_account is null then
  raise exception 'Fixed asset, accumulated depreciation, gain and loss accounts must be active posting accounts';
 end if;

 select coalesce(sum(depreciation_amount),0)::numeric(20,2) into v_accumulated
 from public.asset_depreciation
 where company_id=a.company_id and asset_id=a.id and journal_entry_id is not null;
 if v_accumulated > a.acquisition_cost-a.residual_value then
  raise exception 'Accumulated depreciation exceeds depreciable basis';
 end if;
 v_book_value:=a.acquisition_cost-v_accumulated;

 if p_proceeds>0 then
  select * into ca from public.cash_accounts
  where company_id=a.company_id and id=p_cash_account_id and is_active for update;
  if not found or ca.ledger_account_id is null then
   raise exception 'Select an active cash/bank account linked to the chart of accounts';
  end if;
  select id into v_cash_account from public.accounts
  where company_id=a.company_id and id=ca.ledger_account_id and is_active and is_posting;
  if v_cash_account is null then raise exception 'Linked cash/bank ledger account is inactive or non-posting'; end if;
 elsif p_cash_account_id is not null then
  raise exception 'Cash/bank account must be empty when proceeds are zero';
 end if;

 v_gain:=greatest(p_proceeds-v_book_value,0);
 v_loss:=greatest(v_book_value-p_proceeds,0);

 insert into public.journal_entries(
  company_id,fiscal_period_id,entry_date,description,reference,source_type,source_id,created_by
 )
 values(
  a.company_id,v_period,p_disposal_date,'استبعاد الأصل '||a.name_ar,
  a.asset_code||'-DISPOSAL','fixed_asset_disposal',a.id,v_user
 ) returning id into v_journal;

 if v_accumulated>0 then
  v_line:=v_line+1;
  insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
  values(a.company_id,v_journal,v_line,v_accumulated_account,'إقفال مجمع إهلاك الأصل '||a.name_ar,v_accumulated,0);
 end if;
 if p_proceeds>0 then
  v_line:=v_line+1;
  insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
  values(a.company_id,v_journal,v_line,v_cash_account,'متحصلات استبعاد الأصل '||a.name_ar,p_proceeds,0);
 end if;
 v_line:=v_line+1;
 insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
 values(a.company_id,v_journal,v_line,v_asset_account,'إقفال تكلفة الأصل '||a.name_ar,0,a.acquisition_cost);

 if v_gain>0 then
  v_line:=v_line+1;
  insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
  values(a.company_id,v_journal,v_line,v_gain_account,'ربح استبعاد الأصل '||a.name_ar,0,v_gain);
 end if;
 if v_loss>0 then
  v_line:=v_line+1;
  insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,debit,credit)
  values(a.company_id,v_journal,v_line,v_loss_account,'خسارة استبعاد الأصل '||a.name_ar,v_loss,0);
 end if;

 perform public.post_journal_entry(v_journal,v_user);

 insert into public.fixed_asset_disposals(company_id,asset_id,disposal_date,proceeds,cash_account_id,journal_entry_id,created_by)
 values(a.company_id,a.id,p_disposal_date,p_proceeds,p_cash_account_id,v_journal,v_user);

 update public.fixed_assets set is_active=false where id=a.id and company_id=a.company_id;

 insert into public.audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data)
 values(a.company_id,v_user,'fixed_asset.disposed','fixed_asset',a.id,
  jsonb_build_object('journal_entry_id',v_journal,'disposal_date',p_disposal_date,
   'proceeds',p_proceeds,'accumulated_depreciation',v_accumulated,
   'net_book_value',v_book_value,'gain',v_gain,'loss',v_loss));

 return v_journal;
end
$function$;

revoke all on function public.post_fixed_asset_disposal(uuid,date,numeric,uuid) from public,anon;
grant execute on function public.post_fixed_asset_disposal(uuid,date,numeric,uuid) to authenticated;

commit;
