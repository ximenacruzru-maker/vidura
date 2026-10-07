-- SDR bonus: a bound transfer earns the bound policy bonus in place of the qualified transfer bonus ($35 total, not
-- $15 + $35). The qualified bonus now counts qualified transfers that haven't bound.
create or replace view public.sdr_month_summary with (security_invoker=on) as
  select t.sdr, t.month, count(*) as total_logged,
    count(*) filter (where t.az_qualifies) as qualified_transfers,
    count(*) filter (where t.bound) as bound_policies,
    coalesce(sum(t.bound_premium) filter (where t.bound), 0) as bound_premium,
    count(*) filter (where t.az_qualifies and not coalesce(t.bound, false))::numeric * coalesce(p.qualified_transfer_bonus, c.qualified_transfer_bonus, 15) as qualified_bonus,
    count(*) filter (where t.bound)::numeric * coalesce(p.bound_policy_bonus, c.bound_policy_bonus, 35) as bound_bonus,
    count(*) filter (where t.az_qualifies and not coalesce(t.bound, false))::numeric * coalesce(p.qualified_transfer_bonus, c.qualified_transfer_bonus, 15)
      + count(*) filter (where t.bound)::numeric * coalesce(p.bound_policy_bonus, c.bound_policy_bonus, 35) as total_bonus,
    t.agency_id
  from public.sdr_transfers t
  left join public.sdr_pay_periods p on p.agency_id = t.agency_id and p.month = t.month
  left join lateral (select s.qualified_transfer_bonus, s.bound_policy_bonus from public.sdr_config s
                     where s.agency_id = t.agency_id order by s.id desc limit 1) c on true
  group by t.agency_id, t.sdr, t.month, p.qualified_transfer_bonus, p.bound_policy_bonus, c.qualified_transfer_bonus, c.bound_policy_bonus;
