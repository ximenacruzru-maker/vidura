-- Team today (the owner's My Space): what each person is focused on (sales, retention & renewals, training…) and who
-- is out on a given day, so the owner sees the team at a glance alongside the day's activity from Declara. Owners and
-- admins set both.
create table if not exists public.team_focus (
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  name text not null,
  focus text not null,
  updated_at timestamptz not null default now(),
  primary key (agency_id, name)
);
create table if not exists public.team_day_status (
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  name text not null,
  day date not null,
  out boolean not null default false,
  note text,
  updated_at timestamptz not null default now(),
  primary key (agency_id, name, day)
);
alter table public.team_focus enable row level security;
alter table public.team_day_status enable row level security;
drop policy if exists "admin all" on public.team_focus;
create policy "admin all" on public.team_focus for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_is_admin())
  with check (agency_id = public.current_agency_id() and public.staff_is_admin());
drop policy if exists "admin all" on public.team_day_status;
create policy "admin all" on public.team_day_status for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_is_admin())
  with check (agency_id = public.current_agency_id() and public.staff_is_admin());
