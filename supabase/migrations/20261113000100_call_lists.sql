-- Call lists: a list of clients handed to one person to call (e.g. Rhon's retention call list). Each row is a client
-- to call; the person marks the result of the call and notes, and the owner and admins see the progress and every
-- result. Lists are loaded by an admin; the person they're assigned to sees and works only their own.
create table if not exists public.call_list_items (
  id bigserial primary key,
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  assignee text not null,
  list_name text not null,
  list_date date not null,
  first_name text,
  last_name text,
  phone text,
  line text,
  opportunity_date date,
  result text check (result in ('no_answer', 'voicemail', 'reached', 'not_interested', 'wrong_number')),
  notes text,
  called_at timestamptz,
  called_by text,
  created_at timestamptz not null default now()
);
create index if not exists call_list_items_assignee on public.call_list_items (agency_id, assignee, list_date);

alter table public.call_list_items enable row level security;
drop policy if exists "own or admin read" on public.call_list_items;
create policy "own or admin read" on public.call_list_items for select to authenticated
  using (agency_id = public.current_agency_id() and (public.staff_is_admin() or lower(assignee) = any (public.my_names())));
drop policy if exists "own or admin update" on public.call_list_items;
create policy "own or admin update" on public.call_list_items for update to authenticated
  using (agency_id = public.current_agency_id() and (public.staff_is_admin() or lower(assignee) = any (public.my_names())))
  with check (agency_id = public.current_agency_id());
drop policy if exists "admin insert" on public.call_list_items;
create policy "admin insert" on public.call_list_items for insert to authenticated
  with check (agency_id = public.current_agency_id() and public.staff_is_admin());
drop policy if exists "admin delete" on public.call_list_items;
create policy "admin delete" on public.call_list_items for delete to authenticated
  using (agency_id = public.current_agency_id() and public.staff_is_admin());

-- when a call's result is recorded: when, and by whom (cleared if the result is taken off)
create or replace function public.call_list_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.result is null then
    new.called_at := null; new.called_by := null;
  elsif old.result is distinct from new.result then
    new.called_at := now();
    new.called_by := (select coalesce(nullif(trim(s.display_name), ''), s.producer_name) from public.staff_accounts s where s.user_id = auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists call_list_stamp on public.call_list_items;
create trigger call_list_stamp before update of result on public.call_list_items
  for each row execute function public.call_list_stamp();
