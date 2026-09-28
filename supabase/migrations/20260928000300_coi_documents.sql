-- Certificates made in the COI generator are saved to the client's profile (Documents, category "coi"). Anyone on
-- staff can issue a certificate, so anyone on staff may file one — only a certificate, only under the agency's own
-- coi/ folder; every other document stays admin-only to add or change.
drop policy if exists "staff insert coi" on public.documents;
create policy "staff insert coi" on public.documents for insert to authenticated
  with check (agency_id = current_agency_id() and current_staff_role() is not null and category = 'coi'
    and storage_path like current_agency_id()::text || '/coi/%');

drop policy if exists "staff upload coi" on storage.objects;
create policy "staff upload coi" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and current_staff_role() is not null and name like current_agency_id()::text || '/coi/%');
