-- Work & Tickets activity reports: a completed item stays on the list and keeps when it was completed and by whom.
-- The database stamps both whenever an item's status turns Completed (and clears them if it is reopened), so the
-- record doesn't depend on which screen made the change. Completed items can no longer be deleted, so the history
-- the reports are built from stays whole.
alter table public.work_items add column if not exists completed_at timestamptz;
alter table public.work_items add column if not exists completed_by text;

create or replace function public.work_items_stamp_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  done_now boolean := new.status ~* '(complete|done|resolved|closed)';
  done_before boolean := tg_op = 'UPDATE' and old.status ~* '(complete|done|resolved|closed)';
begin
  if done_now and not done_before then
    new.completed_at := coalesce(new.completed_at, now());
    new.completed_by := coalesce(new.completed_by,
      (select coalesce(nullif(trim(s.display_name), ''), s.producer_name) from public.staff_accounts s where s.user_id = auth.uid()));
  elsif not done_now then
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists work_items_stamp_completed on public.work_items;
create trigger work_items_stamp_completed before insert or update of status on public.work_items
  for each row execute function public.work_items_stamp_completed();

-- items already completed: their last change is the best record of when
update public.work_items set completed_at = updated_at
 where completed_at is null and status ~* '(complete|done|resolved|closed)';

drop policy if exists "admin delete" on public.work_items;
create policy "admin delete" on public.work_items for delete to authenticated
  using (agency_id = public.current_agency_id() and public.current_staff_role() in ('owner', 'admin')
    and not (status ~* '(complete|done|resolved|closed)'));
