-- AgencyZoom's own sales-dashboard totals, one row per day for the agency ("(agency)") and one per producer with a
-- sale that day, from 2025-01-01 on. The dashboard's "vs last year" section compares the same dates a year apart
-- from this one source, so both years are counted the same way. Filled by agencyzoom-sync ({"history": true} for
-- the backfill; every hourly run refreshes the last 7 days). Read like daily_sales: admins see everything, a
-- producer sees their own line.
create table if not exists public.az_sales_daily (
  agency_id uuid not null default public.current_agency_id() references public.agencies(id) on delete cascade,
  day date not null,
  agent text not null,
  premium numeric not null default 0,
  policies int not null default 0,
  items int not null default 0,
  pulled_at timestamptz not null default now(),
  primary key (agency_id, day, agent)
);
alter table public.az_sales_daily enable row level security;
drop policy if exists az_sales_daily_read on public.az_sales_daily;
create policy az_sales_daily_read on public.az_sales_daily for select to authenticated
  using (agency_id = current_agency_id() and (staff_is_admin() or lower(agent) = any (my_names())));
grant select on public.az_sales_daily to authenticated;

alter table public.az_sync_state add column if not exists history_through date;
alter table public.az_sync_state add column if not exists history_done boolean not null default false;
