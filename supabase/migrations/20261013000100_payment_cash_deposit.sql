-- Checks & Cash: cash is never mailed — it goes into the agency trust account and is applied from there. So a cash
-- payment moves received → deposited (date, who, deposit reference) → applied. Checks and money orders keep
-- received → mailed → applied. Like the other steps, the deposit details can't be changed once recorded.
-- "received_by" is who accepted the money (picked when it's logged); received_by_user is who logged it.
alter table public.payment_receipts add column if not exists deposited_on date;
alter table public.payment_receipts add column if not exists deposited_by text;
alter table public.payment_receipts add column if not exists deposited_ref text;
alter table public.payment_receipts drop constraint if exists payment_receipts_status_check,
  add constraint payment_receipts_status_check check (status in ('received', 'mailed', 'deposited', 'applied', 'returned', 'void'));

create or replace function public.payment_receipt_guard() returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Payment records are permanent and can''t be deleted. Void it with a reason instead.'; end if;
  if (new.agency_id, new.received_on, new.method, new.amount, new.payer, new.insured, new.account_number, new.carrier, new.check_number,
      new.check_date, new.amount_due, new.note, new.received_by, new.received_by_user, new.created_at)
     is distinct from
     (old.agency_id, old.received_on, old.method, old.amount, old.payer, old.insured, old.account_number, old.carrier, old.check_number,
      old.check_date, old.amount_due, old.note, old.received_by, old.received_by_user, old.created_at) then
    raise exception 'What was received can''t be changed once logged. Void it with a reason and log it again.';
  end if;
  if old.scan_path is not null and new.scan_path is distinct from old.scan_path then raise exception 'The scan is already attached and can''t be replaced.'; end if;
  if old.mailed_on is not null and (new.mailed_on, new.mailed_by, new.mailed_note) is distinct from (old.mailed_on, old.mailed_by, old.mailed_note) then
    raise exception 'The mailing details are already recorded and can''t be changed.';
  end if;
  if old.deposited_on is not null and (new.deposited_on, new.deposited_by, new.deposited_ref) is distinct from (old.deposited_on, old.deposited_by, old.deposited_ref) then
    raise exception 'The deposit details are already recorded and can''t be changed.';
  end if;
  if old.applied_on is not null and (new.applied_on, new.applied_by, new.applied_ref, new.applied_note) is distinct from (old.applied_on, old.applied_by, old.applied_ref, old.applied_note) then
    raise exception 'The application details are already recorded and can''t be changed.';
  end if;
  if old.closed_at is not null and (new.closed_reason, new.closed_by, new.closed_at) is distinct from (old.closed_reason, old.closed_by, old.closed_at) then
    raise exception 'The return/void details are already recorded and can''t be changed.';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'received' and new.status in ('mailed', 'deposited', 'applied', 'returned', 'void'))
    or (old.status in ('mailed', 'deposited') and new.status in ('applied', 'returned'))
    or (old.status = 'applied' and new.status = 'returned')) then
    raise exception 'A payment can''t go from % to %.', old.status, new.status;
  end if;
  if new.status = 'mailed' and new.method = 'cash' then raise exception 'Cash isn''t mailed — deposit it to the agency trust account.'; end if;
  if new.status = 'deposited' and new.method <> 'cash' then raise exception 'Only cash is deposited to the trust account; checks are mailed.'; end if;
  if new.status = 'mailed' and new.mailed_on is null then raise exception 'Say when it was mailed.'; end if;
  if new.status = 'deposited' and new.deposited_on is null then raise exception 'Say when it was deposited.'; end if;
  if new.status = 'applied' and new.applied_on is null then raise exception 'Say when it was applied.'; end if;
  if new.status in ('returned', 'void') and coalesce(trim(new.closed_reason), '') = '' then raise exception 'Give a reason.'; end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.payment_receipt_log() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare who text := coalesce((select display_name from public.staff_accounts where user_id = auth.uid()), 'system');
begin
  if tg_op = 'INSERT' then
    insert into public.payment_receipt_events (agency_id, receipt_id, by_name, by_user, action, detail)
    values (new.agency_id, new.id, who, auth.uid(), 'received', format('%s of $%s received on %s, accepted by %s', replace(new.method, '_', ' '), to_char(new.amount, 'FM999,999,990.00'), to_char(new.received_on, 'MM/DD/YYYY'), new.received_by));
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.payment_receipt_events (agency_id, receipt_id, by_name, by_user, action, detail)
    values (new.agency_id, new.id, who, auth.uid(), new.status, case new.status
      when 'mailed' then concat_ws(' · ', 'mailed on ' || to_char(new.mailed_on, 'MM/DD/YYYY'), nullif(new.mailed_note, ''))
      when 'deposited' then concat_ws(' · ', 'deposited to the agency trust account on ' || to_char(new.deposited_on, 'MM/DD/YYYY'), nullif(new.deposited_ref, ''))
      when 'applied' then concat_ws(' · ', 'applied on ' || to_char(new.applied_on, 'MM/DD/YYYY'), nullif(new.applied_ref, ''), nullif(new.applied_note, ''))
      else new.closed_reason end);
  end if;
  if old.scan_path is null and new.scan_path is not null then
    insert into public.payment_receipt_events (agency_id, receipt_id, by_name, by_user, action, detail) values (new.agency_id, new.id, who, auth.uid(), 'scan', 'scan attached');
  end if;
  return new;
end $$;

-- a new payment can't arrive already deposited either
alter policy "payments log" on public.payment_receipts with check (agency_id = current_agency_id() and staff_can('books') and status = 'received' and mailed_on is null and deposited_on is null and applied_on is null and closed_at is null);
