-- Lists anything that could let one agency see another's rows: a public table without row-level security, without an
-- agency_id column, or with a policy that doesn't require agency_id = current_agency_id(). An empty result is a pass.
-- Run it after any schema change:  select * from public.isolation_audit();
-- (agencies, platform_admins and user_prefs are scoped differently: own agency row, own admin row, own preferences.)
create or replace function public.isolation_audit()
 returns table (object text, problem text) language sql stable security definer set search_path to public, pg_catalog
as $$
  select c.relname::text, 'row-level security is off'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  union all
  select c.relname::text, 'no agency_id column'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('agencies', 'platform_admins', 'user_prefs')
    and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'agency_id' and not a.attisdropped)
  union all
  select p.tablename || ' · ' || p.policyname, 'policy does not require agency_id = current_agency_id()'
  from pg_policies p
  where p.schemaname = 'public' and p.tablename not in ('agencies', 'platform_admins', 'user_prefs')
    and coalesce(p.qual, '') || coalesce(p.with_check, '') !~ 'agency_id = current_agency_id\(\)'
  order by 1
$$;
revoke execute on function public.isolation_audit() from public, anon, authenticated;
