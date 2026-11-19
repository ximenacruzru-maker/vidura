-- Call lists: room to write up findings before the call (why the renewal is going up, what to offer) and to attach
-- the client's renewal options PDF, as the daily renewal review has. The PDF lives in the private documents bucket under
-- <agency>/calllists/…; whoever can see the call-list row can open it (the row's own policies decide who that is).
alter table public.call_list_items add column if not exists findings text;
alter table public.call_list_items add column if not exists options_path text;
alter table public.call_list_items add column if not exists options_file text;

drop policy if exists "read call list options" on storage.objects;
create policy "read call list options" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and name like (public.current_agency_id())::text || '/calllists/%'
    and exists (select 1 from public.call_list_items c where c.options_path = objects.name));
drop policy if exists "delete call list options" on storage.objects;
create policy "delete call list options" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and name like (public.current_agency_id())::text || '/calllists/%'
    and exists (select 1 from public.call_list_items c where c.options_path = objects.name));
drop policy if exists "upload call list options" on storage.objects;
create policy "upload call list options" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and name like (public.current_agency_id())::text || '/calllists/%'
    and (public.staff_is_admin() or coalesce(array_length(public.my_names(), 1), 0) > 0));
