-- Cash and bank balances based on posted movements only.
begin;
create or replace view public.cash_flow_summary with (security_invoker = true) as
select c.company_id,c.id as cash_account_id,c.code,c.name_ar,c.account_type,c.currency_code,c.opening_balance,
       coalesce(sum(case when t.status='posted' and t.transaction_type in ('receipt','transfer_in') then t.amount else 0 end),0)::numeric(20,2) as receipts,
       coalesce(sum(case when t.status='posted' and t.transaction_type in ('payment','transfer_out') then t.amount else 0 end),0)::numeric(20,2) as payments,
       (c.opening_balance
        + coalesce(sum(case when t.status='posted' and t.transaction_type in ('receipt','transfer_in') then t.amount else 0 end),0)
        - coalesce(sum(case when t.status='posted' and t.transaction_type in ('payment','transfer_out') then t.amount else 0 end),0))::numeric(20,2) as closing_balance
from public.cash_accounts c left join public.cash_transactions t
  on t.company_id=c.company_id and t.cash_account_id=c.id
group by c.company_id,c.id,c.code,c.name_ar,c.account_type,c.currency_code,c.opening_balance;
grant select on public.cash_flow_summary to authenticated;
commit;
