-- CA FAIR Plan book: who sold each policy, from AgencyZoom. Each FAIR Plan policy in book_policies is matched to the
-- AgencyZoom policy records the sync keeps (az_policies, carrier "CA Fair Plan"): by policy number first (the digits,
-- so "CFP 0100660631 00" matches "CFP 0100660631"), then by the insured's name. Among the matches, one with a producer
-- wins, then the latest sold date. Kept in the policy's data: soldBy (the AgencyZoom producer; absent when AgencyZoom
-- has none), soldDate, azPolicyId and soldByMatch ("policy number" or "name"). Run by agencyzoom-sync after each sync.
create or replace function public.fair_plan_sold_by(p_agency uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with b as (
    select p.id, ltrim((regexp_match(coalesce(p.policy_number, ''), '(\d{6,})'))[1], '0') k,
           lower(btrim(regexp_replace(coalesce(p.insured, ''), '\s+', ' ', 'g'))) nm
    from book_policies p where p.agency_id = p_agency and p.book = 'fair_plan'
  ), z as (
    select policy_id, nullif(btrim(producer), '') producer, sold_date,
           ltrim((regexp_match(coalesce(policy_number, ''), '(\d{6,})'))[1], '0') k,
           lower(btrim(regexp_replace(coalesce(customer_name, ''), '\s+', ' ', 'g'))) nm
    from az_policies where agency_id = p_agency and (carrier ilike '%fair plan%' or policy_type ilike '%fair plan%')
  ), pick as (
    select distinct on (b.id) b.id, z.producer, z.sold_date, z.policy_id, case when z.k = b.k then 'policy number' else 'name' end how
    from b join z on (z.k <> '' and z.k = b.k) or (z.nm <> '' and z.nm = b.nm)
    order by b.id, (z.k = b.k) desc, (z.producer is not null) desc, z.sold_date desc nulls last
  ), upd as (
    update book_policies p
    set data = (coalesce(p.data, '{}'::jsonb) - 'soldBy' - 'soldDate' - 'azPolicyId' - 'soldByMatch')
               || jsonb_strip_nulls(jsonb_build_object('soldBy', pick.producer, 'soldDate', pick.sold_date, 'azPolicyId', pick.policy_id, 'soldByMatch', pick.how))
    from b left join pick on pick.id = b.id
    where p.id = b.id
      and (p.data->>'soldBy' is distinct from pick.producer or p.data->>'soldDate' is distinct from pick.sold_date::text
           or p.data->>'azPolicyId' is distinct from pick.policy_id or p.data->>'soldByMatch' is distinct from pick.how)
    returning 1
  )
  select count(*) into n from upd;
  return n;
end $$;
revoke all on function public.fair_plan_sold_by(uuid) from public, anon, authenticated;
grant execute on function public.fair_plan_sold_by(uuid) to service_role;
