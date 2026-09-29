-- AgencyZoom's sales dashboard can't be asked about past dates (it answers with today's figures whatever the period),
-- so the last-year comparison is built from the policies themselves: every policy on every AgencyZoom customer, with
-- the day it was sold, its premium and producer. Filled by agencyzoom-sync ({"policies": true}, a page of 100
-- customers per call, until done) and kept current by every hourly run for the customers it reads. The
-- dashboard's "vs last year" section counts both years from here, so they are counted the same way.
-- Read like daily_sales: admins see everything, a producer sees their own policies.
drop table if exists public.az_sales_daily;
alter table public.az_sync_state drop column if exists history_through;
alter table public.az_sync_state drop column if exists history_done;

create table if not exists public.az_policies (
  agency_id uuid not null default public.current_agency_id() references public.agencies(id) on delete cascade,
  policy_id text not null,
  customer_id text not null,
  sold_date date,
  effective_date date,
  expiry_date date,
  premium numeric not null default 0,
  producer text not null default '',
  carrier text,
  policy_type text,
  status int,
  seen_at timestamptz not null default now(),
  primary key (agency_id, policy_id)
);
create index if not exists az_policies_sold on public.az_policies (agency_id, sold_date);
alter table public.az_policies enable row level security;
drop policy if exists az_policies_read on public.az_policies;
create policy az_policies_read on public.az_policies for select to authenticated
  using (agency_id = current_agency_id() and (staff_is_admin() or lower(producer) = any (my_names())));
grant select on public.az_policies to authenticated;

alter table public.az_sync_state add column if not exists policies_page int not null default 0;
alter table public.az_sync_state add column if not exists policies_done boolean not null default false;

-- The one-time fill: every 3 minutes (minutes 4, 7, … so it never overlaps the hourly run at :00) until done; the
-- job then removes itself.
select cron.unschedule(jobid) from cron.job where jobname = 'agencyzoom-policies';
select cron.schedule('agencyzoom-policies', '4-58/3 * * * *', $$
  select net.http_post(
    url := 'https://sikgwlhwsezrhiylfmnx.supabase.co/functions/v1/agencyzoom-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'agencyzoom_cron_secret')),
    body := '{"policies": true}'::jsonb, timeout_milliseconds := 150000)
  where not coalesce((select bool_and(policies_done) from public.az_sync_state), false);
  select cron.unschedule('agencyzoom-policies') where coalesce((select bool_and(policies_done) from public.az_sync_state), false);
$$);
