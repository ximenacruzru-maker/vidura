-- Client portal, Star Petrol layout: the policy card shows the invoice number and payment status, and the agency can
-- set how carrier totals are grouped (with the producer for each group) in book_accounts.data.portal, e.g.
-- {"groups": [{"label": "USG (Penn-Star / Century Surety)", "carriers": ["Penn-Star", "Century Surety"], "producer": "Joe Lopez"}, ...]}.
-- Still client-safe only: internal notes and the finance remarks are never sent.
create or replace function public.client_portal(p_account text default null) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare ag uuid; ids text[]; viewer jsonb;
begin
  if p_account is not null then
    if not coalesce(public.staff_can('books'), false) then return null; end if;
    ag := public.current_agency_id();
    if not exists (select 1 from public.book_accounts where agency_id = ag and id = p_account) then return null; end if;
    ids := array[p_account];
    viewer := jsonb_build_object('preview', true, 'display_name', (select contact from public.book_accounts where agency_id = ag and id = p_account), 'must_change_password', false);
  else
    select c.agency_id, c.account_ids, jsonb_build_object('preview', false, 'display_name', c.display_name, 'email', c.email, 'must_change_password', c.must_change_password)
      into ag, ids, viewer from public.client_logins c where c.user_id = auth.uid() and c.active;
    if ag is null then return null; end if;
  end if;
  return jsonb_build_object(
    'viewer', viewer,
    'agency', (select jsonb_build_object('name', name, 'short_name', short_name) from public.agencies where id = ag),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'dba', a.dba, 'contact', a.contact, 'phone', a.phone, 'address', a.address,
        'portal', case when jsonb_typeof(a.data->'portal') = 'object' then a.data->'portal' else null end,
        'locations', coalesce((select jsonb_agg(jsonb_build_object('id', l->>'id', 'name', l->>'name', 'address', l->>'address'))
                               from jsonb_array_elements(case when jsonb_typeof(a.data->'locations') = 'array' then a.data->'locations' else '[]'::jsonb end) l), '[]'::jsonb))
        order by a.name) from public.book_accounts a where a.agency_id = ag and a.id = any(ids)), '[]'::jsonb),
    'policies', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'account_id', p.account_id, 'policy_number', p.policy_number, 'insured', p.insured,
        'carrier', p.carrier, 'product', p.product, 'effective', p.effective, 'expiration', p.expiration, 'premium', p.premium, 'status', p.status,
        'location', p.location, 'location_id', p.data->>'locationId', 'location_name', p.data->>'locationName', 'location_address', p.data->>'locationAddress',
        'coverage', p.data->>'coverageType', 'amount_due_now', p.data->'amountDueNow', 'financed', (p.data->>'finance') is not null or p.status ilike '%financ%',
        'payment_due', p.data->>'paymentDue', 'payment_plan', p.data->>'paymentPlan', 'payment_method', p.data->>'paymentMethod',
        'invoice_number', nullif(nullif(trim(p.data->>'invoiceNumber'), '—'), ''), 'payment_status', p.data->>'paymentStatus', 'updated_at', p.updated_at)
        order by p.expiration nulls last) from public.book_policies p where p.agency_id = ag and p.account_id = any(ids)), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'category', d.category, 'account_id', d.account_id, 'policy_number', d.policy_number,
        'title', d.title, 'file_name', d.file_name, 'mime', d.mime, 'storage_path', d.storage_path, 'size_bytes', d.size_bytes, 'created_at', d.created_at)
        order by d.created_at desc) from public.documents d where d.agency_id = ag and d.account_id = any(ids) and d.uploaded and not d.admin_only), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'account_id', i.account_id, 'kind', i.kind, 'title', i.title, 'detail', i.detail,
        'due_on', i.due_on, 'status', i.status, 'created_at', i.created_at, 'updated_at', i.updated_at, 'done_at', i.done_at)
        order by i.status, i.due_on nulls last, i.created_at desc) from public.client_items i where i.agency_id = ag and i.account_id = any(ids)), '[]'::jsonb),
    'updated_at', greatest(
      (select max(updated_at) from public.book_policies where agency_id = ag and account_id = any(ids)),
      (select max(updated_at) from public.book_accounts where agency_id = ag and id = any(ids)),
      (select max(updated_at) from public.client_items where agency_id = ag and account_id = any(ids)),
      (select max(created_at) from public.documents where agency_id = ag and account_id = any(ids) and uploaded and not admin_only))
  );
end $$;
revoke execute on function public.client_portal(text) from anon;
