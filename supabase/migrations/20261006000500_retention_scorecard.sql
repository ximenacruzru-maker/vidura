-- Ximena's role (Director of Client Success, Retention & Book Growth, effective Oct 6 2026) and the daily huddle
-- scorecard behind it.
--   retention_days   one row per person per day: the huddle numbers (at-risk touches, live renewal conversations,
--                    critical escalations and how many were contacted the same day, open critical cases aged over a
--                    day, brokered business current) and today's priority
--   retention_log    every documented save, loss and cross-sell: policies, annual premium, reason code
--   retention_months per person per month: whether Farmers and brokered premium reporting is reconciled (bonus gate 4)
-- Net Book Movement = saved premium + cross-sell premium - lost premium.
-- Read and written by the person themselves and by admins.

create table if not exists public.retention_days (
  agency_id uuid not null default public.current_agency_id() references public.agencies(id) on delete cascade,
  name text not null,
  day date not null,
  at_risk_touches int not null default 0,
  renewal_conversations int not null default 0,
  escalations int not null default 0,          -- critical escalations received
  escalations_same_day int not null default 0, -- of those, contacted (or a documented attempt) the same day
  open_critical_aged int not null default 0,   -- critical cases open over a business day without a blocker/deadline
  brokered_current boolean not null default true,
  priority text,
  updated_at timestamptz not null default now(),
  primary key (agency_id, name, day)
);

create table if not exists public.retention_log (
  id bigserial primary key,
  agency_id uuid not null default public.current_agency_id() references public.agencies(id) on delete cascade,
  name text not null,
  day date not null,
  kind text not null check (kind in ('save', 'loss', 'cross_sell')),
  client text not null,
  policies int not null default 1,
  premium numeric not null default 0, -- annual premium protected, lost or added
  carrier text,
  reason text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists retention_log_month on public.retention_log (agency_id, name, day);

create table if not exists public.retention_months (
  agency_id uuid not null default public.current_agency_id() references public.agencies(id) on delete cascade,
  name text not null,
  month text not null, -- YYYY-MM
  reconciled boolean not null default false,
  reconciled_note text,
  updated_at timestamptz not null default now(),
  primary key (agency_id, name, month)
);

do $$ declare t text; begin
  foreach t in array array['retention_days', 'retention_log', 'retention_months'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own or admin" on public.%I', t);
    execute format($p$create policy "own or admin" on public.%I for all to authenticated
      using (agency_id = public.current_agency_id() and (public.staff_is_admin() or lower(trim(name)) = any (coalesce(public.my_names(), '{}'))))
      with check (agency_id = public.current_agency_id() and (public.staff_is_admin() or lower(trim(name)) = any (coalesce(public.my_names(), '{}'))))$p$, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
grant usage on sequence public.retention_log_id_seq to authenticated;

-- How a salaried person's cash bonus is measured: 'folio' (the folio paid on the 21st) or 'month' (the calendar
-- month before the 21st it is paid on, after month-end reconciliation).
alter table public.hr_staff add column if not exists bonus_period text not null default 'folio';

-- Ximena's plan: $1,000 at $100k qualifying monthly agency premium, $2,500 at $150k, $5,000 at $200k (highest tier),
-- measured by calendar month from October 2026; she sees the Retention scorecard as her own work.
update public.hr_staff set bonus_period = 'month',
  bonus_tiers = '[{"min":100000,"amount":1000},{"min":150000,"amount":2500},{"min":200000,"amount":5000}]'::jsonb
where name = 'Ximena Cruz' and agency_id = (select id from public.agencies where agencyzoom_sync);
update public.staff_accounts set access = coalesce(access, '{}'::jsonb) || '{"retention": true}'::jsonb
where lower(producer_name) = 'ximena cruz' and agency_id = (select id from public.agencies where agencyzoom_sync);
