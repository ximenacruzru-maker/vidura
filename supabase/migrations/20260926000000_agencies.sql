-- Multi-agency: every row belongs to one agency, and a login only ever sees its own agency's rows.
--
-- The model:
--   agencies                one row per agency (Ironwood, the demo agency, and any agency added later)
--   staff_accounts.agency_id  the agency a login belongs to
--   current_agency_id()     the signed-in login's agency, used by every policy
--   <every table>.agency_id NOT NULL, defaults to current_agency_id(), foreign key to agencies
--
-- Every existing access policy keeps its rule and gains "agency_id = current_agency_id()" in front of
-- it, so nothing a login could see before is widened, and nothing from another agency is reachable.
-- Unique keys that were agency-wide (az_ref, folio_key, month, names, text ids) become unique per
-- agency, so two agencies can hold the same AgencyZoom ids or folio dates without colliding.
--
-- Service-role callers (edge functions) bypass row-level security, so they must pass agency_id
-- themselves; the column has no fallback, and a row written without one is rejected rather than
-- landing in the wrong agency.
--
-- Existing rows all belong to Ironwood and are backfilled to it. Undo: supabase/rollbacks/20260926000000_agencies_down.sql.

begin;

-- 1. Agencies -------------------------------------------------------------------------------------
create table public.agencies (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name            text not null check (length(btrim(name)) > 0),
  short_name      text,
  is_demo         boolean not null default false,
  -- The agency the AgencyZoom sync writes to. One for now, because the sync has one set of
  -- credentials; per-agency credentials would lift this.
  agencyzoom_sync boolean not null default false,
  -- Sales on or before this day come from the agency's own reconciled export (folio_line_items);
  -- policies_sold only takes synced sales after it.
  history_cutoff  date,
  created_at      timestamptz not null default now()
);
create unique index agencies_one_agencyzoom_sync on public.agencies ((true)) where agencyzoom_sync;

insert into public.agencies (slug, name, short_name, agencyzoom_sync, history_cutoff)
values ('ironwood', 'Ironwood Insurance Agency', 'Ironwood', true, '2026-09-17');

-- 2. Which agency the signed-in login belongs to -----------------------------------------------------
alter table public.staff_accounts add column agency_id uuid references public.agencies(id);
update public.staff_accounts set agency_id = (select id from public.agencies where slug = 'ironwood');
alter table public.staff_accounts alter column agency_id set not null;
create index staff_accounts_agency_idx on public.staff_accounts (agency_id);

create function public.current_agency_id() returns uuid
  language sql stable security definer set search_path to ''
as $$ select agency_id from public.staff_accounts where user_id = auth.uid() and active $$;
-- Signed-out callers get null (so policies simply match nothing) rather than a permission error.
grant execute on function public.current_agency_id() to anon, authenticated, service_role;

alter table public.staff_accounts alter column agency_id set default public.current_agency_id();

alter table public.agencies enable row level security;
create policy "own agency" on public.agencies for select to authenticated using (id = public.current_agency_id());
grant select on public.agencies to authenticated;
grant all on public.agencies to service_role;

-- 3. agency_id on every other table, backfilled to Ironwood ---------------------------------------
do $$
declare
  t text;
  iw uuid := (select id from public.agencies where slug = 'ironwood');
begin
  foreach t in array array[
    'agency_login_log','agency_login_secrets','agency_logins','az_month_sales','book_accounts','book_policies',
    'chat_messages','checklist_items','checklist_ticks','commission_folios','comp_plans','daily_sales','documents',
    'folio_line_items','force_refresh_log','hr_punches','hr_staff','lead_spend','licenses','producers','quote_leads',
    'reference_data','sales_history','sdr_config','sdr_pay_periods','sdr_transfers','sync_log','training_progress',
    'training_status','user_prefs','work_items'
  ] loop
    execute format('alter table public.%I add column agency_id uuid references public.agencies(id)', t);
    execute format('update public.%I set agency_id = %L', t, iw);
    execute format('alter table public.%I alter column agency_id set not null', t);
    execute format('alter table public.%I alter column agency_id set default public.current_agency_id()', t);
    execute format('create index %I on public.%I (agency_id)', t || '_agency_idx', t);
  end loop;
end $$;

-- 4. Keys that were unique across the database become unique per agency ------------------------------
-- (foreign keys that point at them are dropped first and re-created against the agency-scoped key)
alter table public.folio_line_items drop constraint folio_line_items_folio_key_fkey;
alter table public.book_policies    drop constraint book_policies_account_id_fkey;
alter table public.documents        drop constraint documents_account_id_fkey;
alter table public.licenses         drop constraint licenses_document_id_fkey;
alter table public.hr_punches       drop constraint hr_punches_name_fkey;

alter table public.reference_data   drop constraint reference_data_pkey,   add primary key (agency_id, key);
alter table public.book_accounts    drop constraint book_accounts_pkey,    add primary key (agency_id, id);
alter table public.book_policies    drop constraint book_policies_pkey,    add primary key (agency_id, id);
alter table public.documents        drop constraint documents_pkey,        add primary key (agency_id, id);
alter table public.hr_staff         drop constraint hr_staff_pkey,         add primary key (agency_id, name);
alter table public.az_month_sales   drop constraint az_month_sales_pkey,   add primary key (agency_id, month, producer);
alter table public.sales_history    drop constraint sales_history_pkey,    add primary key (agency_id, az_ref);
alter table public.training_status  drop constraint training_status_pkey,  add primary key (agency_id, person, course);

alter table public.commission_folios drop constraint commission_folios_folio_key_key, add constraint commission_folios_agency_folio_key unique (agency_id, folio_key);
alter table public.daily_sales       drop constraint daily_sales_az_ref_uq,           add constraint daily_sales_agency_az_ref_uq unique (agency_id, az_ref);
alter table public.quote_leads       drop constraint quote_leads_az_ref_uq,           add constraint quote_leads_agency_az_ref_uq unique (agency_id, az_ref);
alter table public.sdr_transfers     drop constraint sdr_transfers_az_ref_uq,         add constraint sdr_transfers_agency_az_ref_uq unique (agency_id, az_ref);
alter table public.sdr_transfers     drop constraint sdr_transfers_sdr_lead_id_date_time_key, add constraint sdr_transfers_agency_sdr_lead_day_key unique (agency_id, sdr, lead_id, date_time);
alter table public.hr_punches        drop constraint hr_punches_name_work_date_key,   add constraint hr_punches_agency_name_work_date_key unique (agency_id, name, work_date);
alter table public.producers         drop constraint producers_name_key,              add constraint producers_agency_name_key unique (agency_id, name);
alter table public.sdr_pay_periods   drop constraint sdr_pay_periods_month_key,       add constraint sdr_pay_periods_agency_month_key unique (agency_id, month);

alter table public.folio_line_items add constraint folio_line_items_folio_key_fkey
  foreign key (agency_id, folio_key) references public.commission_folios (agency_id, folio_key) on delete cascade;
alter table public.book_policies add constraint book_policies_account_id_fkey
  foreign key (agency_id, account_id) references public.book_accounts (agency_id, id) on delete cascade;
alter table public.documents add constraint documents_account_id_fkey
  foreign key (agency_id, account_id) references public.book_accounts (agency_id, id) on delete set null (account_id);
alter table public.licenses add constraint licenses_document_id_fkey
  foreign key (agency_id, document_id) references public.documents (agency_id, id) on delete set null (document_id);
alter table public.hr_punches add constraint hr_punches_name_fkey
  foreign key (agency_id, name) references public.hr_staff (agency_id, name) on update cascade;

-- 5. Every access policy gains the agency rule ---------------------------------------------------------
do $$
declare p record; roles text; q text; c text;
begin
  for p in select * from pg_policies where schemaname = 'public' and tablename <> 'agencies' loop
    select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') into roles from unnest(p.roles) r;
    q := case when p.qual is null then null else '(agency_id = public.current_agency_id()) and (' || p.qual || ')' end;
    c := case when p.with_check is null then null else '(agency_id = public.current_agency_id()) and (' || p.with_check || ')' end;
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
    execute format('create policy %I on public.%I as %s for %s to %s', p.policyname, p.tablename, p.permissive, p.cmd, roles)
      || coalesce(' using (' || q || ')', '') || coalesce(' with check (' || c || ')', '');
  end loop;
end $$;

-- 6. Functions that run with owner rights check the agency themselves ---------------------------------
create or replace function public.agency_login_reveal(p_id uuid)
 returns text language plpgsql security definer set search_path to ''
as $function$
declare v text; v_name text; v_who text;
begin
  if not coalesce(public.staff_can('passwords'), false) then raise exception 'You do not have access to agency passwords'; end if;
  select name into v_name from public.agency_logins where id = p_id and agency_id = public.current_agency_id();
  if v_name is null then raise exception 'Login not found'; end if;
  select extensions.pgp_sym_decrypt(secret, public.vault_key()) into v from public.agency_login_secrets
    where login_id = p_id and agency_id = public.current_agency_id();
  select display_name into v_who from public.staff_accounts where user_id = auth.uid();
  insert into public.agency_login_log(login_id, login_name, action, by_name) values (p_id, v_name, 'viewed', v_who);
  return v;
end $function$;

create or replace function public.agency_login_save(p_id uuid, p_grp text, p_name text, p_url text, p_username text, p_notes text, p_password text)
 returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid; v_who text; v_agency uuid := public.current_agency_id();
begin
  if not public.staff_is_admin() or v_agency is null then raise exception 'Only admins can add or change agency passwords'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Name is required'; end if;
  select display_name into v_who from public.staff_accounts where user_id = auth.uid();
  if p_id is null then
    insert into public.agency_logins(agency_id, grp, name, url, username, notes, updated_by)
    values (v_agency, coalesce(nullif(trim(p_grp), ''), 'Carriers'), trim(p_name), nullif(trim(p_url), ''), nullif(p_username, ''), nullif(p_notes, ''), v_who)
    returning id into v_id;
  else
    update public.agency_logins set grp = coalesce(nullif(trim(p_grp), ''), 'Carriers'), name = trim(p_name), url = nullif(trim(p_url), ''),
      username = nullif(p_username, ''), notes = nullif(p_notes, ''), updated_by = v_who, updated_at = now()
    where id = p_id and agency_id = v_agency returning id into v_id;
    if v_id is null then raise exception 'Login not found'; end if;
  end if;
  if p_password is not null and p_password <> '' then
    insert into public.agency_login_secrets(agency_id, login_id, secret)
    values (v_agency, v_id, extensions.pgp_sym_encrypt(p_password, public.vault_key()))
    on conflict (login_id) do update set secret = excluded.secret;
    update public.agency_logins set has_secret = true where id = v_id;
  end if;
  insert into public.agency_login_log(agency_id, login_id, login_name, action, by_name)
  values (v_agency, v_id, trim(p_name), case when p_id is null then 'added' else 'edited' end, v_who);
  return v_id;
end $function$;

-- Called by the agencyzoom-refresh function (service role), so the agency comes from the user passed in.
-- The 3-a-day allowance is per agency.
create or replace function public.claim_force_refresh(p_user uuid, p_name text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare used int; oldest timestamptz; v_agency uuid;
begin
  select agency_id into v_agency from public.staff_accounts where user_id = p_user and active;
  if v_agency is null then return jsonb_build_object('ok', false, 'error', 'not staff'); end if;
  perform pg_advisory_xact_lock(hashtext('force_refresh:' || v_agency));
  select count(*), min(requested_at) into used, oldest
    from force_refresh_log where agency_id = v_agency and requested_at > now() - interval '24 hours';
  if used >= 3 then
    return jsonb_build_object('ok', false, 'used', used, 'next_at', oldest + interval '24 hours');
  end if;
  insert into force_refresh_log(agency_id, requested_by, requested_name) values (v_agency, p_user, p_name);
  return jsonb_build_object('ok', true, 'used', used + 1);
end $function$;

create or replace function public.perf_data()
 returns table(key text, data jsonb) language plpgsql stable security definer set search_path to 'public'
as $function$
declare nm text[] := coalesce(public.my_names(), '{}'::text[]); v_agency uuid := public.current_agency_id();
begin
  if v_agency is null or public.current_staff_role() is null or not public.staff_can('performance') then
    return;
  end if;
  if public.staff_is_admin() then
    return query select r.key, r.data from public.reference_data r where r.agency_id = v_agency and r.key like 'lg:%' order by r.key;
    return;
  end if;
  return query
  select r.key,
    case r.key
      when 'lg:WB_DATA' then
        case when r.data ? 'commissionsByFolio' then jsonb_set(r.data, '{commissionsByFolio}', coalesce((
          select jsonb_object_agg(f.key, coalesce((select jsonb_object_agg(p.key, p.value) from jsonb_each(f.value) p
                                                   where public.perf_is_me(p.key, nm)), '{}'::jsonb))
          from jsonb_each(r.data->'commissionsByFolio') f), '{}'::jsonb)) else r.data end
      when 'lg:WB_EXTRA' then
        case when jsonb_typeof(r.data->'sdr') = 'object' then
          jsonb_set(jsonb_set(r.data, '{sdr,byMonth}', coalesce((
            select jsonb_object_agg(m.key, coalesce((select jsonb_object_agg(p.key, p.value) from jsonb_each(m.value) p
                                                     where p.key = 'meta' or public.perf_is_me(p.key, nm)), '{}'::jsonb))
            from jsonb_each(coalesce(r.data->'sdr'->'byMonth', '{}'::jsonb)) m), '{}'::jsonb)),
            '{sdr,transfers}', coalesce((
            select jsonb_agg(t) from jsonb_array_elements(coalesce(r.data->'sdr'->'transfers', '[]'::jsonb)) t
            where public.perf_is_me(t->>'sdr', nm)), '[]'::jsonb))
        else r.data end
      when 'lg:HR_STAFF' then coalesce((
        select jsonb_agg(case when public.perf_is_me(e->>'name', nm) then e else e - 'rate' end)
        from jsonb_array_elements(r.data) e), '[]'::jsonb)
      when 'lg:HR_PUNCHES' then coalesce((
        select jsonb_object_agg(p.key, p.value) from jsonb_each(r.data) p where public.perf_is_me(p.key, nm)), '{}'::jsonb)
      when 'lg:HR_EDITS' then '{}'::jsonb
      when 'lg:COMM_RESULTS' then '{}'::jsonb
      else r.data
    end
  from public.reference_data r where r.agency_id = v_agency and r.key like 'lg:%' order by r.key;
end
$function$;

-- 7. Views carry agency_id (edge functions read them with the service role, which skips RLS) -------
create or replace view public.daily_summary with (security_invoker=on) as
  select sale_date, producer, sum(premium) as total, count(*) as n, agency_id
  from public.daily_sales group by agency_id, sale_date, producer;
create or replace view public.folio_by_carrier with (security_invoker=on) as
  select folio_key, carrier as label, sum(premium) as value, count(*) as n,
    bool_or(carrier = any (array['Farmers', 'Farmers New World Life', 'Foremost', 'Foremost Star'])) as is_farmers_family, agency_id
  from public.folio_line_items group by agency_id, folio_key, carrier;
create or replace view public.folio_by_line with (security_invoker=on) as
  select folio_key, line as label, sum(premium) as value, count(*) as n, agency_id
  from public.folio_line_items group by agency_id, folio_key, line;
create or replace view public.folio_by_producer with (security_invoker=on) as
  select folio_key, producer as label, sum(premium) as value, count(*) as n, agency_id
  from public.folio_line_items group by agency_id, folio_key, producer;
create or replace view public.folio_metrics with (security_invoker=on) as
  select folio_key, sum(premium) as written_premium, count(*) as policies_sold, count(distinct client) as distinct_customers,
    round(count(*)::numeric / nullif(count(distinct client), 0)::numeric, 2) as policies_per_customer,
    sum(premium) filter (where carrier = any (array['Farmers', 'Farmers New World Life', 'Foremost', 'Foremost Star'])) as farmers_foremost_premium,
    agency_id
  from public.folio_line_items group by agency_id, folio_key;
create or replace view public.folios with (security_invoker=true) as
  select folio_key as start_date,
    coalesce(lead(folio_key) over (partition by agency_id order by folio_key) - 1, folio_key + 29) as end_date,
    period as label, in_progress, agency_id
  from public.commission_folios;
create or replace view public.policies_sold with (security_invoker=true) as
  select 'hist-' || f.id::text as ref, f.when_date as sale_date, f.producer, f.client, f.line, f.carrier, f.premium,
    null::text as customer_id, 'export'::text as origin, f.agency_id
  from public.folio_line_items f
  union all
  select d.az_ref, d.sale_date, d.producer, d.client_name, d.policy_type, d.carrier, d.premium, d.customer_id, 'sync', d.agency_id
  from public.daily_sales d join public.agencies a on a.id = d.agency_id
  where d.az_ref like 'pol-%' and d.sale_date > coalesce(a.history_cutoff, '-infinity'::date);
create or replace view public.sdr_month_summary with (security_invoker=on) as
  select t.sdr, t.month, count(*) as total_logged,
    count(*) filter (where t.az_qualifies) as qualified_transfers,
    count(*) filter (where t.bound) as bound_policies,
    coalesce(sum(t.bound_premium) filter (where t.bound), 0) as bound_premium,
    count(*) filter (where t.az_qualifies)::numeric * coalesce(p.qualified_transfer_bonus, c.qualified_transfer_bonus, 15) as qualified_bonus,
    count(*) filter (where t.bound)::numeric * coalesce(p.bound_policy_bonus, c.bound_policy_bonus, 35) as bound_bonus,
    count(*) filter (where t.az_qualifies)::numeric * coalesce(p.qualified_transfer_bonus, c.qualified_transfer_bonus, 15)
      + count(*) filter (where t.bound)::numeric * coalesce(p.bound_policy_bonus, c.bound_policy_bonus, 35) as total_bonus,
    t.agency_id
  from public.sdr_transfers t
  left join public.sdr_pay_periods p on p.agency_id = t.agency_id and p.month = t.month
  left join lateral (select s.qualified_transfer_bonus, s.bound_policy_bonus from public.sdr_config s
                     where s.agency_id = t.agency_id order by s.id desc limit 1) c on true
  group by t.agency_id, t.sdr, t.month, p.qualified_transfer_bonus, p.bound_policy_bonus, c.qualified_transfer_bonus, c.bound_policy_bonus;
-- Runs with owner rights (it has to read other people's staff rows), so it filters by agency itself.
create or replace view public.staff_directory with (security_invoker=false) as
  select user_id, display_name, role from public.staff_accounts
  where active and public.current_staff_role() is not null and agency_id = public.current_agency_id();

-- 8. Documents bucket: a file is readable only through a document row the login can see ---------------
-- New uploads go under "<agency id>/..."; Ironwood's existing files keep their paths and stay reachable
-- through their document rows.
drop policy "staff read documents" on storage.objects;
drop policy "admin upload documents" on storage.objects;
drop policy "admin update documents" on storage.objects;
create policy "staff read documents" on storage.objects for select to authenticated using (
  bucket_id = 'documents' and public.current_staff_role() is not null
  and exists (select 1 from public.documents d where d.storage_path = objects.name));
create policy "admin upload documents" on storage.objects for insert to authenticated with check (
  bucket_id = 'documents' and public.current_staff_role() in ('owner', 'admin')
  and name like public.current_agency_id()::text || '/%');
create policy "admin update documents" on storage.objects for update to authenticated using (
  bucket_id = 'documents' and public.current_staff_role() in ('owner', 'admin')
  and (name like public.current_agency_id()::text || '/%'
       or exists (select 1 from public.documents d where d.storage_path = objects.name)));

commit;
