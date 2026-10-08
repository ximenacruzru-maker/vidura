-- Ricochet calls: every call Ricochet reports through its webhook (Configuration > Event Actions > Call Events Action,
-- sending the "Declara calls" webhook), so the Daily Huddle Report shows real dials, contacts and talk time by agent.
-- The ricochet-webhook edge function writes rows with the service role; each agency's webhook URL carries its own
-- secret key (ricochet_hooks.token), which is how the function knows which agency a call belongs to.
create table if not exists public.ricochet_calls (
  id bigint generated always as identity primary key,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  call_id text,
  day date not null,
  started_at timestamptz,
  agent text,
  direction text,
  phone text,
  duration_sec integer,
  talk_sec integer,
  disposition text,
  lead_id text,
  lead_name text,
  recording_url text,
  raw jsonb,
  received_at timestamptz not null default now(),
  unique (agency_id, call_id)
);
create index if not exists ricochet_calls_day on public.ricochet_calls (agency_id, day);
alter table public.ricochet_calls enable row level security;
create policy "ricochet calls read" on public.ricochet_calls for select to authenticated
  using (agency_id = current_agency_id() and staff_can('performance'));

create table if not exists public.ricochet_hooks (
  agency_id uuid primary key references public.agencies(id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now()
);
alter table public.ricochet_hooks enable row level security;
create policy "ricochet hooks admin read" on public.ricochet_hooks for select to authenticated
  using (agency_id = current_agency_id() and staff_is_admin());
