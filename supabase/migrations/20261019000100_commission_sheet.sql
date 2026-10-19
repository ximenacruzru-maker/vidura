-- Commission sheet: a section an admin can switch on for whoever runs payroll (Rhon) without opening Office Payroll
-- (hours, pay rates, salaries stay owner/admin only). It lets them read what the commission sheet needs — every SDR's
-- transfers, the SDR pay months and the Apex quote numbers — and the commissions function returns every producer's
-- line to them. staff_can('commission_sheet') is true for owners/admins, and for others only when switched on.
create policy "commission sheet read" on public.sdr_transfers for select to authenticated
  using (agency_id = current_agency_id() and staff_can('commission_sheet'));
create policy "commission sheet read" on public.sdr_pay_periods for select to authenticated
  using (agency_id = current_agency_id() and staff_can('commission_sheet'));
alter policy "quote numbers read" on public.sdr_quote_numbers
  using (agency_id = current_agency_id() and (staff_is_admin() or staff_can('payroll') or staff_can('commission_sheet') or lower(sdr) = any(my_names())));
