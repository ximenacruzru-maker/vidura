-- Everyone on staff can view the Executive Dashboard and the Daily Huddle Report (the agency's sales, quotes, calls and
-- client-success numbers). Reports (commissions, payroll, everyone's pay) stays owner/admin only.
--
-- Who "everyone" is: active staff, except a new hire (training only) and anyone set to "My Commissions only".
--
-- What they can now read:
--  * the agency's sales (daily_sales), quotes (quote_leads), phone activity (ricochet_*) and the retention team's day
--    (retention_days, retention_log, renewal_reviews). They can't add, change or delete anything new.
--  * the dashboard's saved reference data through perf_refs(), a fixed list of keys with the pay parts removed:
--    the commission plan (COMM_SEED), commission results, folio commission rows, each folio's commissions by producer
--    (WB_DATA.commissionsByFolio) and the SDR bonus rates and monthly bonus totals (WB_EXTRA.sdr) never leave the database.

create or replace function public.staff_sees_numbers() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select s.role in ('owner', 'admin')
        or (s.role <> 'new_hire' and coalesce((s.access ->> 'commissions_only')::boolean, false) = false)
    from public.staff_accounts s
    where s.user_id = auth.uid() and s.active and s.agency_id = public.current_agency_id()
    limit 1), false)
$$;
revoke execute on function public.staff_sees_numbers() from public, anon;
grant execute on function public.staff_sees_numbers() to authenticated;

create or replace function public.perf_refs(p_keys text[]) returns table (key text, data jsonb)
language sql stable security definer set search_path = public as $$
  select r.key,
    case r.key
      when 'lg:WB_DATA' then r.data - 'commissionsByFolio'
      when 'lg:WB_EXTRA' then case when r.data ? 'sdr'
        then jsonb_set(r.data, '{sdr}', (r.data -> 'sdr') - 'byMonth' - 'rule' - 'boundPolicyBonus' - 'qualifiedTransferBonus')
        else r.data end
      else r.data
    end
  from public.reference_data r
  where r.agency_id = public.current_agency_id()
    and public.staff_sees_numbers()
    and r.key = any (
      select 'lg:' || k from unnest(p_keys) k
      where k = any (array['FARMERS_DECS', 'RETAIL_DOCS', 'RB_LINES', 'CHART', 'BOOK_TAB', 'BOOK_NAME', 'GOALS', 'PERIODS',
        'SALES_PERIODS', 'EXEC_PROD_WINDOWS', 'WB_DATA', 'WB_EXTRA', 'AZ_REPORTS', 'METRIC_DEFS', 'DASH_DEF_KEY', 'THEMES',
        'FONTS', 'REPORT_TABS', 'METRIC_ORDER', 'METRIC_ICON', 'METRIC_TONE', 'REP_BOOKS', 'DASH_TONE', 'DASH_SOURCE',
        'LIFE_PROMO', 'DATA', 'CB_BINDERS', 'RB']))
$$;
revoke execute on function public.perf_refs(text[]) from public, anon;
grant execute on function public.perf_refs(text[]) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['daily_sales', 'quote_leads', 'ricochet_calls', 'ricochet_texts', 'ricochet_voicemails',
    'retention_days', 'retention_log', 'renewal_reviews'] loop
    execute format('drop policy if exists "staff read numbers" on public.%I', t);
    execute format('create policy "staff read numbers" on public.%I for select to authenticated using (agency_id = public.current_agency_id() and public.staff_sees_numbers())', t);
  end loop;
end $$;
