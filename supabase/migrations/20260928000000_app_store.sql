-- Things the screens used to keep only in the browser (an imported AgencyZoom report, commission plan drafts,
-- reconciliations, reimbursements, remembered filters, the original screens' settings). Each login's items are kept
-- here instead, so they sit in the database (encrypted at rest, backed up) and the browser holds only a working copy
-- while someone is signed in; it is cleared at sign-out. One row per login per browser key; value is the stored text.
create table if not exists public.app_store (
  agency_id uuid not null default public.current_agency_id() references public.agencies(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null check (key like 'declara\_%'),
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (agency_id, user_id, key)
);
alter table public.app_store enable row level security;

drop policy if exists app_store_own on public.app_store;
create policy app_store_own on public.app_store for all to authenticated
  using (agency_id = current_agency_id() and user_id = auth.uid())
  with check (agency_id = current_agency_id() and user_id = auth.uid());

grant select, insert, update, delete on public.app_store to authenticated;

-- The nightly demo reset also clears what prospects saved in the demo's screens.
select cron.unschedule(jobid) from cron.job where jobname = 'demo-reset-nightly';
select cron.schedule('demo-reset-nightly', '40 10 * * *',
  $$select public.demo_reset('northwind'); delete from public.app_store where agency_id = (select id from public.agencies where slug = 'northwind')$$);
