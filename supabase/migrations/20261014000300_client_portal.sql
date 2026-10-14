-- Client portal: a client signs in and sees their own file, live — their policies, locations, what they spend,
-- renewals coming up, documents, and the items the agency posts for them (things pending, updates).
--
-- How it stays private:
-- * A client login is a row in client_logins (written only by the staff-admin function, by an owner/admin). It is
--   not a staff account, so current_agency_id() is null for a client and every existing staff policy denies them.
-- * Clients get NO policies on book_accounts / book_policies / documents. They read their file only through
--   client_portal(), which returns client-safe fields: never the agency's internal notes, invoice numbers or flags.
-- * Files: a client can open a document only if it is filed on their account, uploaded and not admin-only.
-- * Staff with Books access can preview exactly what a client sees: client_portal('<account id>').

create table if not exists public.client_logins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  agency_id uuid not null references public.agencies(id),
  account_ids text[] not null check (cardinality(account_ids) > 0),
  display_name text not null,
  email text not null,
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  created_by text
);
alter table public.client_logins enable row level security;
revoke insert, update, delete, truncate on public.client_logins from anon, authenticated;
-- (a client reads their login only through client_portal(); this row-level rule keeps the isolation audit clean)
create policy "client sees own login" on public.client_logins for select to authenticated using (agency_id = current_agency_id() and user_id = auth.uid());
create policy "staff see client logins" on public.client_logins for select to authenticated using (agency_id = current_agency_id() and staff_can('books'));

-- what the agency posts to a client's portal: things pending (on the client or on us) and updates
create table if not exists public.client_items (
  id bigint generated always as identity primary key,
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  account_id text not null,
  kind text not null default 'pending' check (kind in ('pending', 'update')),
  title text not null check (length(trim(title)) > 0),
  detail text,
  due_on date,
  status text not null default 'open' check (status in ('open', 'done')),
  created_by text,
  created_by_user uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists client_items_account on public.client_items (agency_id, account_id);
create or replace function public.client_item_stamp() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce((select display_name from public.staff_accounts where user_id = auth.uid()), 'system'); end if;
  if tg_op = 'UPDATE' then
    if (new.agency_id, new.account_id, new.created_at, new.created_by) is distinct from (old.agency_id, old.account_id, old.created_at, old.created_by) then raise exception 'That can''t be changed.'; end if;
    new.done_at := case when new.status = 'done' then coalesce(old.done_at, now()) else null end;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger client_item_stamp before insert or update on public.client_items for each row execute function public.client_item_stamp();
alter table public.client_items enable row level security;
revoke truncate on public.client_items from anon, authenticated;
create policy "staff read client items" on public.client_items for select to authenticated using (agency_id = current_agency_id() and staff_can('books'));
create policy "staff post client items" on public.client_items for insert to authenticated
  with check (agency_id = current_agency_id() and staff_can('books')
    and exists (select 1 from public.book_accounts a where a.agency_id = current_agency_id() and a.id = account_id));
create policy "staff update client items" on public.client_items for update to authenticated
  using (agency_id = current_agency_id() and staff_can('books')) with check (agency_id = current_agency_id() and staff_can('books'));
create policy "admins delete client items" on public.client_items for delete to authenticated
  using (agency_id = current_agency_id() and current_staff_role() in ('owner', 'admin'));

-- the client's file, client-safe fields only. With p_account, staff with Books access preview that account.
create or replace function public.client_portal(p_account text default null) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare ag uuid; ids text[]; viewer jsonb;
begin
  if p_account is not null then
    if not coalesce(public.staff_can('books'), false) then return null; end if;
    ag := public.current_agency_id();
    if not exists (select 1 from public.book_accounts where agency_id = ag and id = p_account) then return null; end if;
    ids := array[p_account];
    viewer := jsonb_build_object('preview', true, 'display_name', (select contact from public.book_accounts where agency_id = ag and id = p_account), 'must_change_password', false);
  else
    select c.agency_id, c.account_ids, jsonb_build_object('preview', false, 'display_name', c.display_name, 'email', c.email, 'must_change_password', c.must_change_password)
      into ag, ids, viewer from public.client_logins c where c.user_id = auth.uid() and c.active;
    if ag is null then return null; end if;
  end if;
  return jsonb_build_object(
    'viewer', viewer,
    'agency', (select jsonb_build_object('name', name, 'short_name', short_name) from public.agencies where id = ag),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'dba', a.dba, 'contact', a.contact, 'phone', a.phone, 'address', a.address,
        'locations', coalesce((select jsonb_agg(jsonb_build_object('id', l->>'id', 'name', l->>'name', 'address', l->>'address'))
                               from jsonb_array_elements(case when jsonb_typeof(a.data->'locations') = 'array' then a.data->'locations' else '[]'::jsonb end) l), '[]'::jsonb))
        order by a.name) from public.book_accounts a where a.agency_id = ag and a.id = any(ids)), '[]'::jsonb),
    'policies', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'account_id', p.account_id, 'policy_number', p.policy_number, 'insured', p.insured,
        'carrier', p.carrier, 'product', p.product, 'effective', p.effective, 'expiration', p.expiration, 'premium', p.premium, 'status', p.status,
        'location', p.location, 'location_id', p.data->>'locationId', 'location_name', p.data->>'locationName', 'location_address', p.data->>'locationAddress',
        'coverage', p.data->>'coverageType', 'amount_due_now', p.data->'amountDueNow', 'financed', (p.data->>'finance') is not null or p.status ilike '%financ%',
        'payment_due', p.data->>'paymentDue', 'payment_plan', p.data->>'paymentPlan', 'payment_method', p.data->>'paymentMethod', 'updated_at', p.updated_at)
        order by p.expiration nulls last) from public.book_policies p where p.agency_id = ag and p.account_id = any(ids)), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'category', d.category, 'account_id', d.account_id, 'policy_number', d.policy_number,
        'title', d.title, 'file_name', d.file_name, 'mime', d.mime, 'storage_path', d.storage_path, 'size_bytes', d.size_bytes, 'created_at', d.created_at)
        order by d.created_at desc) from public.documents d where d.agency_id = ag and d.account_id = any(ids) and d.uploaded and not d.admin_only), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'account_id', i.account_id, 'kind', i.kind, 'title', i.title, 'detail', i.detail,
        'due_on', i.due_on, 'status', i.status, 'created_at', i.created_at, 'updated_at', i.updated_at, 'done_at', i.done_at)
        order by i.status, i.due_on nulls last, i.created_at desc) from public.client_items i where i.agency_id = ag and i.account_id = any(ids)), '[]'::jsonb),
    'updated_at', greatest(
      (select max(updated_at) from public.book_policies where agency_id = ag and account_id = any(ids)),
      (select max(updated_at) from public.book_accounts where agency_id = ag and id = any(ids)),
      (select max(updated_at) from public.client_items where agency_id = ag and account_id = any(ids)),
      (select max(created_at) from public.documents where agency_id = ag and account_id = any(ids) and uploaded and not admin_only))
  );
end $$;
revoke execute on function public.client_portal(text) from anon;

-- a client may open a file only if it is filed on their account, uploaded and not admin-only
create or replace function public.client_can_read_document(p_name text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.documents d join public.client_logins c on c.user_id = auth.uid() and c.active
    where d.storage_path = p_name and d.agency_id = c.agency_id and d.account_id = any(c.account_ids) and d.uploaded and not d.admin_only)
$$;
create policy "clients read their documents" on storage.objects for select to authenticated using (bucket_id = 'documents' and public.client_can_read_document(name));

-- choosing a password clears the "must change" flag for staff and clients alike
create or replace function public.password_changed() returns void language sql security definer set search_path to 'public' as $$
  update public.staff_accounts set must_change_password = false where user_id = auth.uid();
  update public.client_logins set must_change_password = false where user_id = auth.uid();
$$;
