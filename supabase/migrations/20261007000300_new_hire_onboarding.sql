-- New-hire onboarding on the Training page.
--   employee_handbook     the agency's handbook (one per agency): the filed document and its text, for questions in the app
--   onboarding_progress   each person's checked-off onboarding steps ('handbook' = downloaded, unlocks Farmers
--                         University; '<step>:file' = that step's attachment downloaded), with the exact time
--   new_hire_profiles     what admins track per new hire: start date, manager / trainer
-- A new hire sees only their training: on top of the role's training-only access (staff_can), restrictive policies keep
-- them out of client accounts, policies and files (except the handbook) and team chat.

create table if not exists public.employee_handbook (
  agency_id uuid primary key default public.current_agency_id() references public.agencies(id) on delete cascade,
  document_id text not null,
  title text not null,
  text text,
  updated_at timestamptz not null default now()
);
alter table public.employee_handbook enable row level security;
create policy "staff read" on public.employee_handbook for select to authenticated using (agency_id = public.current_agency_id() and public.current_staff_role() is not null);
create policy "admin write" on public.employee_handbook for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_is_admin()) with check (agency_id = public.current_agency_id() and public.staff_is_admin());
grant select, insert, update, delete on public.employee_handbook to authenticated;

create table if not exists public.onboarding_progress (
  agency_id uuid not null default public.current_agency_id() references public.agencies(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  step text not null,
  done_at timestamptz not null default now(),
  primary key (agency_id, user_id, step)
);
alter table public.onboarding_progress enable row level security;
create policy "own or admin" on public.onboarding_progress for select to authenticated using (agency_id = public.current_agency_id() and (user_id = auth.uid() or public.staff_is_admin()));
create policy "own write" on public.onboarding_progress for all to authenticated
  using (agency_id = public.current_agency_id() and user_id = auth.uid()) with check (agency_id = public.current_agency_id() and user_id = auth.uid() and public.current_staff_role() is not null);
grant select, insert, update, delete on public.onboarding_progress to authenticated;

create table if not exists public.new_hire_profiles (
  agency_id uuid not null default public.current_agency_id() references public.agencies(id) on delete cascade,
  user_id uuid not null,
  start_date date,
  manager text,
  updated_at timestamptz not null default now(),
  primary key (agency_id, user_id)
);
alter table public.new_hire_profiles enable row level security;
create policy "admin all" on public.new_hire_profiles for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_is_admin()) with check (agency_id = public.current_agency_id() and public.staff_is_admin());
create policy "own read" on public.new_hire_profiles for select to authenticated using (agency_id = public.current_agency_id() and user_id = auth.uid());
grant select, insert, update, delete on public.new_hire_profiles to authenticated;

-- new hires: training only
create policy "not new hires" on public.book_accounts as restrictive for select to authenticated using (agency_id = public.current_agency_id() and public.current_staff_role() is distinct from 'new_hire');
create policy "not new hires" on public.book_policies as restrictive for select to authenticated using (agency_id = public.current_agency_id() and public.current_staff_role() is distinct from 'new_hire');
create policy "not new hires" on public.chat_messages as restrictive for select to authenticated using (agency_id = public.current_agency_id() and public.current_staff_role() is distinct from 'new_hire');
create policy "new hires: handbook only" on public.documents as restrictive for select to authenticated using (agency_id = public.current_agency_id() and (public.current_staff_role() is distinct from 'new_hire' or category = 'handbook'));
