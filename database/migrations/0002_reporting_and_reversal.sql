-- Reporting views and controlled journal reversal.
begin;

-- A posted entry can only be marked reversed by reverse_journal_entry().
create or replace function guard_journal_entry_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('posted', 'reversed') then
      raise exception 'Posted journal entries cannot be deleted.';
    end if;
    return old;
  end if;

  if old.status = 'reversed' then
    raise exception 'Reversed journal entries are immutable.';
  end if;

  if old.status = 'posted' then
    if new.status <> 'reversed'
       or current_setting('app.reversing_entry_id', true) is distinct from old.id::text then
      raise exception 'Posted journal entries are immutable; use reverse_journal_entry().';
    end if;
  end if;

  if old.status = 'draft' and new.status = 'posted'
     and current_setting('app.posting_entry_id', true) is distinct from old.id::text then
    raise exception 'Use post_journal_entry() to post an entry.';
  end if;
  return new;
end;
$$;

create or replace function reverse_journal_entry(
  p_entry_id uuid,
  p_reversal_date date,
  p_fiscal_period_id uuid,
  p_user_id uuid
) returns uuid language plpgsql as $$
declare
  original journal_entries%rowtype;
  reversal_id uuid;
  target_period fiscal_periods%rowtype;
begin
  select * into original from journal_entries where id = p_entry_id for update;
  if not found then raise exception 'Original journal entry not found.'; end if;
  if original.status <> 'posted' then raise exception 'Only posted entries can be reversed.'; end if;

  select * into target_period from fiscal_periods
   where id = p_fiscal_period_id and company_id = original.company_id for update;
  if not found then raise exception 'Reversal fiscal period not found.'; end if;
  if target_period.status <> 'open' then raise exception 'Reversal fiscal period is closed.'; end if;
  if p_reversal_date < target_period.starts_on or p_reversal_date > target_period.ends_on then
    raise exception 'Reversal date is outside the selected fiscal period.';
  end if;

  insert into journal_entries(
    company_id, fiscal_period_id, entry_date, description, reference,
    source_type, source_id, currency_code, created_by
  ) values (
    original.company_id, p_fiscal_period_id, p_reversal_date,
    'عكس القيد رقم ' || original.entry_number || ' - ' || original.description,
    original.reference, 'reversal', original.id, original.currency_code, p_user_id
  ) returning id into reversal_id;

  insert into journal_lines(
    company_id, journal_entry_id, line_number, account_id, description,
    party_id, cost_center_id, debit, credit
  )
  select company_id, reversal_id, line_number, account_id, description,
         party_id, cost_center_id, credit, debit
    from journal_lines
   where journal_entry_id = original.id
   order by line_number;

  perform post_journal_entry(reversal_id, p_user_id);

  perform set_config('app.reversing_entry_id', original.id::text, true);
  update journal_entries
     set status = 'reversed', reversed_entry_id = reversal_id
   where id = original.id;
  perform set_config('app.reversing_entry_id', '', true);

  insert into audit_logs(company_id, actor_user_id, action, entity_type, entity_id, after_data)
  values (original.company_id, p_user_id, 'journal.reversed', 'journal_entry', original.id,
          jsonb_build_object('reversal_entry_id', reversal_id));
  return reversal_id;
end;
$$;

-- Reversed originals remain in the ledger together with their reversing entries.
create or replace view general_ledger as
select
  e.company_id,
  l.account_id,
  a.code as account_code,
  a.name_ar as account_name,
  a.type as account_type,
  e.id as journal_entry_id,
  e.entry_number,
  e.entry_date,
  e.reference,
  e.description as entry_description,
  l.line_number,
  l.description as line_description,
  l.party_id,
  l.cost_center_id,
  l.debit,
  l.credit,
  case when a.type in ('asset', 'expense') then l.debit - l.credit
       else l.credit - l.debit end as signed_amount,
  sum(case when a.type in ('asset', 'expense') then l.debit - l.credit
           else l.credit - l.debit end)
    over (partition by e.company_id, l.account_id
          order by e.entry_date, e.entry_number, l.line_number
          rows between unbounded preceding and current row) as running_balance
from journal_entries e
join journal_lines l on l.journal_entry_id = e.id
join accounts a on a.id = l.account_id and a.company_id = e.company_id
where e.status in ('posted', 'reversed');

create or replace view trial_balance as
select
  e.company_id,
  a.id as account_id,
  a.code as account_code,
  a.name_ar as account_name,
  a.type as account_type,
  coalesce(sum(l.debit), 0)::numeric(20,2) as debit_total,
  coalesce(sum(l.credit), 0)::numeric(20,2) as credit_total,
  greatest(coalesce(sum(l.debit - l.credit), 0), 0)::numeric(20,2) as debit_balance,
  greatest(coalesce(sum(l.credit - l.debit), 0), 0)::numeric(20,2) as credit_balance
from accounts a
left join journal_lines l on l.account_id = a.id and l.company_id = a.company_id
left join journal_entries e on e.id = l.journal_entry_id
  and e.company_id = a.company_id and e.status in ('posted', 'reversed')
where a.is_active = true
group by e.company_id, a.id, a.company_id, a.code, a.name_ar, a.type;

create or replace view income_statement_accounts as
select
  e.company_id,
  a.id as account_id,
  a.code as account_code,
  a.name_ar as account_name,
  a.type as account_type,
  case when a.type = 'revenue' then sum(l.credit - l.debit)
       when a.type = 'expense' then sum(l.debit - l.credit)
       else 0 end::numeric(20,2) as period_amount
from journal_entries e
join journal_lines l on l.journal_entry_id = e.id
join accounts a on a.id = l.account_id and a.company_id = e.company_id
where e.status in ('posted', 'reversed') and a.type in ('revenue', 'expense')
group by e.company_id, a.id, a.code, a.name_ar, a.type;

commit;
