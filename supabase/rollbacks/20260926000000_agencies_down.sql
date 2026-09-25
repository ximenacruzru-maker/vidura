-- Undo 20260926000000_agencies.sql: back to one agency (Ironwood) per database.
-- Deletes every row that does not belong to Ironwood (the demo agency and any other), then removes
-- agency_id everywhere and restores the original keys, policies, functions and views exactly.
begin;
do $$ declare iw uuid := (select id from public.agencies where slug = 'ironwood'); t text; p record;
begin
  delete from storage.objects o where o.bucket_id = 'documents' and exists (select 1 from public.documents d where d.storage_path = o.name and d.agency_id <> iw);
  delete from public.staff_accounts where agency_id <> iw;
  foreach t in array array['agency_login_log','agency_login_secrets','agency_logins','az_month_sales','book_policies','documents','licenses','book_accounts',
    'chat_messages','checklist_ticks','checklist_items','folio_line_items','commission_folios','comp_plans','daily_sales','force_refresh_log','hr_punches','hr_staff',
    'lead_spend','producers','quote_leads','reference_data','sales_history','sdr_config','sdr_pay_periods','sdr_transfers','sync_log','training_progress',
    'training_status','user_prefs','work_items'] loop
    execute format('delete from public.%I where agency_id <> %L', t, iw);
  end loop;
  for p in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;
drop policy "staff read documents" on storage.objects;
drop policy "admin upload documents" on storage.objects;
drop policy "admin update documents" on storage.objects;
drop view public.daily_summary, public.folio_by_carrier, public.folio_by_line, public.folio_by_producer, public.folio_metrics,
  public.folios, public.policies_sold, public.sdr_month_summary, public.staff_directory;

alter table public.folio_line_items drop constraint folio_line_items_folio_key_fkey;
alter table public.book_policies    drop constraint book_policies_account_id_fkey;
alter table public.documents        drop constraint documents_account_id_fkey;
alter table public.licenses         drop constraint licenses_document_id_fkey;
alter table public.hr_punches       drop constraint hr_punches_name_fkey;
alter table public.reference_data   drop constraint reference_data_pkey,   add primary key (key);
alter table public.book_accounts    drop constraint book_accounts_pkey,    add primary key (id);
alter table public.book_policies    drop constraint book_policies_pkey,    add primary key (id);
alter table public.documents        drop constraint documents_pkey,        add primary key (id);
alter table public.hr_staff         drop constraint hr_staff_pkey,         add primary key (name);
alter table public.az_month_sales   drop constraint az_month_sales_pkey,   add primary key (month, producer);
alter table public.sales_history    drop constraint sales_history_pkey,    add primary key (az_ref);
alter table public.training_status  drop constraint training_status_pkey,  add primary key (person, course);
alter table public.commission_folios drop constraint commission_folios_agency_folio_key, add constraint commission_folios_folio_key_key unique (folio_key);
alter table public.daily_sales       drop constraint daily_sales_agency_az_ref_uq,       add constraint daily_sales_az_ref_uq unique (az_ref);
alter table public.quote_leads       drop constraint quote_leads_agency_az_ref_uq,       add constraint quote_leads_az_ref_uq unique (az_ref);
alter table public.sdr_transfers     drop constraint sdr_transfers_agency_az_ref_uq,     add constraint sdr_transfers_az_ref_uq unique (az_ref);
alter table public.sdr_transfers     drop constraint sdr_transfers_agency_sdr_lead_day_key, add constraint sdr_transfers_sdr_lead_id_date_time_key unique (sdr, lead_id, date_time);
alter table public.hr_punches        drop constraint hr_punches_agency_name_work_date_key, add constraint hr_punches_name_work_date_key unique (name, work_date);
alter table public.producers         drop constraint producers_agency_name_key,          add constraint producers_name_key unique (name);
alter table public.sdr_pay_periods   drop constraint sdr_pay_periods_agency_month_key,   add constraint sdr_pay_periods_month_key unique (month);
alter table public.folio_line_items add constraint folio_line_items_folio_key_fkey FOREIGN KEY (folio_key) REFERENCES commission_folios(folio_key) ON DELETE CASCADE;
alter table public.book_policies add constraint book_policies_account_id_fkey FOREIGN KEY (account_id) REFERENCES book_accounts(id) ON DELETE CASCADE;
alter table public.documents add constraint documents_account_id_fkey FOREIGN KEY (account_id) REFERENCES book_accounts(id) ON DELETE SET NULL;
alter table public.licenses add constraint licenses_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL;
alter table public.hr_punches add constraint hr_punches_name_fkey FOREIGN KEY (name) REFERENCES hr_staff(name) ON UPDATE CASCADE;

do $$ declare t text; begin
  foreach t in array array['agency_login_log','agency_login_secrets','agency_logins','az_month_sales','book_accounts','book_policies',
    'chat_messages','checklist_items','checklist_ticks','commission_folios','comp_plans','daily_sales','documents',
    'folio_line_items','force_refresh_log','hr_punches','hr_staff','lead_spend','licenses','producers','quote_leads',
    'reference_data','sales_history','sdr_config','sdr_pay_periods','sdr_transfers','sync_log','training_progress',
    'training_status','user_prefs','work_items','staff_accounts'] loop
    execute format('alter table public.%I drop column agency_id', t);
  end loop;
end $$;
drop function public.current_agency_id();
drop table public.agencies;

-- Original views, functions and policies
create view public.daily_summary with (security_invoker=on) as SELECT sale_date, producer, sum(premium) AS total, count(*) AS n FROM daily_sales GROUP BY sale_date, producer;
create view public.folio_by_carrier with (security_invoker=on) as SELECT folio_key, carrier AS label, sum(premium) AS value, count(*) AS n, bool_or(carrier = ANY (ARRAY['Farmers'::text, 'Farmers New World Life'::text, 'Foremost'::text, 'Foremost Star'::text])) AS is_farmers_family FROM folio_line_items GROUP BY folio_key, carrier;
create view public.folio_by_line with (security_invoker=on) as SELECT folio_key, line AS label, sum(premium) AS value, count(*) AS n FROM folio_line_items GROUP BY folio_key, line;
create view public.folio_by_producer with (security_invoker=on) as SELECT folio_key, producer AS label, sum(premium) AS value, count(*) AS n FROM folio_line_items GROUP BY folio_key, producer;
create view public.folio_metrics with (security_invoker=on) as SELECT folio_key, sum(premium) AS written_premium, count(*) AS policies_sold, count(DISTINCT client) AS distinct_customers, round(count(*)::numeric / NULLIF(count(DISTINCT client), 0)::numeric, 2) AS policies_per_customer, sum(premium) FILTER (WHERE carrier = ANY (ARRAY['Farmers'::text, 'Farmers New World Life'::text, 'Foremost'::text, 'Foremost Star'::text])) AS farmers_foremost_premium FROM folio_line_items GROUP BY folio_key;
create view public.folios with (security_invoker=true) as SELECT folio_key AS start_date, COALESCE(lead(folio_key) OVER (ORDER BY folio_key) - 1, folio_key + 29) AS end_date, period AS label, in_progress FROM commission_folios;
create view public.policies_sold with (security_invoker=true) as SELECT 'hist-'::text || folio_line_items.id::text AS ref, folio_line_items.when_date AS sale_date, folio_line_items.producer, folio_line_items.client, folio_line_items.line, folio_line_items.carrier, folio_line_items.premium, NULL::text AS customer_id, 'export'::text AS origin FROM folio_line_items
UNION ALL SELECT daily_sales.az_ref AS ref, daily_sales.sale_date, daily_sales.producer, daily_sales.client_name AS client, daily_sales.policy_type AS line, daily_sales.carrier, daily_sales.premium, daily_sales.customer_id, 'sync'::text AS origin FROM daily_sales WHERE daily_sales.az_ref ~~ 'pol-%'::text AND daily_sales.sale_date > '2026-09-17'::date;
create view public.sdr_month_summary with (security_invoker=on) as SELECT t.sdr, t.month, count(*) AS total_logged, count(*) FILTER (WHERE t.az_qualifies) AS qualified_transfers, count(*) FILTER (WHERE t.bound) AS bound_policies, COALESCE(sum(t.bound_premium) FILTER (WHERE t.bound), 0::numeric) AS bound_premium,
  count(*) FILTER (WHERE t.az_qualifies)::numeric * COALESCE(p.qualified_transfer_bonus, c.qualified_transfer_bonus, 15::numeric) AS qualified_bonus,
  count(*) FILTER (WHERE t.bound)::numeric * COALESCE(p.bound_policy_bonus, c.bound_policy_bonus, 35::numeric) AS bound_bonus,
  count(*) FILTER (WHERE t.az_qualifies)::numeric * COALESCE(p.qualified_transfer_bonus, c.qualified_transfer_bonus, 15::numeric) + count(*) FILTER (WHERE t.bound)::numeric * COALESCE(p.bound_policy_bonus, c.bound_policy_bonus, 35::numeric) AS total_bonus
  FROM sdr_transfers t LEFT JOIN sdr_pay_periods p ON p.month = t.month
  CROSS JOIN LATERAL ( SELECT sdr_config.id, sdr_config.qualified_transfer_bonus, sdr_config.bound_policy_bonus, sdr_config.rule, sdr_config.updated_at FROM sdr_config ORDER BY sdr_config.id DESC LIMIT 1) c
  GROUP BY t.sdr, t.month, p.qualified_transfer_bonus, p.bound_policy_bonus, c.qualified_transfer_bonus, c.bound_policy_bonus;
create view public.staff_directory with (security_invoker=false) as SELECT user_id, display_name, role FROM staff_accounts WHERE active AND current_staff_role() IS NOT NULL;

CREATE OR REPLACE FUNCTION public.agency_login_reveal(p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v text; v_name text; v_who text;
begin
  if not coalesce(public.staff_can('passwords'), false) then raise exception 'You do not have access to agency passwords'; end if;
  select name into v_name from public.agency_logins where id = p_id;
  select extensions.pgp_sym_decrypt(secret, public.vault_key()) into v from public.agency_login_secrets where login_id = p_id;
  select display_name into v_who from public.staff_accounts where user_id = auth.uid();
  insert into public.agency_login_log(login_id, login_name, action, by_name) values (p_id, v_name, 'viewed', v_who);
  return v;
end $function$
;

CREATE OR REPLACE FUNCTION public.agency_login_save(p_id uuid, p_grp text, p_name text, p_url text, p_username text, p_notes text, p_password text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_who text;
begin
  if not public.staff_is_admin() then raise exception 'Only admins can add or change agency passwords'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Name is required'; end if;
  select display_name into v_who from public.staff_accounts where user_id = auth.uid();
  if p_id is null then
    insert into public.agency_logins(grp, name, url, username, notes, updated_by)
    values (coalesce(nullif(trim(p_grp), ''), 'Carriers'), trim(p_name), nullif(trim(p_url), ''), nullif(p_username, ''), nullif(p_notes, ''), v_who)
    returning id into v_id;
  else
    update public.agency_logins set grp = coalesce(nullif(trim(p_grp), ''), 'Carriers'), name = trim(p_name), url = nullif(trim(p_url), ''),
      username = nullif(p_username, ''), notes = nullif(p_notes, ''), updated_by = v_who, updated_at = now()
    where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Login not found'; end if;
  end if;
  if p_password is not null and p_password <> '' then
    insert into public.agency_login_secrets(login_id, secret)
    values (v_id, extensions.pgp_sym_encrypt(p_password, public.vault_key()))
    on conflict (login_id) do update set secret = excluded.secret;
    update public.agency_logins set has_secret = true where id = v_id;
  end if;
  insert into public.agency_login_log(login_id, login_name, action, by_name) values (v_id, trim(p_name), case when p_id is null then 'added' else 'edited' end, v_who);
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.claim_force_refresh(p_user uuid, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare used int; oldest timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('force_refresh'));
  select count(*), min(requested_at) into used, oldest
    from force_refresh_log where requested_at > now() - interval '24 hours';
  if used >= 3 then
    return jsonb_build_object('ok', false, 'used', used, 'next_at', oldest + interval '24 hours');
  end if;
  insert into force_refresh_log(requested_by, requested_name) values (p_user, p_name);
  return jsonb_build_object('ok', true, 'used', used + 1);
end $function$
;

CREATE OR REPLACE FUNCTION public.perf_data()
 RETURNS TABLE(key text, data jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare nm text[] := coalesce(public.my_names(), '{}'::text[]);
begin
  if public.current_staff_role() is null or not public.staff_can('performance') then
    return;
  end if;
  if public.staff_is_admin() then
    return query select r.key, r.data from public.reference_data r where r.key like 'lg:%' order by r.key;
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
  from public.reference_data r where r.key like 'lg:%' order by r.key;
end
$function$
;

create policy "log read" on public.agency_login_log for select to authenticated using (staff_is_admin());
create policy "logins delete" on public.agency_logins for delete to authenticated using (staff_is_admin());
create policy "logins read" on public.agency_logins for select to authenticated using (staff_can('passwords'::text));
create policy "admin read" on public.az_month_sales for select to authenticated using (staff_is_admin());
create policy "admin insert" on public.book_accounts for insert to authenticated with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin update" on public.book_accounts for update to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text]))) with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "staff read" on public.book_accounts for select to authenticated using ((current_staff_role() IS NOT NULL));
create policy "admin insert" on public.book_policies for insert to authenticated with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin update" on public.book_policies for update to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text]))) with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "staff read" on public.book_policies for select to authenticated using ((current_staff_role() IS NOT NULL));
create policy "chat delete own" on public.chat_messages for delete to authenticated using ((author_id = auth.uid()));
create policy "chat post" on public.chat_messages for insert to authenticated with check (((author_id = auth.uid()) AND (current_staff_role() IS NOT NULL) AND (((room !~~ 'dm:%'::text) AND ((room <> 'owners'::text) OR (current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])))) OR ((room ~~ 'dm:%'::text) AND (POSITION(((auth.uid())::text) IN (room)) > 0)))));
create policy "chat read" on public.chat_messages for select to authenticated using (((current_staff_role() IS NOT NULL) AND (((room !~~ 'dm:%'::text) AND ((room <> 'owners'::text) OR (current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])))) OR ((room ~~ 'dm:%'::text) AND (POSITION(((auth.uid())::text) IN (room)) > 0)))));
create policy "admin insert" on public.checklist_items for insert to authenticated with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin update" on public.checklist_items for update to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text]))) with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "staff read" on public.checklist_items for select to authenticated using ((current_staff_role() IS NOT NULL));
create policy "own ticks" on public.checklist_ticks for all to authenticated using ((user_id = auth.uid())) with check (((user_id = auth.uid()) AND (current_staff_role() IS NOT NULL)));
create policy "admin write insert" on public.commission_folios for insert to authenticated with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin write update" on public.commission_folios for update to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "staff read" on public.commission_folios for select to authenticated using ((current_staff_role() IS NOT NULL));
create policy "admin read plans" on public.comp_plans for select to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin write plans insert" on public.comp_plans for insert to authenticated with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin write plans update" on public.comp_plans for update to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin write insert" on public.daily_sales for insert to authenticated with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin write update" on public.daily_sales for update to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "own or admin read" on public.daily_sales for select to authenticated using ((staff_is_admin() OR (lower(producer) = ANY (my_names()))));
create policy "admin insert" on public.documents for insert to authenticated with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin update" on public.documents for update to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text]))) with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "staff read" on public.documents for select to authenticated using (((current_staff_role() IS NOT NULL) AND ((NOT admin_only) OR (current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])))));
create policy "admin write insert" on public.folio_line_items for insert to authenticated with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin write update" on public.folio_line_items for update to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "own or admin read" on public.folio_line_items for select to authenticated using ((staff_is_admin() OR (lower(producer) = ANY (my_names()))));
create policy "staff read" on public.force_refresh_log for select to authenticated using ((current_staff_role() IS NOT NULL));
create policy "hr insert" on public.hr_punches for insert to authenticated with check (staff_can('hr'::text));
create policy "hr read" on public.hr_punches for select to authenticated using (staff_can('hr'::text));
create policy "hr update" on public.hr_punches for update to authenticated using (staff_can('hr'::text)) with check (staff_can('hr'::text));
create policy "admin insert" on public.hr_staff for insert to authenticated with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin update" on public.hr_staff for update to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text]))) with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "hr read" on public.hr_staff for select to authenticated using (staff_can('hr'::text));
create policy lead_spend_read on public.lead_spend for select to authenticated using ((EXISTS ( SELECT 1 FROM staff_accounts s WHERE ((s.user_id = auth.uid()) AND s.active))));
create policy lead_spend_write on public.lead_spend for all to authenticated using ((EXISTS ( SELECT 1 FROM staff_accounts s WHERE ((s.user_id = auth.uid()) AND s.active AND (s.role = ANY (ARRAY['owner'::text, 'admin'::text])))))) with check ((EXISTS ( SELECT 1 FROM staff_accounts s WHERE ((s.user_id = auth.uid()) AND s.active AND (s.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));
create policy "admin insert" on public.licenses for insert to authenticated with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin update" on public.licenses for update to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text]))) with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "staff read" on public.licenses for select to authenticated using ((current_staff_role() IS NOT NULL));
create policy "admin write insert" on public.producers for insert to authenticated with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin write update" on public.producers for update to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "staff read" on public.producers for select to authenticated using ((current_staff_role() IS NOT NULL));
create policy "admin write insert" on public.quote_leads for insert to authenticated with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin write update" on public.quote_leads for update to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "own or admin read" on public.quote_leads for select to authenticated using ((staff_is_admin() OR (lower(producer) = ANY (my_names()))));
create policy "admin insert" on public.reference_data for insert to authenticated with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin update" on public.reference_data for update to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text]))) with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "staff read" on public.reference_data for select to public using (((current_staff_role() IS NOT NULL) AND ((NOT admin_only) OR staff_is_admin())));
create policy "admin read" on public.sales_history for select to authenticated using (staff_is_admin());
create policy "admin write insert" on public.sdr_config for insert to authenticated with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin write update" on public.sdr_config for update to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "staff read" on public.sdr_config for select to authenticated using ((current_staff_role() IS NOT NULL));
create policy "admin write insert" on public.sdr_pay_periods for insert to authenticated with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin write update" on public.sdr_pay_periods for update to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "read periods" on public.sdr_pay_periods for select to authenticated using ((staff_is_admin() OR ((current_staff_role() IS NOT NULL) AND (month >= '2026-09'::text))));
create policy "admin write insert" on public.sdr_transfers for insert to authenticated with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin write update" on public.sdr_transfers for update to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "own or admin read" on public.sdr_transfers for select to authenticated using ((staff_is_admin() OR ((lower(sdr) = ANY (my_names())) AND (month >= '2026-09'::text))));
create policy "admin manage staff insert" on public.staff_accounts for insert to authenticated with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin manage staff update" on public.staff_accounts for update to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "staff read own or admin all" on public.staff_accounts for select to authenticated using (((user_id = auth.uid()) OR (current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text]))));
create policy "admin write insert" on public.sync_log for insert to authenticated with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin write update" on public.sync_log for update to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "staff read" on public.sync_log for select to authenticated using ((current_staff_role() IS NOT NULL));
create policy "own progress" on public.training_progress for all to authenticated using (((user_id = auth.uid()) OR (current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])))) with check (((user_id = auth.uid()) AND (current_staff_role() IS NOT NULL)));
create policy "admin insert" on public.training_status for insert to authenticated with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "admin update" on public.training_status for update to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text]))) with check ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "staff read" on public.training_status for select to authenticated using ((current_staff_role() IS NOT NULL));
create policy "own prefs" on public.user_prefs for all to authenticated using ((user_id = auth.uid())) with check (((user_id = auth.uid()) AND (current_staff_role() IS NOT NULL)));
create policy "admin delete" on public.work_items for delete to authenticated using ((current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])));
create policy "own or admin read" on public.work_items for select to authenticated using (work_item_is_mine(owner, created_by));
create policy "own or admin update" on public.work_items for update to authenticated using (work_item_is_mine(owner, created_by)) with check ((current_staff_role() IS NOT NULL));
create policy "staff insert" on public.work_items for insert to authenticated with check ((current_staff_role() IS NOT NULL));
create policy "staff read documents" on storage.objects for select to authenticated using (((bucket_id = 'documents'::text) AND (current_staff_role() IS NOT NULL) AND ((name !~~ 'admin/%'::text) OR (current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text])))));
create policy "admin upload documents" on storage.objects for insert to authenticated with check (((bucket_id = 'documents'::text) AND (current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text]))));
create policy "admin update documents" on storage.objects for update to authenticated using (((bucket_id = 'documents'::text) AND (current_staff_role() = ANY (ARRAY['owner'::text, 'admin'::text]))));
commit;
