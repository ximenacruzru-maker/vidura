-- The AgencyZoom sync finds sales by reading customers' policies. It already checks customers created in the window
-- and customers behind won leads; a policy added straight to an existing customer (no new customer, no won lead) was
-- missed. AgencyZoom's customer list carries each customer's policy summary (one entry per policy), so the sync keeps
-- the last summary it saw per customer and re-reads the policies of any customer whose summary changed.
create table if not exists public.az_customers (
  agency_id uuid not null default public.current_agency_id() references public.agencies(id) on delete cascade,
  customer_id text not null,
  policy_summary text not null default '',
  seen_at timestamptz not null default now(),
  primary key (agency_id, customer_id)
);
alter table public.az_customers enable row level security;
drop policy if exists az_customers_admin_read on public.az_customers;
create policy az_customers_admin_read on public.az_customers for select to authenticated
  using (agency_id = current_agency_id() and current_staff_role() in ('owner', 'admin'));

-- Progress of a one-time sweep that re-reads every customer's policies (to pick up sales missed before the above),
-- a page of customers per run.
create table if not exists public.az_sync_state (
  agency_id uuid primary key default public.current_agency_id() references public.agencies(id) on delete cascade,
  sweep_page int not null default 0,
  sweep_done boolean not null default false,
  sweep_added int not null default 0,
  sweep_started_at timestamptz,
  sweep_finished_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.az_sync_state enable row level security;
drop policy if exists az_sync_state_admin_read on public.az_sync_state;
create policy az_sync_state_admin_read on public.az_sync_state for select to authenticated
  using (agency_id = current_agency_id() and current_staff_role() in ('owner', 'admin'));

-- The sweep: every 3 minutes from 6 PM Pacific (01:00–02:57 UTC) until it reports done, then the job removes itself.
select cron.unschedule(jobid) from cron.job where jobname = 'agencyzoom-sweep';
select cron.schedule('agencyzoom-sweep', '*/3 1-2 * * *', $$
  select net.http_post(
    url := 'https://sikgwlhwsezrhiylfmnx.supabase.co/functions/v1/agencyzoom-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'agencyzoom_cron_secret')),
    body := '{"sweep": true}'::jsonb, timeout_milliseconds := 150000)
  where not coalesce((select bool_and(sweep_done) from public.az_sync_state), false);
  select cron.unschedule('agencyzoom-sweep') where coalesce((select bool_and(sweep_done) from public.az_sync_state), false);
$$);
