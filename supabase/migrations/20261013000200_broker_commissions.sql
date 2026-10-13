-- Broker commissions: commission payments brokers / wholesalers / brokered carriers pay the agency, kept on the second
-- tab of Checks & Cash. Permanent the same way client payments are: no deletes (policy, grants and a trigger), what was
-- received can't be changed, the status only moves forward (received → deposited, or void with a reason), and every
-- step lands in broker_commission_events, which is append-only.
create table if not exists public.broker_commissions (
  id bigint generated always as identity primary key,
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  received_on date not null,
  broker text not null,
  method text not null check (method in ('check', 'ach', 'wire', 'card', 'other')),
  amount numeric(12,2) not null check (amount > 0),
  period text,
  reference text,
  clients text,
  note text,
  received_by text not null,
  received_by_user uuid default auth.uid(),
  status text not null default 'received' check (status in ('received', 'deposited', 'void')),
  deposited_on date,
  deposited_by text,
  deposited_ref text,
  closed_reason text,
  closed_by text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists broker_commissions_month on public.broker_commissions (agency_id, received_on);

create table if not exists public.broker_commission_events (
  id bigint generated always as identity primary key,
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  commission_id bigint not null references public.broker_commissions(id),
  at timestamptz not null default now(),
  by_name text,
  by_user uuid default auth.uid(),
  action text not null,
  detail text
);
create index if not exists broker_commission_events_commission on public.broker_commission_events (commission_id);

create or replace function public.broker_commission_guard() returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Commission records are permanent and can''t be deleted. Void it with a reason instead.'; end if;
  if (new.agency_id, new.received_on, new.broker, new.method, new.amount, new.period, new.reference, new.clients, new.note, new.received_by, new.received_by_user, new.created_at)
     is distinct from (old.agency_id, old.received_on, old.broker, old.method, old.amount, old.period, old.reference, old.clients, old.note, old.received_by, old.received_by_user, old.created_at) then
    raise exception 'What was received can''t be changed once logged. Void it with a reason and log it again.';
  end if;
  if old.deposited_on is not null and (new.deposited_on, new.deposited_by, new.deposited_ref) is distinct from (old.deposited_on, old.deposited_by, old.deposited_ref) then
    raise exception 'The deposit details are already recorded and can''t be changed.';
  end if;
  if old.closed_at is not null and (new.closed_reason, new.closed_by, new.closed_at) is distinct from (old.closed_reason, old.closed_by, old.closed_at) then
    raise exception 'The void details are already recorded and can''t be changed.';
  end if;
  if new.status is distinct from old.status and not (old.status = 'received' and new.status in ('deposited', 'void')) then
    raise exception 'A commission payment can''t go from % to %.', old.status, new.status;
  end if;
  if new.status = 'deposited' and new.deposited_on is null then raise exception 'Say when it was deposited.'; end if;
  if new.status = 'void' and coalesce(trim(new.closed_reason), '') = '' then raise exception 'Give a reason.'; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger broker_commission_guard before update or delete on public.broker_commissions for each row execute function public.broker_commission_guard();
create or replace function public.broker_commission_event_guard() returns trigger language plpgsql set search_path to 'public' as $$
begin raise exception 'The commission history is permanent and can''t be changed or deleted.'; end $$;
create trigger broker_commission_event_guard before update or delete on public.broker_commission_events for each row execute function public.broker_commission_event_guard();

create or replace function public.broker_commission_log() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare who text := coalesce((select display_name from public.staff_accounts where user_id = auth.uid()), 'system');
begin
  if tg_op = 'INSERT' then
    insert into public.broker_commission_events (agency_id, commission_id, by_name, by_user, action, detail)
    values (new.agency_id, new.id, who, auth.uid(), 'received', format('$%s from %s (%s) received on %s, accepted by %s', to_char(new.amount, 'FM999,999,990.00'), new.broker, new.method, to_char(new.received_on, 'MM/DD/YYYY'), new.received_by));
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.broker_commission_events (agency_id, commission_id, by_name, by_user, action, detail)
    values (new.agency_id, new.id, who, auth.uid(), new.status, case new.status
      when 'deposited' then concat_ws(' · ', 'deposited on ' || to_char(new.deposited_on, 'MM/DD/YYYY'), nullif(new.deposited_ref, ''))
      else new.closed_reason end);
  end if;
  return new;
end $$;
create trigger broker_commission_log after insert or update on public.broker_commissions for each row execute function public.broker_commission_log();

-- agency money: owners and admins (and anyone given Office Payroll access) see and work it; nobody can delete
alter table public.broker_commissions enable row level security;
alter table public.broker_commission_events enable row level security;
revoke delete, truncate on public.broker_commissions, public.broker_commission_events from anon, authenticated;
create policy "broker commissions read" on public.broker_commissions for select to authenticated using (agency_id = current_agency_id() and staff_can('payroll'));
create policy "broker commissions log" on public.broker_commissions for insert to authenticated
  with check (agency_id = current_agency_id() and staff_can('payroll') and status = 'received' and deposited_on is null and closed_at is null);
create policy "broker commissions work" on public.broker_commissions for update to authenticated using (agency_id = current_agency_id() and staff_can('payroll')) with check (agency_id = current_agency_id());
create policy "broker commission history read" on public.broker_commission_events for select to authenticated using (agency_id = current_agency_id() and staff_can('payroll'));
create policy "broker commission history note" on public.broker_commission_events for insert to authenticated
  with check (agency_id = current_agency_id() and staff_can('payroll') and action = 'note'
    and exists (select 1 from public.broker_commissions c where c.id = commission_id and c.agency_id = current_agency_id()));
