-- Year-End Life Promo (huddle, Nov 9 2026): a producer is paid a share of a life policy's annual premium, by the
-- team's issued & paid count when the policy is written — 25% to start, 30% after 40, 35% after 50 (prospective,
-- no true-ups). The team stood at 31 issued & paid on November 9; every life policy written from then on is the next
-- case. The settings live in reference_data (lg:LIFE_PROMO) so the dashboard banner, Reports › Commissions and the
-- commissions function all read the same ones.
insert into public.reference_data (agency_id, key, data, admin_only)
select a.id, 'lg:LIFE_PROMO', jsonb_build_object(
  'name', 'Year-End Life Promo',
  'headline', 'One policy. Bigger payouts.',
  'from', '2026-11-09', 'to', '2026-12-31',
  'baseline', 31, 'baselineAsOf', '2026-11-09', 'goal', 70,
  'avgPremium', 835,
  'tiers', jsonb_build_array(
    jsonb_build_object('after', 0, 'rate', 0.25, 'label', 'Starting rate'),
    jsonb_build_object('after', 40, 'rate', 0.30, 'label', 'After 40 team I&P'),
    jsonb_build_object('after', 50, 'rate', 0.35, 'label', 'After 50 team I&P')),
  'note', 'Payout on eligible first-year annual premium; not on low-commission IUL excess. Tier changes are prospective — no retroactive true-ups.'),
  false
from public.agencies a where a.agencyzoom_sync
on conflict do nothing;

-- The team's count for the banner: everyone sees the total, never anyone's individual sales.
create or replace function public.life_promo_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select data from public.reference_data where agency_id = public.current_agency_id() and key = 'lg:LIFE_PROMO'
  ), today as (select (now() at time zone 'America/Los_Angeles')::date d)
  select case when p.data is null then null else jsonb_build_object(
    'promo', p.data,
    'today', today.d,
    'written', (select count(*) from public.policies_sold s
       where s.agency_id = public.current_agency_id()
         and s.sale_date >= (p.data->>'from')::date and s.sale_date <= least(today.d, (p.data->>'to')::date)
         and (s.line ilike '%life%' or s.carrier ilike '%life%')))
  end
  from p, today
$$;
revoke all on function public.life_promo_status() from public, anon;
grant execute on function public.life_promo_status() to authenticated;
