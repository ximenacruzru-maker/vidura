-- Onboarding is three steps (handbook, bookmarks, Gusto): harassment training, calling rules, license limits and privacy
-- are covered in Farmers University. promote_new_hires() checks those three.
create or replace function public.promote_new_hires() returns integer
  language plpgsql security definer set search_path = public as $$
declare
  required text[] := array['handbook', 'bookmarks', 'gusto'];
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
