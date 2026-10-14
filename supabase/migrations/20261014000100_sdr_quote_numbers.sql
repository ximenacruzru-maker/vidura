-- Apex quote numbers: each SDR enters the Apex quote # for every transfer on My Commissions, and admins download them
-- with the payroll sheet to reconcile the SDR bonus. One number per transfer (AgencyZoom lead). The SDR sends only the
-- lead and the number; who the transfer belongs to, its month and client are copied from sdr_transfers, so nobody can
-- file a number against someone else's transfer. Once the SDR month is closed only an admin can change it, and the
-- numbers can't be deleted.
create table if not exists public.sdr_quote_numbers (
  id bigint generated always as identity primary key,
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  lead_id text not null,
  quote_number text not null check (length(quote_number) between 1 and 40),
  sdr text,
  month text,
  client text,
  entered_by text,
  entered_by_user uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, lead_id)
);

create or replace function public.sdr_quote_number_fill() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare t record;
begin
  if tg_op = 'UPDATE' and (new.agency_id, new.lead_id) is distinct from (old.agency_id, old.lead_id) then raise exception 'The transfer can''t be changed.'; end if;
  select sdr, month, client into t from public.sdr_transfers where agency_id = new.agency_id and lead_id = new.lead_id order by month desc limit 1;
  if not found then raise exception 'That transfer isn''t on file.'; end if;
  if not public.staff_is_admin() and exists (select 1 from public.sdr_pay_periods p where p.agency_id = new.agency_id and p.month = t.month and p.closed) then
    raise exception 'That month is closed. Ask an admin to change the quote number.';
  end if;
  new.quote_number := trim(new.quote_number);
  new.sdr := t.sdr; new.month := t.month; new.client := t.client;
  new.entered_by := coalesce((select display_name from public.staff_accounts where user_id = auth.uid()), 'system');
  new.entered_by_user := auth.uid();
  if tg_op = 'UPDATE' then new.created_at := old.created_at; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger sdr_quote_number_fill before insert or update on public.sdr_quote_numbers for each row execute function public.sdr_quote_number_fill();

alter table public.sdr_quote_numbers enable row level security;
revoke delete, truncate on public.sdr_quote_numbers from anon, authenticated;
create policy "quote numbers read" on public.sdr_quote_numbers for select to authenticated
  using (agency_id = current_agency_id() and (staff_is_admin() or staff_can('payroll') or lower(sdr) = any(my_names())));
create policy "quote numbers add" on public.sdr_quote_numbers for insert to authenticated
  with check (agency_id = current_agency_id() and (staff_is_admin() or lower(sdr) = any(my_names())));
create policy "quote numbers change" on public.sdr_quote_numbers for update to authenticated
  using (agency_id = current_agency_id() and (staff_is_admin() or lower(sdr) = any(my_names())))
  with check (agency_id = current_agency_id() and (staff_is_admin() or lower(sdr) = any(my_names())));
