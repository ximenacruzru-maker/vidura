-- Checks & Cash: every check, money order and cash payment the office receives, and what happened to it: mailed to the
-- carrier's remittance address with the coupon (Farmers no longer lets agents apply checks in the office), and/or applied
-- to the client's account (when, by whom, with what confirmation). The record is permanent:
--   * nothing can be deleted — no delete policy, delete/truncate revoked, and a trigger refuses deletes outright;
--   * what was received (date, method, amount, payer, account, check number…) can't be changed once logged;
--   * the status only moves forward: received → mailed → applied (either step can be the last), anything before
--     void → returned (bounced), received → void;
--     a mistake is fixed by voiding it with a reason and logging it again, so the history shows both;
--   * every step is written to payment_receipt_events, which is append-only too;
--   * the scan of the check goes in the private payment-records bucket, which allows uploading and reading only.
create table if not exists public.payment_receipts (
  id bigint generated always as identity primary key,
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  received_on date not null,
  method text not null check (method in ('check', 'cash', 'money_order', 'cashiers_check', 'other')),
  amount numeric(12,2) not null check (amount > 0),
  payer text not null,
  insured text,
  account_number text,
  carrier text,
  check_number text,
  check_date date,
  amount_due numeric(12,2),
  note text,
  received_by text not null,
  received_by_user uuid default auth.uid(),
  status text not null default 'received' check (status in ('received', 'mailed', 'applied', 'returned', 'void')),
  mailed_on date,
  mailed_by text,
  mailed_note text,
  applied_on date,
  applied_by text,
  applied_ref text,
  applied_note text,
  closed_reason text,
  closed_by text,
  closed_at timestamptz,
  scan_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payment_receipts_month on public.payment_receipts (agency_id, received_on);
create index if not exists payment_receipts_open on public.payment_receipts (agency_id, status);

create table if not exists public.payment_receipt_events (
  id bigint generated always as identity primary key,
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  receipt_id bigint not null references public.payment_receipts(id),
  at timestamptz not null default now(),
  by_name text,
  by_user uuid default auth.uid(),
  action text not null,
  detail text
);
create index if not exists payment_receipt_events_receipt on public.payment_receipt_events (receipt_id);

-- the guard: what was received is fixed, the status only moves forward, and nothing is ever deleted
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
  if old.applied_on is not null and (new.applied_on, new.applied_by, new.applied_ref, new.applied_note) is distinct from (old.applied_on, old.applied_by, old.applied_ref, old.applied_note) then
    raise exception 'The application details are already recorded and can''t be changed.';
  end if;
  if old.closed_at is not null and (new.closed_reason, new.closed_by, new.closed_at) is distinct from (old.closed_reason, old.closed_by, old.closed_at) then
    raise exception 'The return/void details are already recorded and can''t be changed.';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'received' and new.status in ('mailed', 'applied', 'returned', 'void'))
    or (old.status = 'mailed' and new.status in ('applied', 'returned'))
    or (old.status = 'applied' and new.status = 'returned')) then
    raise exception 'A payment can''t go from % to %.', old.status, new.status;
  end if;
  if new.status = 'mailed' and new.mailed_on is null then raise exception 'Say when it was mailed.'; end if;
  if new.status = 'applied' and new.applied_on is null then raise exception 'Say when it was applied.'; end if;
  if new.status in ('returned', 'void') and coalesce(trim(new.closed_reason), '') = '' then raise exception 'Give a reason.'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists payment_receipt_guard on public.payment_receipts;
create trigger payment_receipt_guard before update or delete on public.payment_receipts for each row execute function public.payment_receipt_guard();

create or replace function public.payment_event_guard() returns trigger language plpgsql set search_path to 'public' as $$
begin raise exception 'The payment history is permanent and can''t be changed or deleted.'; end $$;
drop trigger if exists payment_event_guard on public.payment_receipt_events;
create trigger payment_event_guard before update or delete on public.payment_receipt_events for each row execute function public.payment_event_guard();

-- every step goes in the history
create or replace function public.payment_receipt_log() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare who text := coalesce((select display_name from public.staff_accounts where user_id = auth.uid()), 'system');
begin
  if tg_op = 'INSERT' then
    insert into public.payment_receipt_events (agency_id, receipt_id, by_name, by_user, action, detail)
    values (new.agency_id, new.id, who, auth.uid(), 'received', format('%s of $%s logged as received on %s', replace(new.method, '_', ' '), to_char(new.amount, 'FM999,999,990.00'), to_char(new.received_on, 'MM/DD/YYYY')));
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.payment_receipt_events (agency_id, receipt_id, by_name, by_user, action, detail)
    values (new.agency_id, new.id, who, auth.uid(), new.status, case new.status
      when 'mailed' then concat_ws(' · ', 'mailed on ' || to_char(new.mailed_on, 'MM/DD/YYYY'), nullif(new.mailed_note, ''))
      when 'applied' then concat_ws(' · ', 'applied on ' || to_char(new.applied_on, 'MM/DD/YYYY'), nullif(new.applied_ref, ''), nullif(new.applied_note, ''))
      else new.closed_reason end);
  end if;
  if old.scan_path is null and new.scan_path is not null then
    insert into public.payment_receipt_events (agency_id, receipt_id, by_name, by_user, action, detail) values (new.agency_id, new.id, who, auth.uid(), 'scan', 'scan attached');
  end if;
  return new;
end $$;
drop trigger if exists payment_receipt_log on public.payment_receipts;
create trigger payment_receipt_log after insert or update on public.payment_receipts for each row execute function public.payment_receipt_log();

-- who can see and work it: anyone on staff with Books of Business access, in their own agency; nobody can delete
alter table public.payment_receipts enable row level security;
alter table public.payment_receipt_events enable row level security;
revoke delete, truncate on public.payment_receipts, public.payment_receipt_events from anon, authenticated;
create policy "payments read" on public.payment_receipts for select to authenticated using (agency_id = current_agency_id() and staff_can('books'));
create policy "payments log" on public.payment_receipts for insert to authenticated with check (agency_id = current_agency_id() and staff_can('books') and status = 'received' and mailed_on is null and applied_on is null and closed_at is null);
create policy "payments work" on public.payment_receipts for update to authenticated using (agency_id = current_agency_id() and staff_can('books')) with check (agency_id = current_agency_id());
create policy "payment history read" on public.payment_receipt_events for select to authenticated using (agency_id = current_agency_id() and staff_can('books'));
create policy "payment history note" on public.payment_receipt_events for insert to authenticated
  with check (agency_id = current_agency_id() and staff_can('books') and action = 'note'
    and exists (select 1 from public.payment_receipts r where r.id = receipt_id and r.agency_id = current_agency_id()));

-- scans: upload and read only, under the agency's own folder
insert into storage.buckets (id, name, public) values ('payment-records', 'payment-records', false) on conflict (id) do nothing;
create policy "payment scans upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-records' and staff_can('books') and name like current_agency_id()::text || '/%');
create policy "payment scans read" on storage.objects for select to authenticated
  using (bucket_id = 'payment-records' and staff_can('books') and name like current_agency_id()::text || '/%');
