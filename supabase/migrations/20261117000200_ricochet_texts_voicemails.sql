-- Ricochet texts and voicemails for the Daily Huddle Report, kept by ricochet-sync alongside the calls: each text sent
-- or received (from the leads' activity: who, when, which way) and each voicemail left (Ricochet's voicemail list:
-- when, for whom, whether it's been heard). No phone numbers, names or message text are kept.
create table if not exists public.ricochet_texts (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  text_id text not null,
  day date not null,
  sent_at timestamptz,
  agent text,
  ricochet_user_id integer,
  direction text,
  lead_id text,
  primary key (agency_id, text_id)
);
create index if not exists ricochet_texts_day on public.ricochet_texts (agency_id, day);
alter table public.ricochet_texts enable row level security;
drop policy if exists "ricochet texts read" on public.ricochet_texts;
create policy "ricochet texts read" on public.ricochet_texts for select to authenticated
  using (agency_id = current_agency_id() and (staff_can('performance') or staff_can('work_manager')));

create table if not exists public.ricochet_voicemails (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  vm_id text not null,
  day date not null,
  left_at timestamptz,
  for_user text,
  heard boolean,
  duration_sec integer,
  primary key (agency_id, vm_id)
);
create index if not exists ricochet_voicemails_day on public.ricochet_voicemails (agency_id, day);
alter table public.ricochet_voicemails enable row level security;
drop policy if exists "ricochet voicemails read" on public.ricochet_voicemails;
create policy "ricochet voicemails read" on public.ricochet_voicemails for select to authenticated
  using (agency_id = current_agency_id() and (staff_can('performance') or staff_can('work_manager')));
