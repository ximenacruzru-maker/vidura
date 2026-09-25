-- Vida Foresight: lead spend by source, and the lead source on each sold policy.
--
-- Run this BEFORE deploying the updated agencyzoom-sync function: the new sync writes
-- daily_sales.lead_source, and upserts would fail on a database without the column.
--
-- Written against the columns the app and edge functions use (staff_accounts.user_id / role / active,
-- daily_sales.*). They could not be checked against the live schema, so review before running.

-- 1. What each lead source cost, for a date range. One row per source per billing period; a period
--    can be a month, a campaign or a single invoice. Amounts are dollars spent in that range.
create table if not exists public.lead_spend (
  id           uuid primary key default gen_random_uuid(),
  source       text not null check (length(btrim(source)) > 0),
  period_start date not null,
  period_end   date not null,
  amount       numeric(12, 2) not null check (amount >= 0),
  notes        text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (period_end >= period_start)
);
create index if not exists lead_spend_source_period on public.lead_spend (source, period_start, period_end);

alter table public.lead_spend enable row level security;

-- Every active staff member may read spend; only the owner and admins may record or change it.
drop policy if exists lead_spend_read on public.lead_spend;
create policy lead_spend_read on public.lead_spend for select to authenticated
  using (exists (select 1 from public.staff_accounts s where s.user_id = auth.uid() and s.active));

drop policy if exists lead_spend_write on public.lead_spend;
create policy lead_spend_write on public.lead_spend for all to authenticated
  using (exists (select 1 from public.staff_accounts s where s.user_id = auth.uid() and s.active and s.role in ('owner', 'admin')))
  with check (exists (select 1 from public.staff_accounts s where s.user_id = auth.uid() and s.active and s.role in ('owner', 'admin')));

-- 2. The AgencyZoom lead source behind each sold policy, filled by the sync from the won lead the
--    customer converted from. NULL means not captured: rows written before this column existed, and
--    sales whose customer has no won lead in AgencyZoom. Nothing is backfilled or guessed.
alter table public.daily_sales add column if not exists lead_source text;
