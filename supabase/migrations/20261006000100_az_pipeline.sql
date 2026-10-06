-- The quoted pipeline as AgencyZoom has it right now: every open lead (not sold, lost or expired) in a pipeline's
-- "Quoted" stage or a later one (Closing Current Folio, FSD This Folio, ...), with its producer, quoted premium and
-- confidence ("low" when tagged No Confidence / Low Confidence, otherwise "high"). quote_leads keeps every lead ever
-- quoted, so it can't say what is still open; this table is replaced on each pass of agencyzoom-sync
-- ({"pipeline": true}), every hour at :30 on weekdays 8 AM – 5 PM Pacific. My Space shows each person their own
-- pipeline and the owner the agency's.
-- Read like quote_leads: admins see everything, a producer sees their own leads.
create table if not exists public.az_pipeline (
  agency_id uuid not null default public.current_agency_id() references public.agencies(id) on delete cascade,
  lead_id text not null,
  name text not null default '',
  producer text not null default '',
  quoted_premium numeric not null default 0,
  quote_day date,
  stage text,
  lead_source text,
  url text,
  pipeline_name text,
  tags text,
  confidence text not null default 'high',
  created_date date,
  entered_stage date,
  premium_checked boolean not null default false, -- quoted_premium was read from the lead's quotes
  seen_at timestamptz not null default now(),
  primary key (agency_id, lead_id)
);
create index if not exists az_pipeline_producer on public.az_pipeline (agency_id, lower(producer));
alter table public.az_pipeline enable row level security;
drop policy if exists az_pipeline_read on public.az_pipeline;
create policy az_pipeline_read on public.az_pipeline for select to authenticated
  using (agency_id = current_agency_id() and (staff_is_admin() or lower(producer) = any (my_names())));
grant select on public.az_pipeline to authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'agencyzoom-pipeline';
select cron.schedule('agencyzoom-pipeline', '30 * * * *', $$
  select net.http_post(
    url := 'https://sikgwlhwsezrhiylfmnx.supabase.co/functions/v1/agencyzoom-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'agencyzoom_cron_secret')),
    body := '{"pipeline": true}'::jsonb, timeout_milliseconds := 150000)
  where extract(isodow from now() at time zone 'America/Los_Angeles') between 1 and 5
    and extract(hour from now() at time zone 'America/Los_Angeles') between 8 and 17;
$$);
