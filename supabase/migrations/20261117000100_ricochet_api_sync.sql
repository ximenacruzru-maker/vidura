-- Ricochet over its API: every minute in office hours the ricochet-sync edge function reads Ricochet with the agency's
-- API token (the edge function secret richochet_api_token) and keeps
--   * each call made or taken today (from the leads called today, newest first: who, when, inbound or outbound, the
--     queue) in ricochet_calls, so Team Space and the Daily Huddle Report count calls by person, and
--   * each Ricochet user's live status (Busy = on a call, Available, Offline…) in ricochet_agents, for Team Space.
-- No phone numbers or client names are kept. The webhook route (ricochet-webhook) still works alongside it.

-- which agencies sync over the API: their Ricochet address (https://<name>.ricochet.me); none until it's set
alter table public.ricochet_hooks add column if not exists api_base text;

alter table public.ricochet_calls add column if not exists ricochet_user_id integer;
alter table public.ricochet_calls add column if not exists call_type text;
alter table public.ricochet_calls add column if not exists source text not null default 'webhook';

create table if not exists public.ricochet_agents (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  user_id integer not null,
  name text not null,
  status text,
  status_since timestamptz,
  role text,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (agency_id, user_id)
);
alter table public.ricochet_agents enable row level security;

-- read by the owner and admins (everyone's numbers) and whoever runs the work queue (Team Space)
drop policy if exists "ricochet calls read" on public.ricochet_calls;
create policy "ricochet calls read" on public.ricochet_calls for select to authenticated
  using (agency_id = current_agency_id() and (staff_can('performance') or staff_can('work_manager')));
drop policy if exists "ricochet agents read" on public.ricochet_agents;
create policy "ricochet agents read" on public.ricochet_agents for select to authenticated
  using (agency_id = current_agency_id() and (staff_can('performance') or staff_can('work_manager')));

-- every minute, Monday to Saturday, 7am to 7:59pm Pacific, for each agency with a Ricochet address; the agency's hook
-- token is the credential (the function looks the agency up by it)
select cron.unschedule('ricochet-sync') where exists (select 1 from cron.job where jobname = 'ricochet-sync');
select cron.schedule('ricochet-sync', '* * * * *', $cron$
  select net.http_post(
    url := 'https://sikgwlhwsezrhiylfmnx.supabase.co/functions/v1/ricochet-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', h.token),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
  from public.ricochet_hooks h
  where h.api_base is not null
    and extract(isodow from now() at time zone 'America/Los_Angeles') between 1 and 6
    and extract(hour from now() at time zone 'America/Los_Angeles') between 7 and 19;
$cron$);
