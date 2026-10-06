-- Salaried staff: an annual salary (paid in 24 equal checks, on the 5th and the 21st) instead of hours × rate, no
-- commission, and cash bonuses on the agency's written premium for the folio paid on the 21st (the highest tier
-- reached, not added up). bonus_tiers is [{"min": <agency premium>, "amount": <cash bonus>}].
alter table public.hr_staff add column if not exists salary_annual numeric;
alter table public.hr_staff add column if not exists bonus_tiers jsonb;

-- The agency's written premium between two days: one number, so a salaried person's bonus can be worked out on
-- My Pay without them being able to read everyone's sales.
create or replace function public.agency_premium(p_from date, p_to date) returns numeric
  language sql stable security definer set search_path = public as $$
  select coalesce(sum(premium), 0) from public.policies_sold
  where agency_id = public.current_agency_id() and sale_date between p_from and p_to
$$;
revoke all on function public.agency_premium(date, date) from public, anon;
grant execute on function public.agency_premium(date, date) to authenticated;

-- Ximena Cruz: salaried at $75,000 from October 2026; cash bonus of $1,000 when the agency writes $100k in a folio,
-- $5,000 at $150k, $10,000 at $200k
update public.hr_staff set hourly = false, rate = null, salary_annual = 75000,
  bonus_tiers = '[{"min":100000,"amount":1000},{"min":150000,"amount":5000},{"min":200000,"amount":10000}]'::jsonb
where name = 'Ximena Cruz' and agency_id = (select id from public.agencies where agencyzoom_sync);
