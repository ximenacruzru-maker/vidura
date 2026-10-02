-- Force refreshes: 3 per rolling 12 hours per agency (was 24).
create or replace function public.claim_force_refresh(p_user uuid, p_name text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare used int; oldest timestamptz; v_agency uuid;
begin
  select agency_id into v_agency from public.staff_accounts where user_id = p_user and active;
  if v_agency is null then return jsonb_build_object('ok', false, 'error', 'not staff'); end if;
  perform pg_advisory_xact_lock(hashtext('force_refresh:' || v_agency));
  select count(*), min(requested_at) into used, oldest
    from force_refresh_log where agency_id = v_agency and requested_at > now() - interval '12 hours';
  if used >= 3 then
    return jsonb_build_object('ok', false, 'used', used, 'next_at', oldest + interval '12 hours');
  end if;
  insert into force_refresh_log(agency_id, requested_by, requested_name) values (v_agency, p_user, p_name);
  return jsonb_build_object('ok', true, 'used', used + 1);
end $function$;
