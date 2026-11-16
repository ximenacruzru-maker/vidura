-- Pay adjustments: a one-off change to someone's check on a payday, with the reason — a clawback for unpaid time off,
-- a bonus approved outside the plan, a correction. Office Payroll adds them into the person's total (and the payroll
-- download and report PDFs), and the person sees their own on My Pay. Owners and admins add and remove them.
create table if not exists public.hr_pay_adjustments (
  id bigserial primary key,
  agency_id uuid not null default public.current_agency_id() references public.agencies(id),
  name text not null,
  pay_date date not null,
  amount numeric(12, 2) not null,
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists hr_pay_adjustments_pay on public.hr_pay_adjustments (agency_id, pay_date);
alter table public.hr_pay_adjustments enable row level security;
drop policy if exists "admin or own read" on public.hr_pay_adjustments;
create policy "admin or own read" on public.hr_pay_adjustments for select to authenticated
  using (agency_id = public.current_agency_id() and (public.staff_is_admin() or lower(name) = any (public.my_names())));
drop policy if exists "admin write" on public.hr_pay_adjustments;
create policy "admin write" on public.hr_pay_adjustments for all to authenticated
  using (agency_id = public.current_agency_id() and public.staff_is_admin())
  with check (agency_id = public.current_agency_id() and public.staff_is_admin());
