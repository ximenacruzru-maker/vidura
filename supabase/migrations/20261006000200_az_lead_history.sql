-- Every AgencyZoom lead created this year, with its producer, quote day, sold day and status, kept by the
-- agencyzoom-leads function (hourly at :45 on weekdays). My Space's closing rate is measured from it since Jan 1:
-- leads quoted this year that were won ÷ leads quoted this year. Read like quote_leads: admins see everything, a
-- producer sees their own leads.
create table if not exists public.az_lead_history (
  agency_id uuid not null default public.current_agency_id() references public.agencies(id) on delete cascade,
  lead_id text not null,
  producer text not null default '',
  created_date date,
  quote_date date,
  sold_date date,
  status int not null default 0, -- 2 won, 3 lost, 5 expired, otherwise open
  lead_source text,
  seen_at timestamptz not null default now(),
  primary key (agency_id, lead_id)
);
create index if not exists az_lead_history_quote on public.az_lead_history (agency_id, quote_date);
alter table public.az_lead_history enable row level security;
drop policy if exists az_lead_history_read on public.az_lead_history;
create policy az_lead_history_read on public.az_lead_history for select to authenticated
  using (agency_id = current_agency_id() and (staff_is_admin() or lower(producer) = any (my_names())));
grant select on public.az_lead_history to authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'agencyzoom-leads';
select cron.schedule('agencyzoom-leads', '45 * * * *', $$
  select net.http_post(
    url := 'https://sikgwlhwsezrhiylfmnx.supabase.co/functions/v1/agencyzoom-leads',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'agencyzoom_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 150000)
  where extract(isodow from now() at time zone 'America/Los_Angeles') between 1 and 5
    and extract(hour from now() at time zone 'America/Los_Angeles') between 8 and 17;
$$);
