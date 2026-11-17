-- Incoming calls as they ring, for the big alert on Team Space: Ricochet's call webhook (ricochet-webhook) sends an
-- event when an inbound call starts ringing, is answered and ends; each call's latest state is kept here with who or
-- what is calling (the caller ID name or the line, e.g. "Service Advantage"). The board shows a call while it rings.
create table if not exists public.ricochet_live_calls (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  call_key text not null,
  caller text,
  queue text,
  state text not null,
  agent text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (agency_id, call_key)
);
create index if not exists ricochet_live_calls_state on public.ricochet_live_calls (agency_id, state, updated_at);
alter table public.ricochet_live_calls enable row level security;
drop policy if exists "ricochet live calls read" on public.ricochet_live_calls;
create policy "ricochet live calls read" on public.ricochet_live_calls for select to authenticated
  using (agency_id = current_agency_id() and (staff_can('performance') or staff_can('work_manager')));
