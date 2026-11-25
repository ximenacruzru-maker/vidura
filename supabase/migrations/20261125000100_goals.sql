-- Goals.
--
-- daily_goals: each person's goals for a day: how many calls they'll make and how much premium they'll write. Set in
-- their own Space and changed day to day; the Daily Huddle shows, for each person, whether they reached them. Everyone
-- who sees the agency's numbers can read them (the huddle shows everyone's); a person sets their own, admins anyone's.
--
-- commission_goals: a producer's commission goal for a folio (the commission month) and how many life policies they
-- plan to write in it. Only the producer and the owner/admins see it (it's pay).
create table if not exists public.daily_goals (
  id bigserial primary key,
  agency_id uuid not null default public.current_agency_id() references public.agencies(id) on delete cascade,
  name text not null,
  day date not null,
  calls integer check (calls is null or calls >= 0),
  revenue numeric(12, 2) check (revenue is null or revenue >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (agency_id, name, day)
);
alter table public.daily_goals enable row level security;
drop policy if exists "read goals" on public.daily_goals;
create policy "read goals" on public.daily_goals for select to authenticated
  using (agency_id = public.current_agency_id() and (public.staff_sees_numbers() or lower(trim(name)) = any (coalesce(public.my_names(), '{}'))));
drop policy if exists "set own goals" on public.daily_goals;
create policy "set own goals" on public.daily_goals for all to authenticated
  using (agency_id = public.current_agency_id() and (public.staff_is_admin() or lower(trim(name)) = any (coalesce(public.my_names(), '{}'))))
  with check (agency_id = public.current_agency_id() and (public.staff_is_admin() or lower(trim(name)) = any (coalesce(public.my_names(), '{}'))));

create table if not exists public.commission_goals (
  id bigserial primary key,
  agency_id uuid not null default public.current_agency_id() references public.agencies(id) on delete cascade,
  name text not null,
  folio date not null,
  commission numeric(12, 2) check (commission is null or commission >= 0),
  life integer not null default 0 check (life >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (agency_id, name, folio)
);
alter table public.commission_goals enable row level security;
drop policy if exists "own or admin" on public.commission_goals;
create policy "own or admin" on public.commission_goals for all to authenticated
  using (agency_id = public.current_agency_id() and (public.staff_is_admin() or lower(trim(name)) = any (coalesce(public.my_names(), '{}'))))
  with check (agency_id = public.current_agency_id() and (public.staff_is_admin() or lower(trim(name)) = any (coalesce(public.my_names(), '{}'))));
