-- The daily renewal review grows to 20 a day (10 negative, 10 positive). Each renewal now carries the client's phone
-- and do-not-call flag, the reviewer's findings written before the call, an explicit "reached the client" mark, and
-- the renewal options PDF sent to the client (kept in the documents bucket under <agency>/renewals/).
alter table public.renewal_reviews
  add column if not exists phone text,
  add column if not exists dnc boolean not null default false,
  add column if not exists findings text,
  add column if not exists spoke boolean not null default false,
  add column if not exists options_path text,
  add column if not exists options_file text;

-- The ranked call lists (the negative list: biggest premium increases first) the reviewer pulls each day's renewals
-- from. Anyone at the agency with a login reads it; admins load it.
create table if not exists public.renewal_call_list (
  id bigint generated always as identity primary key,
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  kind text not null check (kind in ('negative', 'positive')),
  rank int not null,
  client text not null check (length(trim(client)) > 0),
  household text,
  policy_number text,
  lob text,
  renewal_date date,
  current_premium numeric(12,2),
  renewal_premium numeric(12,2),
  phone text,
  phone_type text,
  dnc boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  unique (agency_id, kind, policy_number)
);
alter table public.renewal_call_list enable row level security;
revoke truncate on public.renewal_call_list from anon, authenticated;
create policy "agency reads" on public.renewal_call_list for select to authenticated
  using (agency_id = public.current_agency_id());
create policy "admins write" on public.renewal_call_list for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_is_admin())
  with check (agency_id = public.current_agency_id() and public.staff_is_admin());
grant select, insert, update, delete on public.renewal_call_list to authenticated;

-- renewal options PDFs: the reviewer (or an admin) uploads; reading follows the review row it's attached to
create policy "upload renewal options" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and name like public.current_agency_id()::text || '/renewals/%'
    and (public.staff_is_admin() or coalesce(array_length(public.my_names(), 1), 0) > 0));
create policy "read renewal options" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and name like public.current_agency_id()::text || '/renewals/%'
    and exists (select 1 from public.renewal_reviews r where r.options_path = objects.name));
create policy "delete renewal options" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and name like public.current_agency_id()::text || '/renewals/%'
    and exists (select 1 from public.renewal_reviews r where r.options_path = objects.name));
