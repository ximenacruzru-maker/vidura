-- Goals: a person sets their own goals and can change them twice a day after that; the owner (Shannon) can set and
-- change anyone's, as often as he likes. Admins no longer set other people's goals. Saving goals that didn't change
-- doesn't count as a change.
alter table public.daily_goals add column if not exists edits integer not null default 0;
alter table public.daily_goals add column if not exists edit_day date;
alter table public.commission_goals add column if not exists edits integer not null default 0;
alter table public.commission_goals add column if not exists edit_day date;

create or replace function public.goal_edit_limit() returns trigger
language plpgsql set search_path = public as $$
declare d date := (now() at time zone 'America/Los_Angeles')::date;
begin
  if tg_op = 'INSERT' then
    new.edits := 0; new.edit_day := d;
    return new;
  end if;
  -- nothing changed: not a change
  if (tg_table_name = 'daily_goals' and new.calls is not distinct from old.calls and new.revenue is not distinct from old.revenue)
     or (tg_table_name = 'commission_goals' and new.commission is not distinct from old.commission and new.life is not distinct from old.life) then
    new.edits := old.edits; new.edit_day := old.edit_day;
    return new;
  end if;
  if public.current_staff_role() = 'owner' then
    new.edits := old.edits; new.edit_day := old.edit_day;
    return new;
  end if;
  new.edits := case when old.edit_day = d then old.edits else 0 end + 1;
  new.edit_day := d;
  if new.edits > 2 then
    raise exception 'You can change your goals twice a day. Ask Shannon if they need to change again today.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists goal_edit_limit on public.daily_goals;
create trigger goal_edit_limit before insert or update on public.daily_goals for each row execute function public.goal_edit_limit();
drop trigger if exists goal_edit_limit on public.commission_goals;
create trigger goal_edit_limit before insert or update on public.commission_goals for each row execute function public.goal_edit_limit();

-- writes: your own goals, or anyone's for the owner
drop policy if exists "set own goals" on public.daily_goals;
create policy "set own goals" on public.daily_goals for all to authenticated
  using (agency_id = public.current_agency_id() and (public.current_staff_role() = 'owner' or lower(trim(name)) = any (coalesce(public.my_names(), '{}'))))
  with check (agency_id = public.current_agency_id() and (public.current_staff_role() = 'owner' or lower(trim(name)) = any (coalesce(public.my_names(), '{}'))));
-- daily goals stay readable by everyone who sees the agency's numbers ("read goals"); commission goals are pay:
-- your own, or the owner and admins can read anyone's, and only the owner can change someone else's
drop policy if exists "own or admin" on public.commission_goals;
drop policy if exists "read commission goals" on public.commission_goals;
create policy "read commission goals" on public.commission_goals for select to authenticated
  using (agency_id = public.current_agency_id() and (public.staff_is_admin() or lower(trim(name)) = any (coalesce(public.my_names(), '{}'))));
drop policy if exists "set commission goals" on public.commission_goals;
create policy "set commission goals" on public.commission_goals for all to authenticated
  using (agency_id = public.current_agency_id() and (public.current_staff_role() = 'owner' or lower(trim(name)) = any (coalesce(public.my_names(), '{}'))))
  with check (agency_id = public.current_agency_id() and (public.current_staff_role() = 'owner' or lower(trim(name)) = any (coalesce(public.my_names(), '{}'))));
