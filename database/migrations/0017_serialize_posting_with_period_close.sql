-- Serialize posting with period closing to prevent a concurrent post during close.
create or replace function public.post_journal_entry(p_entry_id uuid, p_user_id uuid)
returns void
language plpgsql
set search_path to 'pg_catalog','public','auth'
as $function$
declare
  entry_row public.journal_entries%rowtype;
  debit_total numeric(20,2);
  credit_total numeric(20,2);
  line_count integer;
  period_row public.fiscal_periods%rowtype;
begin
  select * into entry_row from public.journal_entries where id=p_entry_id for update;
  if not found then raise exception 'Journal entry not found.'; end if;
  if entry_row.status <> 'draft' then raise exception 'Only draft entries can be posted.'; end if;
  select * into period_row from public.fiscal_periods
   where id=entry_row.fiscal_period_id and company_id=entry_row.company_id for update;
  if not found then raise exception 'Fiscal period not found.'; end if;
  if period_row.status <> 'open' then raise exception 'Fiscal period is closed.'; end if;
  if entry_row.entry_date < period_row.starts_on or entry_row.entry_date > period_row.ends_on then
    raise exception 'Entry date is outside the selected fiscal period.';
  end if;
  select count(*),coalesce(sum(debit),0),coalesce(sum(credit),0)
    into line_count,debit_total,credit_total
    from public.journal_lines where journal_entry_id=p_entry_id;
  if line_count<2 then raise exception 'A journal entry needs at least two lines.'; end if;
  if debit_total<=0 or credit_total<=0 or debit_total<>credit_total then
    raise exception 'Journal entry is not balanced. Debit must equal credit.';
  end if;
  if exists(select 1 from public.journal_lines l join public.accounts a on a.id=l.account_id
    where l.journal_entry_id=p_entry_id and (not a.is_active or not a.is_posting)) then
    raise exception 'An account is inactive or is a non-posting parent account.';
  end if;
  perform set_config('app.posting_entry_id',p_entry_id::text,true);
  update public.journal_entries set status='posted',posted_by=p_user_id,posted_at=now() where id=p_entry_id;
  perform set_config('app.posting_entry_id','',true);
  insert into public.audit_logs(company_id,actor_user_id,action,entity_type,entity_id,after_data)
  values(entry_row.company_id,p_user_id,'journal.posted','journal_entry',p_entry_id,
    jsonb_build_object('debit_total',debit_total,'credit_total',credit_total));
end;
$function$;