-- Compliance files: the agency's legal, tax and employee records in one audit-ready place (HR › Employee files and
-- HR › Agency legal & tax). Employee files hold W-4s, I-9s and the like, so only people with the HR permission can see
-- them — the agency owner and admins only, not other staff (even with the HR switch), not clients. The files live in the private documents bucket under <agency>/hr/.
create table if not exists public.compliance_files (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  scope text not null check (scope in ('person', 'agency')),
  staff_name text,
  doc_type text not null check (length(doc_type) between 1 and 40),
  title text,
  period_from date,
  period_to date,
  expires_on date,
  file_name text not null,
  mime text,
  size_bytes bigint,
  storage_path text not null unique,
  note text,
  vendor_id uuid,
  uploaded_by text,
  uploaded_by_user uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (scope = 'agency' or staff_name is not null),
  check (period_to is null or period_from is null or period_to >= period_from)
);
create index if not exists compliance_files_agency on public.compliance_files (agency_id, scope, staff_name, doc_type);

create or replace function public.compliance_file_stamp() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    new.uploaded_by := coalesce((select display_name from public.staff_accounts where user_id = auth.uid()), 'system');
    new.uploaded_by_user := auth.uid();
  else
    if (new.agency_id, new.storage_path, new.created_at, new.uploaded_by, new.uploaded_by_user) is distinct from (old.agency_id, old.storage_path, old.created_at, old.uploaded_by, old.uploaded_by_user)
      then raise exception 'That can''t be changed.'; end if;
  end if;
  return new;
end $$;
create trigger compliance_file_stamp before insert or update on public.compliance_files for each row execute function public.compliance_file_stamp();

alter table public.compliance_files enable row level security;
revoke truncate on public.compliance_files from anon, authenticated;
create policy "hr read compliance files" on public.compliance_files for select to authenticated
  using (agency_id = current_agency_id() and current_staff_role() in ('owner', 'admin'));
create policy "hr add compliance files" on public.compliance_files for insert to authenticated
  with check (agency_id = current_agency_id() and current_staff_role() in ('owner', 'admin') and storage_path like current_agency_id()::text || '/hr/%');
create policy "hr update compliance files" on public.compliance_files for update to authenticated
  using (agency_id = current_agency_id() and current_staff_role() in ('owner', 'admin')) with check (agency_id = current_agency_id() and current_staff_role() in ('owner', 'admin'));
create policy "admins delete compliance files" on public.compliance_files for delete to authenticated
  using (agency_id = current_agency_id() and current_staff_role() in ('owner', 'admin'));

-- the files: HR uploads under <agency>/hr/; reading needs a compliance_files row the reader can see (its own
-- row-level security applies inside this check), so only the owner and admins can open one, even with the path
create policy "hr upload compliance files" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and current_staff_role() in ('owner', 'admin') and name like current_agency_id()::text || '/hr/%');
create policy "hr read compliance files" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and current_staff_role() in ('owner', 'admin') and exists (select 1 from public.compliance_files f where f.storage_path = objects.name));
create policy "admins delete compliance files" on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and current_staff_role() in ('owner', 'admin') and name like current_agency_id()::text || '/hr/%');

-- an item marked "kept by our accountant / payroll provider" or "doesn't apply to us": it stays on the checklist but
-- comes off the risk-gap list (taxes the accountant files, a DBA the agency doesn't use)
create table if not exists public.compliance_marks (
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  scope text not null check (scope in ('person', 'agency')),
  staff_name text not null default '',
  doc_type text not null,
  mark text not null check (mark in ('accountant', 'na')),
  note text,
  marked_by text,
  marked_at timestamptz not null default now(),
  primary key (agency_id, scope, staff_name, doc_type)
);
create or replace function public.compliance_mark_stamp() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  new.marked_by := coalesce((select display_name from public.staff_accounts where user_id = auth.uid()), 'system');
  new.marked_at := now();
  return new;
end $$;
create trigger compliance_mark_stamp before insert or update on public.compliance_marks for each row execute function public.compliance_mark_stamp();
alter table public.compliance_marks enable row level security;
revoke truncate on public.compliance_marks from anon, authenticated;
create policy "hr read compliance marks" on public.compliance_marks for select to authenticated using (agency_id = current_agency_id() and current_staff_role() in ('owner', 'admin'));
create policy "hr add compliance marks" on public.compliance_marks for insert to authenticated with check (agency_id = current_agency_id() and current_staff_role() in ('owner', 'admin'));
create policy "hr change compliance marks" on public.compliance_marks for update to authenticated using (agency_id = current_agency_id() and current_staff_role() in ('owner', 'admin')) with check (agency_id = current_agency_id() and current_staff_role() in ('owner', 'admin'));
create policy "hr clear compliance marks" on public.compliance_marks for delete to authenticated using (agency_id = current_agency_id() and current_staff_role() in ('owner', 'admin'));

-- vendors & subscriptions the agency pays for (lead vendors, software, services): what each costs, how it bills and
-- when it renews, with the contract filed in compliance_files (vendor_id). Owner and admins only.
create table if not exists public.vendor_subscriptions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  name text not null check (length(trim(name)) > 0),
  kind text not null default 'software' check (kind in ('lead', 'software', 'service', 'other')),
  purpose text,
  cost numeric(12,2) check (cost is null or cost >= 0),
  billing text not null default 'monthly' check (billing in ('monthly', 'quarterly', 'yearly', 'one_time')),
  renews_on date,
  started_on date,
  active boolean not null default true,
  url text,
  note text,
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create or replace function public.vendor_stamp() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'UPDATE' and new.agency_id is distinct from old.agency_id then raise exception 'That can''t be changed.'; end if;
  new.updated_by := coalesce((select display_name from public.staff_accounts where user_id = auth.uid()), 'system');
  new.updated_at := now();
  return new;
end $$;
create trigger vendor_stamp before insert or update on public.vendor_subscriptions for each row execute function public.vendor_stamp();
alter table public.vendor_subscriptions enable row level security;
revoke truncate on public.vendor_subscriptions from anon, authenticated;
create policy "owner reads vendors" on public.vendor_subscriptions for select to authenticated using (agency_id = current_agency_id() and current_staff_role() in ('owner', 'admin'));
create policy "owner adds vendors" on public.vendor_subscriptions for insert to authenticated with check (agency_id = current_agency_id() and current_staff_role() in ('owner', 'admin'));
create policy "owner changes vendors" on public.vendor_subscriptions for update to authenticated using (agency_id = current_agency_id() and current_staff_role() in ('owner', 'admin')) with check (agency_id = current_agency_id() and current_staff_role() in ('owner', 'admin'));
create policy "owner removes vendors" on public.vendor_subscriptions for delete to authenticated using (agency_id = current_agency_id() and current_staff_role() in ('owner', 'admin'));
alter table public.compliance_files add constraint compliance_files_vendor foreign key (vendor_id) references public.vendor_subscriptions(id) on delete set null;
