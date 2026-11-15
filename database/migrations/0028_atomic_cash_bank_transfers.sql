-- Atomic, auditable cash/bank transfers.
-- A transfer is represented by two cash_transactions rows and one balanced journal entry.
begin;

alter table public.cash_transactions
  add column if not exists transfer_group_id uuid,
  add column if not exists transfer_counter_account_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cash_transactions_company_transfer_counter_fk'
      and conrelid = 'public.cash_transactions'::regclass
  ) then
    alter table public.cash_transactions
      add constraint cash_transactions_company_transfer_counter_fk
      foreign key (company_id, transfer_counter_account_id)
      references public.cash_accounts(company_id, id);
  end if;
end $$;

-- A normal receipt/payment has one transaction per journal entry. A transfer
-- deliberately has two linked transaction rows pointing to the same entry.
drop index if exists public.cash_transactions_journal_entry_uidx;
create unique index if not exists cash_transactions_single_journal_entry_uidx
  on public.cash_transactions(journal_entry_id)
  where journal_entry_id is not null and transfer_group_id is null;
create index if not exists cash_transactions_transfer_journal_idx
  on public.cash_transactions(journal_entry_id)
  where journal_entry_id is not null and transfer_group_id is not null;
create unique index if not exists cash_transactions_transfer_group_account_uidx
  on public.cash_transactions(transfer_group_id, cash_account_id)
  where transfer_group_id is not null;

create or replace function public.post_cash_transfer(
  p_source_transaction_id uuid,
  p_destination_cash_account_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public, auth
as $$
declare
  t public.cash_transactions%rowtype;
  source_ca public.cash_accounts%rowtype;
  destination_ca public.cash_accounts%rowtype;
  v_user uuid;
  v_period uuid;
  v_journal uuid;
  v_transfer_group uuid := gen_random_uuid();
  v_destination_transaction uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into t
  from public.cash_transactions
  where id = p_source_transaction_id
  for update;

  if not found or not public.can_manage_company(t.company_id) then
    raise exception 'Transfer not found or not authorized' using errcode = '42501';
  end if;

  if t.status <> 'draft'
     or t.transaction_type <> 'transfer_out'
     or t.journal_entry_id is not null
     or t.transfer_group_id is not null then
    raise exception 'Only an unposted draft transfer-out transaction can be posted';
  end if;

  if p_destination_cash_account_id is null
     or p_destination_cash_account_id = t.cash_account_id then
    raise exception 'Choose a different destination cash/bank account';
  end if;

  if t.amount <= 0 then
    raise exception 'Transfer amount must be greater than zero';
  end if;

  v_user := public.current_app_user_id();
  if v_user is null then
    raise exception 'Active application user not found' using errcode = '42501';
  end if;

  -- Lock both accounts in a stable order to reduce deadlock risk when
  -- simultaneous transfers use the same pair in opposite directions.
  perform 1
  from public.cash_accounts
  where company_id = t.company_id
    and id in (t.cash_account_id, p_destination_cash_account_id)
  order by id
  for update;

  select * into source_ca
  from public.cash_accounts
  where id = t.cash_account_id
    and company_id = t.company_id
    and is_active;

  if not found or source_ca.ledger_account_id is null then
    raise exception 'Source cash/bank account must be active and linked to a ledger account';
  end if;

  select * into destination_ca
  from public.cash_accounts
  where id = p_destination_cash_account_id
    and company_id = t.company_id
    and is_active;

  if not found or destination_ca.ledger_account_id is null then
    raise exception 'Destination cash/bank account must be active and linked to a ledger account';
  end if;

  if source_ca.currency_code <> destination_ca.currency_code
     or t.currency_code <> source_ca.currency_code then
    raise exception 'Transfers require matching transaction and account currencies';
  end if;

  if source_ca.ledger_account_id = destination_ca.ledger_account_id then
    raise exception 'Source and destination must use different ledger accounts';
  end if;

  if not exists (
    select 1 from public.accounts a
    where a.id = source_ca.ledger_account_id
      and a.company_id = t.company_id
      and a.is_active and a.is_posting
  ) then
    raise exception 'Source ledger account is inactive or non-posting';
  end if;

  if not exists (
    select 1 from public.accounts a
    where a.id = destination_ca.ledger_account_id
      and a.company_id = t.company_id
      and a.is_active and a.is_posting
  ) then
    raise exception 'Destination ledger account is inactive or non-posting';
  end if;

  select id into v_period
  from public.fiscal_periods
  where company_id = t.company_id
    and status = 'open'
    and t.transaction_date between starts_on and ends_on
  for update;

  if v_period is null then
    raise exception 'No open fiscal period contains transfer date';
  end if;

  insert into public.journal_entries(
    company_id, fiscal_period_id, entry_date, description, reference,
    source_type, source_id, created_by
  )
  values (
    t.company_id, v_period, t.transaction_date,
    'تحويل بين حسابات النقدية: ' || source_ca.name_ar || ' ← ' || destination_ca.name_ar,
    t.reference, 'cash_transfer', t.id, v_user
  )
  returning id into v_journal;

  -- Debit destination, credit source: one balanced entry for the full transfer.
  insert into public.journal_lines(
    company_id, journal_entry_id, line_number, account_id, description, debit, credit
  )
  values
    (t.company_id, v_journal, 1, destination_ca.ledger_account_id,
     'تحويل وارد إلى ' || destination_ca.name_ar, t.amount, 0),
    (t.company_id, v_journal, 2, source_ca.ledger_account_id,
     'تحويل صادر من ' || source_ca.name_ar, 0, t.amount);

  perform public.post_journal_entry(v_journal, v_user);

  insert into public.cash_transactions(
    company_id, cash_account_id, transaction_date, transaction_type, amount,
    reference, description, status, created_by, transfer_group_id,
    transfer_counter_account_id, journal_entry_id, posted_at, posted_by
  )
  values (
    t.company_id, destination_ca.id, t.transaction_date, 'transfer_in', t.amount,
    t.reference, 'تحويل وارد من ' || source_ca.name_ar || ': ' || t.description,
    'posted', v_user, v_transfer_group, source_ca.id, v_journal, now(), v_user
  )
  returning id into v_destination_transaction;

  update public.cash_transactions
  set status = 'posted',
      transfer_group_id = v_transfer_group,
      transfer_counter_account_id = destination_ca.id,
      journal_entry_id = v_journal,
      posted_at = now(),
      posted_by = v_user
  where id = t.id
    and company_id = t.company_id
    and status = 'draft'
    and journal_entry_id is null;

  if not found then
    raise exception 'Source transfer changed during posting';
  end if;

  insert into public.audit_logs(
    company_id, actor_user_id, action, entity_type, entity_id, after_data
  )
  values (
    t.company_id, v_user, 'cash_transfer.posted', 'cash_transfer', t.id,
    jsonb_build_object(
      'transfer_group_id', v_transfer_group,
      'source_transaction_id', t.id,
      'destination_transaction_id', v_destination_transaction,
      'source_cash_account_id', source_ca.id,
      'destination_cash_account_id', destination_ca.id,
      'journal_entry_id', v_journal,
      'amount', t.amount,
      'currency_code', t.currency_code
    )
  );

  return v_journal;
end;
$$;

revoke all on function public.post_cash_transfer(uuid, uuid) from public, anon;
grant execute on function public.post_cash_transfer(uuid, uuid) to authenticated;

commit;
