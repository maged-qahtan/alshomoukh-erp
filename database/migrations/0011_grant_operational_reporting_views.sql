-- Expose company-scoped operational reporting views to authenticated members.
begin;
grant select on public.stock_on_hand, public.balance_sheet_accounts, public.vat_summary to authenticated;
commit;
