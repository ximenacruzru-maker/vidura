-- Platform administration: who may create agencies, and what a brand-new agency starts with.
--
-- platform_admins lists the people who run Declara itself (not an agency's owners). They see the Agencies page and
-- can create an agency with its owner login through the platform-admin edge function. Rows are added with SQL only.
--
-- agency_seed(agency, owner name) gives a new agency the standard screen configuration (copied from the reference
-- agency, with its name swapped for the new one's) and empty, correctly shaped report data, so every screen opens
-- cleanly before the agency has any sales. It refuses an agency that already has settings.

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
drop policy if exists "platform admins see their own row" on public.platform_admins;
create policy "platform admins see their own row" on public.platform_admins for select to authenticated using (user_id = auth.uid());

insert into public.platform_admins (user_id)
select id from auth.users where email = 'admin@ironwoodinsuranceagency.com'
on conflict do nothing;

create or replace function public.agency_seed(p_agency uuid, p_owner text)
 returns integer language plpgsql security definer set search_path to public
as $fn$
declare
  v_name text; v_short text; ref uuid; today date := (now() at time zone 'America/Los_Angeles')::date;
  mdy constant text := 'MM/DD/YYYY'; first text := split_part(coalesce(nullif(trim(p_owner), ''), 'Owner'), ' ', 1); n int;
begin
  select name, coalesce(nullif(short_name, ''), name) into v_name, v_short from agencies where id = p_agency;
  if v_name is null then raise exception 'agency_seed: unknown agency %', p_agency; end if;
  if exists (select 1 from reference_data where agency_id = p_agency) then raise exception 'agency_seed: % already has settings', v_name; end if;
  select id into ref from agencies where slug = 'ironwood';

  -- Screen configuration that is the same for every agency, with the reference agency's name swapped for this one's
  insert into reference_data (agency_id, key, data, admin_only)
  select p_agency, r.key, replace(replace(r.data::text, 'Ironwood Insurance Agency', v_name), 'Ironwood', v_short)::jsonb, r.admin_only
  from reference_data r
  where r.agency_id = ref and r.key in ('lg:ACCESS','lg:AI_TYPE_LABEL','lg:ANNUAL_PERIODS','lg:ANNUAL_SECTIONS','lg:AUTO_2026','lg:AZ','lg:AZ_FIELDS','lg:BKT',
    'lg:BOOK_NAME','lg:BOOK_TAB','lg:CHART','lg:CHAT_CHANNELS','lg:COMM_METRICS','lg:COMPLIANCE_2026','lg:DASH_DEF_KEY','lg:DASH_SOURCE','lg:DASH_TONE',
    'lg:DIALERS','lg:DOC_BOOK_LABEL','lg:DOC_TYPE_LABEL','lg:EXEC_PROD_WINDOWS','lg:FARMERS_BI','lg:FARMERS_KB','lg:FONTS','lg:FORESIGHT_PAID_DEFAULTS',
    'lg:FORESIGHT_PLANS','lg:HR_TABS','lg:HUD_TABS','lg:INTEGRATIONS','lg:LEGAL_CATS','lg:MAIL','lg:MARKETS','lg:METRIC_DEFS','lg:METRIC_ICON','lg:METRIC_ORDER',
    'lg:METRIC_TONE','lg:PERIODS','lg:RB_LINES','lg:REIMB_POLICY','lg:REP_BOOKS','lg:REPORT_TABS','lg:ROLE_NAV','lg:SALES_PERIODS','lg:STATUS_LABEL',
    'lg:SUB_PLANS','lg:SYSTEMS','lg:TENURE_BANDS','lg:TERMS_TEXT','lg:THEMES','lg:WORK_STATUSES','lg:S',
    'farmers_bi','farmers_kb','fu_modules','markets','systems');
  update reference_data set data = jsonb_set(data, '{client}', 'null') where agency_id = p_agency and key = 'lg:S' and data ? 'client';
  -- The forms list without links to the reference agency's own uploaded documents
  insert into reference_data (agency_id, key, data, admin_only)
  select p_agency, r.key, coalesce((select jsonb_agg(e - 'document_id' - 'uri' - 'file') from jsonb_array_elements(r.data) e), '[]'::jsonb), r.admin_only
  from reference_data r where r.agency_id = ref and r.key in ('resources', 'lg:RESOURCES');

  -- Report data: empty, in the shapes the screens read
  insert into reference_data (agency_id, key, data, admin_only) values
    (p_agency, 'lg:WB_DATA', '{"folio": {}, "commissionsByFolio": {}}', true),
    (p_agency, 'lg:AZ_REPORTS', '{}', true),
    (p_agency, 'lg:HUD', jsonb_build_object(
      'asOf', to_char(today, mdy), 'weekLabel', 'Week ' || to_char(today, 'MM/DD/YY'), 'todoDate', to_char(today, mdy), 'todoPrevDate', to_char(today - 1, mdy),
      'folioLabel', '', 'lastLabel', '', 'folioPct', '0', 'lastPct', '0', 'folioTop', '[]'::jsonb, 'lastTop', '[]'::jsonb,
      'folioAll', '[]'::jsonb, 'folioFarmers', '[]'::jsonb, 'lastAll', '[]'::jsonb, 'lastFarmers', '[]'::jsonb, 'pace', '[]'::jsonb, 'paceRank', '[]'::jsonb,
      'agency', '[]'::jsonb, 'agencyNotes', '[]'::jsonb,
      'indivCols', jsonb_build_array('DIALS ( OUTBOUND )', 'INBOUND', 'TALKTIME', 'CONTACTS', 'Opps', 'Xfers', 'QUOTED', 'QUOTED AMOUNT $', 'BINDS', 'LIFE', 'PREMIUM'),
      'indivDay', '[]'::jsonb, 'indivWeek', '[]'::jsonb, 'todo', '[]'::jsonb, 'todoDone', 0, 'aggAll', 0, 'aggDone', 0, 'aggOpen', 0,
      'agg', '[]'::jsonb, 'aggAllRows', '[]'::jsonb, 'aggByWho', '[]'::jsonb, 'xferLog', '[]'::jsonb, 'sdr', '[]'::jsonb, 'sdrTotal', 0, 'xferTotal', 0,
      'xferCounts', '[]'::jsonb, 'xferOutcomes', '[]'::jsonb, 'sdrBySdr', '[]'::jsonb, 'sdrByProd', '[]'::jsonb, 'sdrByOut', '[]'::jsonb,
      'sdrLists', jsonb_build_object('sdr', '[]'::jsonb, 'action', jsonb_build_array('Appointment', 'In Process', 'Quoted', 'Resolved'),
        'result', jsonb_build_array('Sold', 'Dead', 'In Process', 'Resolved'), 'category', jsonb_build_array('Service', 'Transfer'), 'producer', '[]'::jsonb),
      'xferFilter', jsonb_build_object('sdrs', '[]'::jsonb, 'action', '', 'outcome', '', 'category', 'Transfer', 'producers', '[]'::jsonb),
      'xferWindow', jsonb_build_array(to_char(today - 30, mdy), to_char(today, mdy)), 'quotesSource', ''), true),
    (p_agency, 'lg:WB_EXTRA', jsonb_build_object('daily', '{}'::jsonb,
      'quotes', jsonb_build_object('byDay', '{}'::jsonb, 'definition', 'Open quoted leads with a quoted premium', 'note', '', 'pulledAt', ''),
      'sdr', jsonb_build_object('activeSdrs', '[]'::jsonb, 'tags', '{}'::jsonb, 'qualifiedTransferBonus', 0, 'boundPolicyBonus', 0, 'rule', '',
        'pulledAt', '', 'byMonth', '{}'::jsonb, 'transfers', '[]'::jsonb)), true),
    (p_agency, 'lg:COMM_SEED', jsonb_build_object('id', 'plan-default', 'name', 'Producer plan', 'version', 1, 'status', 'active', 'effectiveFrom', to_char(today, 'YYYY-MM-DD'),
      'effectiveTo', null, 'createdAt', to_char(today, 'YYYY-MM-DD'), 'flags', '[]'::jsonb, 'exceptions', '[]'::jsonb, 'source', jsonb_build_object('kind', 'manual', 'fileName', ''),
      'tierBasis', 'totalPremium',
      'tiers', jsonb_build_array(jsonb_build_object('min', 0, 'rate', 0.04), jsonb_build_object('min', 18000, 'rate', 0.06), jsonb_build_object('min', 32000, 'rate', 0.08)),
      'qualification', jsonb_build_object('groups', '[]'::jsonb),
      'buckets', jsonb_build_array(jsonb_build_object('key', 'all', 'label', 'All premium', 'carriers', '[]'::jsonb, 'lines', '[]'::jsonb, 'rateType', 'tier',
        'multiplier', 1, 'requiresQualify', false, 'isDefault', true)),
      'bonuses', '[]'::jsonb, 'lifeRules', '[]'::jsonb, 'splits', jsonb_build_object('defaultShare', 1, 'rules', '[]'::jsonb),
      'notes', 'Starter plan — replace it with the agency''s own comp plan.'), true),
    (p_agency, 'lg:GOALS', jsonb_build_object('premium', 0, 'policies', 0, 'newClients', 0), true),
    (p_agency, 'lg:OWNER_IDENTITY', jsonb_build_object('name', coalesce(nullif(trim(p_owner), ''), 'Owner'), 'first', first, 'role', 'Agency owner'), true),
    (p_agency, 'lg:SIGNED_IN', jsonb_build_object('name', coalesce(nullif(trim(p_owner), ''), 'Owner'), 'first', first, 'role', 'Agency owner'), true),
    (p_agency, 'lg:SETTINGS', jsonb_build_object('theme', 'talavera', 'font', 'inter', 'producers', '[]'::jsonb), true),
    (p_agency, 'lg:HR_STAFF', '[]', true), (p_agency, 'lg:HR_PUNCHES', '{}', true), (p_agency, 'lg:LICENSES', '[]', true),
    (p_agency, 'lg:DATA', '{"farmers": [], "commercial": []}', true), (p_agency, 'lg:CB_BINDERS', '[]', true), (p_agency, 'lg:RB', '[]', true),
    (p_agency, 'lg:CB_OWNER', 'null', true), (p_agency, 'lg:FARMERS_DECS', '{}', true), (p_agency, 'lg:RETAIL_DOCS', '{}', true),
    (p_agency, 'lg:COMM_RESULTS', '{}', true), (p_agency, 'lg:LIVE_FOLIO_ROWS', '{}', true), (p_agency, 'lg:HR_EDITS', '{}', true), (p_agency, 'lg:HR_SYNC', '{}', true),
    (p_agency, 'lg:AI_LOG', '[]', true), (p_agency, 'lg:AI_CTX', '{"client": null}', true),
    (p_agency, 'lg:AI_CHIPS', jsonb_build_array('Which renewals are due in the next 30 days?', 'Who is our top producer this folio?', 'How much premium have we written this month?',
      'Which lead source brings the most premium?', 'What quotes are still open from last week?', 'Show commercial accounts renewing soon',
      'How are we pacing against the folio goal?', 'Which policies are past expiration?'), true),
    (p_agency, 'lg:COI_DEFAULTS', jsonb_build_object('holder', '', 'holderAddr', '', 'ops', '', 'glEach', '1,000,000', 'glAgg', '2,000,000', 'glMed', '5,000',
      'glPersonal', '1,000,000', 'glProducts', '2,000,000', 'glRented', '100,000', 'elAccident', '1,000,000', 'elDisease', '1,000,000', 'elEmployee', '1,000,000',
      'wcCarrier', '', 'wcPolicy', '', 'wcStart', '', 'wcEnd', '', 'addlInsured', false, 'primary', false, 'waiver', false), true);
  insert into reference_data (agency_id, key, data, admin_only)
  select p_agency, k, jsonb_build_object('mentor', '', 'folioDate', '', 'reportDate', to_char(today, mdy), 'idealTrait', '', 'monthGoals', '[]'::jsonb, 'people', '[]'::jsonb), false
  from unnest(array['protege', 'lg:PROTEGE']) k;
  insert into reference_data (agency_id, key, data, admin_only)
  select p_agency, k, jsonb_build_object('source', 'Farmers University',
      'courses', coalesce((select r.data -> 'courses' from reference_data r where r.agency_id = ref and r.key = 'protege_training'), '[]'::jsonb), 'byPerson', '{}'::jsonb), false
  from unnest(array['protege_training', 'lg:PROTEGE_TRAINING']) k;

  select count(*) into n from reference_data where agency_id = p_agency;
  return n;
end $fn$;

revoke execute on function public.agency_seed(uuid, text) from public, anon, authenticated;
