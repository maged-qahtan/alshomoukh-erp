alter table public.cash_accounts add column if not exists ledger_account_id uuid;
alter table public.cash_accounts add constraint cash_accounts_company_ledger_account_fk foreign key(company_id,ledger_account_id) references public.accounts(company_id,id);
alter table public.cash_transactions add column if not exists contra_account_id uuid;
alter table public.cash_transactions add column if not exists journal_entry_id uuid references public.journal_entries(id);
alter table public.cash_transactions add column if not exists posted_by uuid references public.app_users(id);
alter table public.cash_transactions add column if not exists posted_at timestamptz;
alter table public.cash_transactions add constraint cash_transactions_company_contra_account_fk foreign key(company_id,contra_account_id) references public.accounts(company_id,id);
create unique index if not exists cash_transactions_journal_entry_uidx on public.cash_transactions(journal_entry_id) where journal_entry_id is not null;
create or replace function public.post_cash_transaction(p_transaction_id uuid)
returns uuid language plpgsql security invoker set search_path=pg_catalog,public,auth as $$
declare t public.cash_transactions%rowtype; ca public.cash_accounts%rowtype; v_user uuid; v_period uuid; v_journal uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into t from public.cash_transactions where id=p_transaction_id for update;
 if not found or not public.can_manage_company(t.company_id) then raise exception 'Transaction not found or not authorized' using errcode='42501'; end if;
 if t.status<>'draft' or t.journal_entry_id is not null then raise exception 'Only draft cash transactions can be posted'; end if;
 if t.transaction_type not in ('receipt','payment') then raise exception 'Only receipt and payment transactions can be posted through this workflow'; end if;
 if t.contra_account_id is null then raise exception 'Select the corresponding account before posting'; end if;
 v_user:=public.current_app_user_id(); if v_user is null then raise exception 'Active application user not found'; end if;
 select * into ca from public.cash_accounts where id=t.cash_account_id and company_id=t.company_id and is_active for update;
 if not found or ca.ledger_account_id is null then raise exception 'Cash/bank account must be linked to an active ledger account'; end if;
 if not exists(select 1 from public.accounts a where a.id=ca.ledger_account_id and a.company_id=t.company_id and a.is_active and a.is_posting) then raise exception 'Linked cash/bank ledger account is inactive or non-posting'; end if;
 if not exists(select 1 from public.accounts a where a.id=t.contra_account_id and a.company_id=t.company_id and a.is_active and a.is_posting) then raise exception 'Counter account is inactive or non-posting'; end if;
 if t.party_id is not null and not exists(select 1 from public.parties p where p.id=t.party_id and p.company_id=t.company_id and p.is_active) then raise exception 'Party is not active in this company'; end if;
 select id into v_period from public.fiscal_periods where company_id=t.company_id and status='open' and t.transaction_date between starts_on and ends_on for update;
 if v_period is null then raise exception 'No open fiscal period contains transaction date'; end if;
 insert into public.journal_entries(company_id,fiscal_period_id,entry_date,description,reference,source_type,source_id,created_by)
 values(t.company_id,v_period,t.transaction_date,t.description,t.reference,'cash_transaction',t.id,v_user) returning id into v_journal;
 if t.transaction_type='receipt' then
  insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,party_id,debit,credit) values(t.company_id,v_journal,1,ca.ledger_account_id,t.description,t.party_id,t.amount,0);
  insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,party_id,debit,credit) values(t.company_id,v_journal,2,t.contra_account_id,t.description,t.party_id,0,t.amount);
 else
  insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,party_id,debit,credit) values(t.company_id,v_journal,1,t.contra_account_id,t.description,t.party_id,t.amount,0);
  insert into public.journal_lines(company_id,journal_entry_id,line_number,account_id,description,party_id,debit,credit) values(t.company_id,v_journal,2,ca.ledger_account_id,t.description,t.party_id,0,t.amount);
 end if;
 perform public.post_journal_entry(v_journal,v_user);
 update public.cash_transactions set status='posted',journal_entry_id=v_journal,posted_at=now(),posted_by=v_user where id=t.id and status='draft';
 insert into public.audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data) values(t.company_id,v_user,'cash_transaction.posted','cash_transaction',t.id,jsonb_build_object('journal_entry_id',v_journal,'amount',t.amount,'transaction_type',t.transaction_type));
 return v_journal;
end $$;
revoke all on function public.post_cash_transaction(uuid) from public,anon;
grant execute on function public.post_cash_transaction(uuid) to authenticated;
