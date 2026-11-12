-- Life-sale celebrations: when a life policy lands, every signed-in staff screen pops up balloons with the producer's
-- name and what the policy paid them. This hands out the life sales recorded since `since` (the last one a screen
-- has shown), with the producer, the line and, during the Year-End Life Promo, its case number, rate and payout —
-- numbered the same way as the commissions (every life policy written in the promo, in date order, after the
-- baseline). Only sales just written count: a policy entered late for an old sold date is not news.
create or replace function public.life_wins(since timestamptz)
returns table (id bigint, producer text, line text, carrier text, recorded_at timestamptz, case_no int, rate numeric, earned numeric, team int, goal int)
language sql
stable
security definer
set search_path = public
as $$
  with me as (select public.current_agency_id() a),
  p as (select r.data from public.reference_data r, me where r.agency_id = me.a and r.key = 'lg:LIFE_PROMO'),
  cases as (
    select s.ref, ((p.data->>'baseline')::int + row_number() over (order by s.sale_date, lower(trim(s.client)), s.premium))::int n
      from public.policies_sold s, p, me
     where s.agency_id = me.a and (s.line ilike '%life%' or s.carrier ilike '%life%')
       and s.sale_date between (p.data->>'from')::date and (p.data->>'to')::date
  )
  select d.id, d.producer, d.policy_type, d.carrier, d.created_at, c.n,
         t.rate, round(d.premium * t.rate, 2),
         case when p.data is null then null else (p.data->>'baseline')::int + (select count(*) from cases)::int end,
         (p.data->>'goal')::int
    from public.daily_sales d
    cross join me
    left join p on true
    left join cases c on c.ref = d.az_ref
    left join lateral (
      select (x->>'rate')::numeric rate from jsonb_array_elements(p.data->'tiers') x
       where c.n > (x->>'after')::int order by (x->>'after')::int desc limit 1) t on true
   where d.agency_id = me.a and d.confirmed is not false
     and (d.policy_type ilike '%life%' or d.carrier ilike '%life%')
     and d.created_at > greatest(since, now() - interval '1 day')
     and d.sale_date >= (d.created_at at time zone 'America/Los_Angeles')::date - 7
   order by d.created_at, d.id
$$;
revoke all on function public.life_wins(timestamptz) from public, anon;
grant execute on function public.life_wins(timestamptz) to authenticated;
