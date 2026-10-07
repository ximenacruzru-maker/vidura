-- Two-week new-hire onboarding.
-- 1. A new hire can upload their own certificate (e.g. harassment-prevention training) into
--    <agency>/onboarding/<their user id>/, filed as an admin-only document of category 'onboarding'.
-- 2. promote_new_hires(), nightly: a new hire whose start date was 14+ days ago and who has done every required step
--    moves to the SDR role (the full app). The steps must match REQUIRED_STEPS in src/lib/onboarding.ts.

create policy "new hire uploads own onboarding files" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.current_staff_role() is not null
    and name like (public.current_agency_id()::text || '/onboarding/' || auth.uid()::text || '/%'));
create policy "new hire files own onboarding document" on public.documents for insert to authenticated
  with check (agency_id = public.current_agency_id() and public.current_staff_role() is not null and category = 'onboarding' and admin_only
    and storage_path like (public.current_agency_id()::text || '/onboarding/' || auth.uid()::text || '/%'));

create or replace function public.promote_new_hires() returns integer
  language plpgsql security definer set search_path = public as $$
declare
  required text[] := array['handbook', 'bookmarks', 'gusto', 'harassment', 'calling', 'unlicensed', 'privacy'];
  today date := (now() at time zone 'America/Los_Angeles')::date;
  n integer;
begin
  with ready as (
    select s.agency_id, s.user_id
    from staff_accounts s
    left join new_hire_profiles p on p.agency_id = s.agency_id and p.user_id = s.user_id
    left join hr_staff h on h.agency_id = s.agency_id and lower(trim(h.name)) = lower(trim(s.display_name))
    where s.role = 'new_hire' and s.active
      and coalesce(p.start_date, h.hired_on, s.created_at::date) + 14 <= today
      and (select count(distinct o.step) from onboarding_progress o
           where o.agency_id = s.agency_id and o.user_id = s.user_id and o.step = any (required)) = array_length(required, 1)
  )
  update staff_accounts s set role = 'sdr' from ready r where s.agency_id = r.agency_id and s.user_id = r.user_id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.promote_new_hires() from public, anon, authenticated;

select cron.schedule('promote-new-hires', '5 9 * * *', $$ select public.promote_new_hires(); $$);
