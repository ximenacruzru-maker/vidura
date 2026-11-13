-- Notes on Work & Tickets items: a running thread on each item (who wrote what, when), so progress is written down as
-- it happens. Whoever can see an item can read and add its notes; a note can be deleted by its author or an admin.
create table if not exists public.work_item_notes (
  id bigserial primary key,
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  item_id bigint not null references public.work_items(id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  author text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists work_item_notes_item on public.work_item_notes (item_id, created_at);

alter table public.work_item_notes enable row level security;
drop policy if exists "see the item" on public.work_item_notes;
create policy "see the item" on public.work_item_notes for select to authenticated
  using (agency_id = public.current_agency_id() and exists (select 1 from public.work_items w where w.id = item_id));
drop policy if exists "add to an item you see" on public.work_item_notes;
create policy "add to an item you see" on public.work_item_notes for insert to authenticated
  with check (agency_id = public.current_agency_id() and created_by = auth.uid() and exists (select 1 from public.work_items w where w.id = item_id));
drop policy if exists "author or admin delete" on public.work_item_notes;
create policy "author or admin delete" on public.work_item_notes for delete to authenticated
  using (agency_id = public.current_agency_id() and (created_by = auth.uid() or public.staff_is_admin()));

-- the author's name is filled in from their login, so it can't be typed as someone else
create or replace function public.work_item_notes_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_by := auth.uid();
  new.author := (select coalesce(nullif(trim(s.display_name), ''), s.producer_name) from public.staff_accounts s where s.user_id = auth.uid());
  return new;
end;
$$;
drop trigger if exists work_item_notes_author on public.work_item_notes;
create trigger work_item_notes_author before insert on public.work_item_notes
  for each row execute function public.work_item_notes_author();

-- The team's day, for the recap emailed to the owner: everyone's work completed, notes, renewal reviews, retention
-- log, call-list calls, sales and quotes on one day. Owners, admins and whoever runs the work queue only.
create or replace function public.team_day(p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a uuid := public.current_agency_id();
  tz text := 'America/Los_Angeles';
begin
  if a is null or not (public.staff_is_admin() or exists (select 1 from public.staff_accounts s where s.user_id = auth.uid() and s.active and (s.access->>'work_manager') = 'true')) then
    raise exception 'The team recap is for the owner, admins and whoever runs the work queue.';
  end if;
  return jsonb_build_object(
    'day', p_day,
    'owner_email', (select string_agg(email, ',') from public.staff_accounts where agency_id = a and role = 'owner' and active and coalesce(email, '') <> ''),
    'staff', (select coalesce(jsonb_agg(jsonb_build_object('display', display_name, 'producer', producer_name, 'role', role) order by display_name), '[]')
                from public.staff_accounts where agency_id = a and active),
    'completed', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'owner', owner, 'by', completed_by, 'priority', priority) order by completed_at), '[]')
                from public.work_items where agency_id = a and completed_at is not null and (completed_at at time zone tz)::date = p_day),
    'logged', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'owner', owner, 'source', source, 'status', status) order by id), '[]')
                from public.work_items where agency_id = a and entered = p_day and source ilike 'logged by %'),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('item', w.name, 'author', n.author, 'body', n.body, 'at', n.created_at) order by n.created_at), '[]')
                from public.work_item_notes n join public.work_items w on w.id = n.item_id
               where n.agency_id = a and (n.created_at at time zone tz)::date = p_day),
    'reviews', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'kind', kind, 'client', client, 'spoke', spoke, 'call1', call1, 'call2', call2, 'emailed', emailed,
                  'findings', findings, 'notes', notes) order by name, id), '[]')
                from public.renewal_reviews where agency_id = a and day = p_day),
    'retention', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'kind', kind, 'client', client, 'premium', premium, 'note', note) order by name, id), '[]')
                from public.retention_log where agency_id = a and day = p_day),
    'calls', (select coalesce(jsonb_agg(jsonb_build_object('by', coalesce(called_by, assignee), 'client', trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), 'result', result, 'notes', notes) order by called_at), '[]')
                from public.call_list_items where agency_id = a and called_at is not null and (called_at at time zone tz)::date = p_day),
    'sales', (select coalesce(jsonb_agg(jsonb_build_object('producer', producer, 'client', client_name, 'line', policy_type, 'carrier', carrier, 'premium', premium) order by producer), '[]')
                from public.daily_sales where agency_id = a and sale_date = p_day and confirmed is not false),
    'quotes', (select coalesce(jsonb_agg(jsonb_build_object('producer', producer, 'name', name, 'premium', quoted_premium) order by producer), '[]')
                from public.quote_leads where agency_id = a and quote_day = p_day)
  );
end;
$$;
revoke all on function public.team_day(date) from public, anon;
grant execute on function public.team_day(date) to authenticated;
