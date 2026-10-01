-- My Pay: everyone can read their own pay record (hourly rate) and their own timesheet punches, matched by name the
-- same way their own sales and transfers are. HR and payroll still see everyone's.
create policy "own read" on public.hr_staff for select to authenticated
  using (agency_id = current_agency_id() and lower(trim(name)) = any (coalesce(my_names(), '{}')));
create policy "own read" on public.hr_punches for select to authenticated
  using (agency_id = current_agency_id() and lower(trim(name)) = any (coalesce(my_names(), '{}')));
