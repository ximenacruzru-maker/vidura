-- Calls per person per day, for goal streaks (the Hunter Goal Scoreboard's PTO incentive): each day counted the way
-- the Daily Huddle counts it (a day the call webhook sent calls for uses those, otherwise the API sync's). Runs with the
-- caller's own access, so it returns only what they could read from ricochet_calls themselves.
create or replace function public.calls_by_day(p_from date, p_to date)
returns table (day date, agent text, calls bigint)
language sql stable security invoker set search_path = public as $$
  with d as (
    select c.day, coalesce(bool_or(c.source = 'webhook'), false) as hook
    from public.ricochet_calls c
    where c.agency_id = public.current_agency_id() and c.day between p_from and p_to
    group by c.day)
  select c.day, c.agent, count(*)
  from public.ricochet_calls c join d on d.day = c.day
  where c.agency_id = public.current_agency_id() and c.day between p_from and p_to
    and coalesce(c.source = 'webhook', false) = d.hook
  group by c.day, c.agent
$$;
revoke execute on function public.calls_by_day(date, date) from public, anon;
grant execute on function public.calls_by_day(date, date) to authenticated;
