-- The certificate of insurance (ACORD 25) generator in Agency Resources: the agency's own details (the producer
-- block — name, address, contact) are typed in once and saved here so every certificate carries them, along with
-- the insurance companies used before (so they can be picked again). One row per agency; anyone on staff can
-- read and update it, as anyone who issues certificates needs to.
create table if not exists public.coi_profile (
  agency_id uuid primary key default public.current_agency_id() references public.agencies(id) on delete cascade,
  producer jsonb not null default '{}'::jsonb,
  insurers jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null
);
alter table public.coi_profile enable row level security;

drop policy if exists coi_profile_staff on public.coi_profile;
create policy coi_profile_staff on public.coi_profile for all to authenticated
  using (agency_id = current_agency_id() and current_staff_role() is not null)
  with check (agency_id = current_agency_id() and current_staff_role() is not null);

grant select, insert, update on public.coi_profile to authenticated;

-- The nightly demo reset also clears the demo agency's certificate details.
select cron.unschedule(jobid) from cron.job where jobname = 'demo-reset-nightly';
select cron.schedule('demo-reset-nightly', '40 10 * * *',
  $$select public.demo_reset('northwind');
    delete from public.app_store where agency_id = (select id from public.agencies where slug = 'northwind');
    delete from public.coi_profile where agency_id = (select id from public.agencies where slug = 'northwind')$$);
