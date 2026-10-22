-- Renewals the reviewer didn't get to carry over: every workday at 5 PM Pacific, a renewal on that day's list (or an
-- earlier one) with no notes yet — no findings and no result of the call; only renewals with notes count as worked —
-- moves to the next workday's list. carried_from keeps the day it was first put on a list.
alter table public.renewal_reviews add column if not exists carried_from date;

create or replace function public.carry_over_renewal_reviews()
returns integer
language sql
security definer
set search_path = public
as $$
  with today as (select (now() at time zone 'America/Los_Angeles')::date d),
  nxt as (
    select min(x)::date d from today, generate_series(today.d + 1, today.d + 7, interval '1 day') x
    where extract(isodow from x) between 1 and 5
  ),
  moved as (
    update public.renewal_reviews r
       set carried_from = coalesce(r.carried_from, r.day), day = nxt.d, updated_at = now()
      from today, nxt
     where r.day <= today.d
       and coalesce(trim(r.findings), '') = '' and coalesce(trim(r.notes), '') = ''
    returning 1
  )
  select count(*)::int from moved
$$;
revoke all on function public.carry_over_renewal_reviews() from public, anon, authenticated;

-- hourly, acting only in the 5 PM Pacific hour on a workday (so it follows daylight saving)
select cron.unschedule(jobid) from cron.job where jobname = 'renewal-carry-over';
select cron.schedule('renewal-carry-over', '0 * * * *', $$
  select public.carry_over_renewal_reviews()
  where extract(isodow from now() at time zone 'America/Los_Angeles') between 1 and 5
    and extract(hour from now() at time zone 'America/Los_Angeles') = 17;
$$);
