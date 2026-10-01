-- A VA (virtual assistant) role, and "Office payroll": the person who runs payroll for the whole office sees
-- everyone's hours and pay rates, every producer's commission and every SDR's bonus for a pay period, downloads it
-- as one workbook, and uploads the payroll files (the provider's report, a signed copy) back to the period.
-- A VA gets Office payroll by default; an admin can switch it on or off for anyone on Team & access.

alter table public.staff_accounts drop constraint if exists staff_accounts_role_check;
alter table public.staff_accounts add constraint staff_accounts_role_check
  check (role = any (array['owner','admin','producer','protege','sdr','csr','va']));

create or replace function public.staff_can(section text)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select case
    when s.role in ('owner','admin') then true
    when section = 'performance' then false
    when s.access ? section then coalesce((s.access->>section)::boolean, false)
    else section = any (case s.role
      when 'protege' then array['books','resources','work','chat','training','proteges','passwords']
      when 'va' then array['books','resources','work','chat','training','passwords','payroll']
      else array['books','resources','work','chat','training','passwords'] end)
  end
  from public.staff_accounts s where s.user_id = auth.uid() and s.active
$function$;

-- read what payroll is made of (writes stay with HR and admins)
drop policy if exists "payroll read" on public.hr_staff;
create policy "payroll read" on public.hr_staff for select to authenticated using (agency_id = current_agency_id() and staff_can('payroll'));
drop policy if exists "payroll read" on public.hr_punches;
create policy "payroll read" on public.hr_punches for select to authenticated using (agency_id = current_agency_id() and staff_can('payroll'));
drop policy if exists "payroll read" on public.sdr_transfers;
create policy "payroll read" on public.sdr_transfers for select to authenticated using (agency_id = current_agency_id() and staff_can('payroll'));
drop policy if exists "payroll read" on public.sdr_pay_periods;
create policy "payroll read" on public.sdr_pay_periods for select to authenticated using (agency_id = current_agency_id() and staff_can('payroll'));

-- payroll files: kept as documents (category 'payroll', admin_only) under <agency>/payroll/<from>_<to>/
drop policy if exists "payroll read" on public.documents;
create policy "payroll read" on public.documents for select to authenticated
  using (agency_id = current_agency_id() and category = 'payroll' and staff_can('payroll'));
drop policy if exists "payroll insert" on public.documents;
create policy "payroll insert" on public.documents for insert to authenticated
  with check (agency_id = current_agency_id() and category = 'payroll' and admin_only and staff_can('payroll')
    and storage_path like current_agency_id()::text || '/payroll/%');
drop policy if exists "payroll upload" on storage.objects;
create policy "payroll upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and staff_can('payroll') and name like current_agency_id()::text || '/payroll/%');
