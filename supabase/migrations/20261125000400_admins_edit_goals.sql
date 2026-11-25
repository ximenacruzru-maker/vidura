-- Goals: the owner and admins can set and change anyone's goals, any time. Everyone (admins included) is held to two
-- changes a day on their own goals, except the owner. Commission goals stay readable only by the person, the owner and
-- admins (the leaderboard everyone sees shows percentages, from the commissions function).
create or replace function public.goal_edit_limit() returns trigger
language plpgsql set search_path = public as $$
declare d date := (now() at time zone 'America/Los_Angeles')::date; same boolean; mine boolean;
begin
  if tg_op = 'INSERT' then
    new.edits := 0; new.edit_day := d;
    return new;
  end if;
  if tg_table_name = 'daily_goals' then
    same := (to_jsonb(new) ->> 'calls') is not distinct from (to_jsonb(old) ->> 'calls') and (to_jsonb(new) ->> 'revenue') is not distinct from (to_jsonb(old) ->> 'revenue');
  else
    same := (to_jsonb(new) ->> 'commission') is not distinct from (to_jsonb(old) ->> 'commission') and (to_jsonb(new) ->> 'life') is not distinct from (to_jsonb(old) ->> 'life');
  end if;
  mine := lower(trim(new.name)) = any (coalesce(public.my_names(), '{}'));
  -- no change, the owner, or an admin changing someone else's goals: not counted
  if same or public.current_staff_role() = 'owner' or (public.staff_is_admin() and not mine) then
    new.edits := old.edits; new.edit_day := old.edit_day;
    return new;
  end if;
  new.edits := case when old.edit_day = d then old.edits else 0 end + 1;
  new.edit_day := d;
  if new.edits > 2 then
    raise exception 'You can change your goals twice a day. Ask Shannon or an admin if they need to change again today.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop policy if exists "set own goals" on public.daily_goals;
create policy "set own goals" on public.daily_goals for all to authenticated
  using (agency_id = public.current_agency_id() and (public.staff_is_admin() or lower(trim(name)) = any (coalesce(public.my_names(), '{}'))))
  with check (agency_id = public.current_agency_id() and (public.staff_is_admin() or lower(trim(name)) = any (coalesce(public.my_names(), '{}'))));
drop policy if exists "set commission goals" on public.commission_goals;
create policy "set commission goals" on public.commission_goals for all to authenticated
  using (agency_id = public.current_agency_id() and (public.staff_is_admin() or lower(trim(name)) = any (coalesce(public.my_names(), '{}'))))
  with check (agency_id = public.current_agency_id() and (public.staff_is_admin() or lower(trim(name)) = any (coalesce(public.my_names(), '{}'))));
