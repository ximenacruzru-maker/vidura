-- Demo agency: Northwind Insurance Group, an entirely made-up agency for showing Declara to prospects.
--
-- public.demo_reset('northwind') wipes and regenerates every row of a demo agency (is_demo = true; it
-- refuses any other agency), with dates relative to today, so the demo is always "live" up to the day
-- it is reset. Nothing is copied from another agency except app configuration that is the same for
-- every agency (screen labels, metric definitions, the Farmers course catalogue, carrier market
-- guides), with any agency name in it replaced.
--
-- The demo login (staff_accounts row) is created separately; demo_reset leaves logins alone.

insert into public.agencies (slug, name, short_name, is_demo, agencyzoom_sync, history_cutoff)
values ('northwind', 'Northwind Insurance Group', 'Northwind', true, false, null)
on conflict (slug) do nothing;

create or replace function public.demo_reset(p_slug text default 'northwind', p_seed double precision default 0.4271)
 returns jsonb language plpgsql security definer set search_path to public, extensions
as $fn$
#variable_conflict use_column
declare
  v_ag uuid; iw uuid; today date := (now() at time zone 'America/Los_Angeles')::date;
  d date; n int; i int; j int; k int; seq int := 0; cust int := 0; lam numeric; g numeric;
  p record; l record; s record; f record; fcur record;
  v_client text; v_cid text; v_comm boolean; v_src text; v_line text; v_npol int; v_prem numeric;
  first_names text[] := array['James','Maria','Robert','Linda','Michael','Patricia','David','Jennifer','Daniel','Elizabeth','Carlos','Sofia',
    'Kevin','Nancy','Brian','Karen','Luis','Angela','Steven','Michelle','Andrew','Rachel','Joshua','Samantha','Eric','Megan','Jose','Hannah',
    'Ryan','Olivia','Tyler','Grace','Nathan','Chloe','Aaron','Vanessa','Marcus','Diana','Kyle','Rosa','Victor','Tiffany','Gregory','Monica',
    'Hector','Lauren','Trevor','Erin','Omar','Julia','Wesley','Paula','Derrick','Irene','Colin','Natalie','Rafael','Kimberly','Scott','Yolanda',
    'Ian','Priscilla','Gavin','Teresa','Dennis','Leah','Martin','Adriana','Keith','Bianca','Howard','Lucia','Simon','Heather','Arturo','Joanne'];
  last_names text[] := array['Abernathy','Blackwell','Castellanos','Drummond','Espinoza','Fairbanks','Gutierrez','Hensley','Ingram','Jaramillo',
    'Kendrick','Langford','McAllister','Nakamura','Ortega','Prescott','Rasmussen','Salazar','Tanaka','Valdez','Winslow','Yoder','Aguilar',
    'Calloway','Dunleavy','Emerson','Figueroa','Galloway','Hartwell','Ibarra','Jacobsen','Kaplan','Lozano','Merritt','Norwood','Oyelaran',
    'Pacheco','Redmond','Stroud','Tillman','Ulrich','Villanueva','Weatherby','Bennett','Carver','Delgado','Ellison','Fischer','Garrison',
    'Holloway','Iverson','Jennings','Kowalski','Lindqvist','Maldonado','Navarro','Okafor','Pemberton','Quintero','Ramsey','Sandoval','Thornton',
    'Underwood','Vasquez','Whitaker','Yamamoto','Zeller','Achterberg','Bosworth','Cardenas','Dabrowski','Eastwood','Fontaine','Greer','Halvorsen'];
  biz_a text[] := array['Ridgeline','Harbor Point','Summit','Oak Hollow','Bluewater','Cedar Lane','Granite Peak','Silver Creek','Maple Row',
    'Copperleaf','Northgate','Red Canyon','Juniper','Lakeview','Sierra Vista','Pinecrest','Westbrook','Sunrise','Foothill','Riverbend',
    'Canyon Oak','Delta Breeze','American River','Old Town','Capitol','Brightwater','Stonebridge','Willow Creek'];
  biz_b text[] := array['Auto Body','Landscaping','Bakery','Dental Group','Plumbing & Heating','Electric','Coffee Roasters','Fitness','Veterinary Clinic',
    'Hardware','Construction','Cleaning Services','Tire & Brake','Florist','Print Shop','Cabinetry','Painting','Roofing','HVAC Services','Deli',
    'Glass & Mirror','Tile & Stone','Pet Grooming','Tutoring Center','Martial Arts','Brewing','Upholstery','Concrete'];
  cities text[] := array['Sacramento|958','Elk Grove|957','Roseville|956','Folsom|956','Davis|956','Rancho Cordova|956','Citrus Heights|956','Woodland|956','Carmichael|956','West Sacramento|956'];
  streets text[] := array['Oak Ave','J St','Florin Rd','Sunrise Blvd','Madison Ave','Fair Oaks Blvd','Douglas Blvd','Folsom Blvd','Elk Grove Blvd','Main St','Watt Ave','Howe Ave','Riverside Blvd','Greenback Ln'];
  folio_starts date[] := array['2024-12-19','2025-01-21','2025-02-19','2025-03-19','2025-04-18','2025-05-20','2025-06-19','2025-07-18','2025-08-20','2025-09-19',
    '2025-10-21','2025-11-19','2025-12-19','2026-01-21','2026-02-19','2026-03-19','2026-04-18','2026-05-20','2026-06-19','2026-07-18','2026-08-20','2026-09-21',
    '2026-10-21','2026-11-19','2026-12-18','2027-01-21','2027-02-19','2027-03-19','2027-04-19','2027-05-20','2027-06-18','2027-07-20','2027-08-19','2027-09-20']::date[];
  first_folio date := '2025-12-19';
  cutoff date; wb jsonb; azr jsonb; hud jsonb; plan jsonb; out jsonb := '{}';
  mdy constant text := 'MM/DD/YYYY';
begin
  select id into v_ag from public.agencies where slug = p_slug and is_demo;
  if v_ag is null then raise exception 'demo_reset only runs on a demo agency (is_demo = true); % is not one', p_slug; end if;
  select id into iw from public.agencies where slug = 'ironwood';
  perform setseed(p_seed);

  -- 1. Clear the demo agency (logins, their preferences and the agency row stay) ------------------------
  -- Files someone uploads while demoing stay in storage (Supabase only lets the Storage API delete them); with the
  -- document rows gone they can't be read by anyone.
  delete from public.agency_login_log where agency_id = v_ag;  delete from public.agency_login_secrets where agency_id = v_ag;
  delete from public.agency_logins where agency_id = v_ag;      delete from public.licenses where agency_id = v_ag;
  delete from public.documents where agency_id = v_ag;          delete from public.book_policies where agency_id = v_ag;
  delete from public.book_accounts where agency_id = v_ag;      delete from public.checklist_ticks where agency_id = v_ag;
  delete from public.checklist_items where agency_id = v_ag;    delete from public.chat_messages where agency_id = v_ag;
  delete from public.folio_line_items where agency_id = v_ag;   delete from public.commission_folios where agency_id = v_ag;
  delete from public.comp_plans where agency_id = v_ag;         delete from public.daily_sales where agency_id = v_ag;
  delete from public.force_refresh_log where agency_id = v_ag;  delete from public.hr_punches where agency_id = v_ag;
  delete from public.hr_staff where agency_id = v_ag;           delete from public.lead_spend where agency_id = v_ag;
  delete from public.producers where agency_id = v_ag;          delete from public.quote_leads where agency_id = v_ag;
  delete from public.reference_data where agency_id = v_ag;     delete from public.sales_history where agency_id = v_ag;
  delete from public.sdr_config where agency_id = v_ag;         delete from public.sdr_pay_periods where agency_id = v_ag;
  delete from public.sdr_transfers where agency_id = v_ag;      delete from public.sync_log where agency_id = v_ag;
  delete from public.training_progress where agency_id = v_ag;  delete from public.training_status where agency_id = v_ag;
  delete from public.work_items where agency_id = v_ag;         delete from public.az_month_sales where agency_id = v_ag;

  -- 2. People, lines, lead sources, folios ---------------------------------------------------------------
  create temp table dp (name text, first text, code text, wt numeric, since date, prem_x numeric, life_x numeric, comm_x numeric, email text) on commit drop;
  insert into dp values
    ('Maya Castillo',   'Maya',   'NW101', 30, '2024-06-01', 1.12, 1.0, 1.9, 'maya.castillo@northwind-demo.test'),
    ('Derek Whitfield', 'Derek',  'NW102', 24, '2024-06-01', 1.00, 0.8, 1.2, 'derek.whitfield@northwind-demo.test'),
    ('Priya Nair',      'Priya',  'NW103', 20, '2024-09-01', 1.05, 3.2, 0.7, 'priya.nair@northwind-demo.test'),
    ('Tom Brennan',     'Tom',    'NW104', 15, '2025-02-01', 0.93, 1.0, 0.8, 'tom.brennan@northwind-demo.test'),
    ('Alicia Moreno',   'Alicia', 'NW105', 11, '2026-02-02', 0.86, 1.4, 0.4, 'alicia.moreno@northwind-demo.test');
  create temp table dl (line text, carrier text, wt numeric, lo numeric, hi numeric, comm boolean, bundle text) on commit drop;
  insert into dl values
    ('Standard Auto','Farmers',22,780,2650,false,'Homeowners'), ('Homeowners','Farmers',14,1150,3900,false,'Standard Auto'),
    ('Renters','Farmers',7,138,335,false,'Standard Auto'),      ('Umbrella','Farmers',4,265,690,false,null),
    ('Condo','Farmers',3,310,980,false,'Standard Auto'),        ('Landlord','Foremost',4,640,1820,false,null),
    ('Mobile Home','Foremost',2,590,1480,false,null),           ('Motorcycle','Foremost Star',3,170,640,false,null),
    ('Life','Farmers New World Life',5,420,2350,false,null),    ('Home','Safeco',5,1250,4100,false,'Standard Auto'),
    ('Standard Auto','Progressive',7,910,3050,false,null),      ('Standard Auto','Bristol West',3,1180,3350,false,null),
    ('Home','Pacific Specialty',3,1380,3700,false,null),        ('Earthquake','GeoVera',1.5,690,2400,false,null),
    ('Commercial BOP Liability','Farmers',3,1450,7800,true,null), ('Workers Comp','Farmers',1.5,1900,12600,true,null),
    ('Commercial Auto','Farmers',1.5,2300,9800,true,null),      ('General Liability','Kinsale',1.2,1100,8200,true,null),
    ('Professional Liability','Hiscox',1,780,3900,true,null),   ('Commercial BOP Liability','Travelers',1.2,1600,8900,true,null);
  create temp table dsrc (src text, wt numeric, monthly numeric) on commit drop;
  insert into dsrc values ('EverQuote',17,2386.40), ('QuoteWizard',11,1642.75), ('Google Ads',15,1215.00), ('SmartFinancial',6,1488.20),
    ('Farmers.com',6,395.00), ('Referral',17,null), ('Call-in',10,null), ('Cross-sell',13,null), ('Walk-in',5,null);
  create temp table df (fk date, fend date, label text, in_progress boolean) on commit drop;
  insert into df select u.st, lead(u.st) over (order by u.st) - 1, null, false from unnest(folio_starts) u(st);
  delete from df where fk > today or fend is null;
  update df set in_progress = (today between fk and fend);
  update df set label = case when extract(year from fk) = extract(year from fend) then to_char(fk, 'Mon FMDD') || ' – ' || to_char(fend, 'Mon FMDD, YYYY')
                             else to_char(fk, 'Mon FMDD, YYYY') || ' – ' || to_char(fend, 'Mon FMDD, YYYY') end;
  select * into fcur from df where in_progress;
  cutoff := fcur.fk - 1;
  update public.agencies set history_cutoff = cutoff where id = v_ag;

  -- 3. Sales: every sold policy from Jan 2025 to today ----------------------------------------------------
  create temp table dsale (seq int, d date, producer text, client text, cid text, line text, carrier text, premium numeric, lead_source text, comm boolean) on commit drop;
  d := '2025-01-02';
  while d <= today loop
    lam := case extract(isodow from d) when 1 then 1.55 when 2 then 2.25 when 3 then 2.05 when 4 then 1.85 when 5 then 1.2 when 6 then 0.3 else 0.04 end;
    if to_char(d, 'MM-DD') between '12-24' and '12-31' or to_char(d, 'MM-DD') in ('01-01', '07-04', '11-26', '11-27', '05-25', '09-07') then lam := lam * 0.25; end if;
    g := 0.80 + 0.42 * (d - date '2025-01-01')::numeric / greatest(today - date '2025-01-01', 1);
    n := floor(lam * g * (0.55 + random()::numeric * 0.9) + random()::numeric);
    for i in 1..n loop
      cust := cust + 1; v_cid := 'nw-c' || lpad(cust::text, 5, '0');
      select * into p from dp where since <= d order by -ln(random()::numeric) / wt limit 1;
      select src into v_src from dsrc order by -ln(random()::numeric) / wt limit 1;
      v_comm := random()::numeric < 0.075 * p.comm_x;
      v_client := case when v_comm then biz_a[1 + floor(random()::numeric * array_length(biz_a, 1))] || ' ' || biz_b[1 + floor(random()::numeric * array_length(biz_b, 1))]
                    || (array['', ' LLC', ' Inc', ''])[1 + floor(random()::numeric * 4)]
                  else first_names[1 + floor(random()::numeric * array_length(first_names, 1))] || ' ' || last_names[1 + floor(random()::numeric * array_length(last_names, 1))] end;
      v_npol := case when v_src = 'Cross-sell' then 1 when v_comm then 1 + (random()::numeric < 0.3)::int else (array[1,1,1,1,1,1,2,2,2,3])[1 + floor(random()::numeric * 10)] end;
      v_line := null;
      for j in 1..v_npol loop
        if j = 1 then
          select * into l from dl where comm = v_comm order by -ln(random()::numeric) / (wt * case when line = 'Life' then p.life_x else 1 end) limit 1;
        elsif l.bundle is not null and random()::numeric < 0.75 then
          select * into l from dl x where x.line = l.bundle order by -ln(random()::numeric) / x.wt limit 1;
        else
          select * into l from dl where comm = v_comm and line not in (select line from dsale where cid = v_cid) order by -ln(random()::numeric) / wt limit 1;
        end if;
        exit when l is null;
        v_prem := (l.lo + (l.hi - l.lo) * power(random()::numeric, 1.6)) * p.prem_x * 0.62;
        v_prem := round(v_prem, case when random()::numeric < 0.4 then 0 else 2 end);
        seq := seq + 1;
        insert into dsale values (seq, d, p.name, v_client, v_cid, l.line, l.carrier, v_prem, v_src, v_comm);
      end loop;
    end loop;
    d := d + 1;
  end loop;

  -- Sold before the first folio → year-over-year history; from the first folio on → the sales ledger.
  insert into public.sales_history (agency_id, az_ref, sale_date, producer, client, line, carrier, premium, customer_id)
    select v_ag, 'nw-h' || seq, d, producer, client, line, carrier, premium, cid from dsale where d < first_folio;
  insert into public.daily_sales (agency_id, sale_date, producer, client_name, premium, source, carrier, policy_type, customer_id, confirmed, az_ref, lead_source)
    select v_ag, d, producer, client, premium, case when carrier ~* 'farmers|foremost' then 'Farmers' else 'Brokered' end, carrier, line, cid, true,
      'pol-' || (7300000 + seq), lead_source from dsale where d >= first_folio;
  insert into public.commission_folios (agency_id, folio_key, generated_at, period, period_label, in_progress)
    select v_ag, fk, today, case when in_progress then to_char(fk, 'Mon FMDD, YYYY') || ' – (in progress)' else label end, 'Folio', in_progress from df where fk >= first_folio;
  insert into public.folio_line_items (agency_id, folio_key, client, when_date, line, carrier, producer, premium)
    select v_ag, f2.fk, x.client, x.d, x.line, x.carrier, x.producer, x.premium from dsale x join df f2 on x.d between f2.fk and f2.fend
    where f2.fk >= first_folio and not f2.in_progress;

  -- 4. Lead spend by month for the paid sources ----------------------------------------------------------
  insert into public.lead_spend (agency_id, source, period_start, period_end, amount, notes)
    select v_ag, s2.src, m::date, (m + interval '1 month - 1 day')::date,
      round(s2.monthly * (0.88 + random()::numeric * 0.24) * (0.85 + 0.3 * (m::date - date '2025-01-01') / 640.0), 2), 'Monthly invoice'
    from dsrc s2 cross join generate_series(date '2025-01-01', date_trunc('month', today::timestamp), interval '1 month') m where s2.monthly is not null;

  -- 5. Open quotes (last ~11 weeks) -----------------------------------------------------------------------
  d := today - 76;
  while d <= today loop
    lam := case extract(isodow from d) when 1 then 2.4 when 2 then 3.0 when 3 then 2.8 when 4 then 2.6 when 5 then 1.7 when 6 then 0.4 else 0 end;
    n := floor(lam * (0.6 + random()::numeric * 0.8) + random()::numeric);
    for i in 1..n loop
      seq := seq + 1;
      select * into p from dp where since <= d order by -ln(random()::numeric) / wt limit 1;
      select src into v_src from dsrc where src <> 'Cross-sell' order by -ln(random()::numeric) / wt limit 1;
      select * into l from dl where not comm or random()::numeric < 0.2 order by -ln(random()::numeric) / wt limit 1;
      k := 1 + floor(random()::numeric * 3);
      v_client := first_names[1 + floor(random()::numeric * array_length(first_names, 1))] || ' ' || last_names[1 + floor(random()::numeric * array_length(last_names, 1))];
      insert into public.quote_leads (agency_id, lead_id, name, created_date, producer, pipeline, lead_source, stage_entry, quoted_premium, sdr_tag,
        quotes, quote_count, quote_day, day_basis, lines, url, az_ref)
      select v_ag, 'nw-q' || seq, v_client, d - floor(random()::numeric * 9)::int, p.name, case when l.comm then 'Commercial Lines' else 'Personal Lines' end, v_src,
        to_char(d, mdy), sum((q->>'premium')::numeric), case when random()::numeric < 0.22 then (array['Jordan','Kelsey'])[1 + floor(random()::numeric * 2)] else '' end,
        jsonb_agg(q), count(*), d, 'quote submission', l.line, '', 'nw-q' || seq
      from (select jsonb_build_object('quoteId', 'NWQ-' || (58000 + seq * 3 + z), 'product', l.line,
              'premium', round((l.lo + (l.hi - l.lo) * power(random()::numeric, 1.4)) * (0.9 + z * 0.07), 2),
              'carrier', coalesce((select carrier from dl y where y.line = l.line order by -ln(random()::numeric) / y.wt limit 1), l.carrier),
              'submitted', to_char(d, mdy), 'sold', false) q
            from generate_series(1, k) z) qq;
    end loop;
    d := d + 1;
  end loop;

  -- 6. SDR transfers (last 5 months) and pay periods -----------------------------------------------------
  insert into public.sdr_config (agency_id, qualified_transfer_bonus, bound_policy_bonus, rule)
  values (v_ag, 15, 35, 'SDRs are paid monthly, one month in arrears: transfers logged in a calendar month are paid on the 21st of the following month. A Qualified Transfer is a tagged lead with a real quote on it. A Bound Policy is a tagged lead that was sold.');
  d := (date_trunc('month', today::timestamp) - interval '4 months')::date;
  while d <= today loop
    if extract(isodow from d) < 6 then
      for s in select * from (values ('Jordan', 1.5), ('Kelsey', 1.2)) v(sdr, rate) loop
        n := floor(s.rate * (0.5 + random()::numeric) + random()::numeric);
        for i in 1..n loop
          seq := seq + 1;
          select * into p from dp where since <= d order by -ln(random()::numeric) / wt limit 1;
          v_prem := round(700 + power(random()::numeric, 1.3) * 3100, 2);
          insert into public.sdr_transfers (agency_id, sdr, date_time, month, lead_id, client, producer, csr, lead_source, stage, status, loss_reason,
            action, outcome, az_in_pipeline, az_tagged, az_quote_premium, quote_count, quotes, az_qualifies, bound, bound_via_ledger, bound_premium, tags, url, az_ref)
          select v_ag, s.sdr, d, to_char(d, 'YYYY-MM'), 'nw-t' || seq,
            first_names[1 + floor(random()::numeric * array_length(first_names, 1))] || ' ' || last_names[1 + floor(random()::numeric * array_length(last_names, 1))],
            p.name, '', (array['EverQuote','QuoteWizard','SmartFinancial','EverQuote','Google Ads'])[1 + floor(random()::numeric * 5)],
            case r.o when 'Sold' then 'Sold' when 'Dead' then 'Lost' else 'Quoted' end, r.o,
            case when r.o = 'Dead' then (array['Price','Went with current carrier','No response','Not eligible'])[1 + floor(random()::numeric * 4)] else '' end,
            r.o, r.o, r.o = 'Open', true, case when r.q then v_prem else 0 end, case when r.q then 1 + floor(random()::numeric * 2)::int else 0 end,
            case when r.q then jsonb_build_array(jsonb_build_object('quoteId', 'NWQ-' || (91000 + seq), 'product', 'Standard Auto', 'premium', v_prem,
              'carrier', 'Farmers', 'submitted', to_char(d, mdy), 'sold', r.o = 'Sold')) else '[]'::jsonb end,
            r.q, r.o = 'Sold', false, case when r.o = 'Sold' then v_prem else 0 end, left(s.sdr, 1), '', 'nw-t' || seq
          from (select case when x < 0.24 then 'Sold' when x < 0.52 then 'Dead' else 'Open' end o, x < 0.78 q from (select random()::numeric x) z) r;
        end loop;
      end loop;
    end if;
    d := d + 1;
  end loop;
  insert into public.sdr_pay_periods (agency_id, month, pay_date, period_label, closed, qualified_transfer_bonus, bound_policy_bonus)
    select v_ag, to_char(m, 'YYYY-MM'), (m + interval '1 month' + interval '20 days')::date, to_char(m, 'FMMonth YYYY'),
      (m + interval '1 month' + interval '20 days')::date < today, 15, 35
    from generate_series(date_trunc('month', today::timestamp) - interval '4 months', date_trunc('month', today::timestamp), interval '1 month') m;

  -- 7. Comp plan -------------------------------------------------------------------------------------------
  plan := jsonb_build_object(
    'tierBasis', 'totalPremium',
    'tiers', jsonb_build_array(jsonb_build_object('min', 0, 'rate', 0.04), jsonb_build_object('min', 18000, 'rate', 0.06), jsonb_build_object('min', 32000, 'rate', 0.08)),
    'qualification', jsonb_build_object('groups', jsonb_build_array(jsonb_build_array(jsonb_build_object('metric', 'totalPremium', 'op', '>=', 'value', 9000)),
                                                                     jsonb_build_array(jsonb_build_object('metric', 'policies', 'op', '>=', 'value', 14)))),
    'buckets', jsonb_build_array(
      jsonb_build_object('key', 'farmers', 'label', 'Farmers & Foremost', 'carriers', jsonb_build_array('Farmers', 'Foremost', 'Foremost Star', 'Farmers New World Life'), 'lines', '[]'::jsonb, 'rateType', 'tier', 'multiplier', 1, 'requiresQualify', true, 'isDefault', false),
      jsonb_build_object('key', 'fee', 'label', 'Broker fees', 'carriers', '[]'::jsonb, 'lines', jsonb_build_array('Broker Fee'), 'rateType', 'flat', 'flatRate', 0.5, 'requiresQualify', false, 'isDefault', false),
      jsonb_build_object('key', 'other', 'label', 'Brokered carriers', 'carriers', '[]'::jsonb, 'lines', '[]'::jsonb, 'rateType', 'tier', 'multiplier', 0.5, 'requiresQualify', true, 'isDefault', true)),
    'bonuses', jsonb_build_array(jsonb_build_object('key', 'accel', 'label', 'Accelerator', 'basis', 'totalPremium', 'threshold', 40000, 'rate', 0.01, 'requiresQualify', true)),
    'lifeRules', jsonb_build_array(jsonb_build_object('match', 'Life', 'weight', 1)),
    'splits', jsonb_build_object('defaultShare', 1, 'rules', '[]'::jsonb),
    'notes', 'Producer plan: tiered on each folio''s total written premium. Brokered carriers pay half the tier rate.');
  insert into public.comp_plans (agency_id, name, version, status, effective_from, plan) values (v_ag, 'Northwind producer plan', 1, 'active', '2025-01-01', plan);

  -- 8. Books of business ---------------------------------------------------------------------------------
  for i in 1..58 loop   -- Farmers commercial accounts, 1-3 policies each
    v_client := biz_a[1 + floor(random()::numeric * array_length(biz_a, 1))] || ' ' || biz_b[1 + floor(random()::numeric * array_length(biz_b, 1))] || (array['', ' LLC', ' Inc'])[1 + floor(random()::numeric * 3)];
    v_cid := 'f-nw-' || lpad(i::text, 3, '0');
    insert into public.book_accounts (agency_id, id, book, name, address, producer, data)
    values (v_ag, v_cid, 'farmers', v_client, '95' || (600 + floor(random()::numeric * 250))::text, (select name from dp order by -ln(random()::numeric) / wt limit 1),
      jsonb_build_object('aor', '71-08-' || (array['NW1','NW2','NW3'])[1 + floor(random()::numeric * 3)], 'zip', '95' || (600 + floor(random()::numeric * 250))::text));
    for j in 1..(1 + floor(random()::numeric * 2.4))::int loop
      k := (random()::numeric * 395)::int - 20;
      v_line := (array['BUSINESSOWNERS','ARTISAN CONTRACTOR','COMMERCIAL AUTO','WORKERS COMPENSATION','COMMERCIAL UMBRELLA','BUSINESSOWNERS'])[1 + floor(random()::numeric * 6)];
      v_prem := round(case v_line when 'WORKERS COMPENSATION' then 2400 + power(random()::numeric, 1.5) * 16000 when 'COMMERCIAL AUTO' then 2600 + power(random()::numeric, 1.4) * 9000
                  when 'COMMERCIAL UMBRELLA' then 480 + random()::numeric * 1400 else 1200 + power(random()::numeric, 1.5) * 8200 end, 0);
      n := 600000000 + floor(random()::numeric * 9999999)::int;
      insert into public.book_policies (agency_id, id, account_id, book, policy_number, insured, carrier, product, effective, expiration, premium, status, data)
      values (v_ag, v_cid || '-' || n, v_cid, 'farmers', n::text, v_client, 'Farmers', v_line, today + k - 365, today + k, v_prem, 'In Force',
        jsonb_build_object('id', v_cid || '-' || n, 'insured', v_client, 'renewal', to_char(today + k, mdy), 'inception', to_char(today + k - 365 * (1 + floor(random()::numeric * 4))::int, mdy),
          'productType', v_line, 'renewalTime', '12:01 AM', 'policyNumber', n::text, 'annualPremium', v_prem, 'billingAccount', 'F0' || (11000000 + floor(random()::numeric * 899999))::text));
    end loop;
    update public.book_accounts set data = data || jsonb_build_object('policyCount', (select count(*) from public.book_policies where agency_id = v_ag and account_id = v_cid),
      'totalPremium', (select sum(premium) from public.book_policies where agency_id = v_ag and account_id = v_cid)) where agency_id = v_ag and id = v_cid;
  end loop;

  -- One multi-location commercial owner
  insert into public.book_accounts (agency_id, id, book, name, dba, contact, phone, producer, data)
  values (v_ag, 'c-pinecrest', 'commercial', 'Pinecrest Hospitality Group', 'Pinecrest Inns', 'Renee Whitaker', '(916) 555-0147', 'Maya Castillo',
    jsonb_build_object('locations', jsonb_build_array(
      jsonb_build_object('id', 'pc1', 'name', 'Pinecrest Inn — Old Town', 'address', '1120 2nd St, Sacramento, CA 95814', 'hasDecSheet', false, 'alert', null),
      jsonb_build_object('id', 'pc2', 'name', 'Pinecrest Inn — Folsom', 'address', '405 Riley St, Folsom, CA 95630', 'hasDecSheet', false, 'alert', null),
      jsonb_build_object('id', 'pc3', 'name', 'Pinecrest Suites — Roseville', 'address', '2210 Eureka Rd, Roseville, CA 95661', 'hasDecSheet', false, 'alert', null))));
  insert into public.book_policies (agency_id, id, account_id, book, policy_number, insured, carrier, product, effective, expiration, premium, status, location, data)
  select v_ag, 'c-' || x.loc || '-' || lower(x.kind), 'c-pinecrest', 'commercial', x.pol, x.lname, x.carrier, x.kind, today + x.days - 365, today + x.days, x.prem, 'PAID IN FULL',
    x.lname || ' · ' || x.addr,
    jsonb_build_object('id', x.loc || '-' || lower(x.kind), 'kind', x.kind, 'carrier', x.carrier, 'effective', to_char(today + x.days - 365, mdy), 'expiration', to_char(today + x.days, mdy),
      'locationId', x.loc, 'locationName', x.lname, 'locationAddress', x.addr, 'annualPremium', x.prem, 'policyNumber', x.pol, 'coverageType', x.kind, 'paymentStatus', 'Paid in full', 'notes', '')
  from (values ('pc1', 'Property', 'Travelers', 'TVP-4471902', 'Pinecrest Inn — Old Town', '1120 2nd St, Sacramento, CA 95814', 6842.17, 143),
               ('pc1', 'Liability', 'Travelers', 'TVL-4471903', 'Pinecrest Inn — Old Town', '1120 2nd St, Sacramento, CA 95814', 3915.40, 143),
               ('pc2', 'Property', 'Hartford', 'HF-88210-44', 'Pinecrest Inn — Folsom', '405 Riley St, Folsom, CA 95630', 5288.66, 61),
               ('pc2', 'Liability', 'Hartford', 'HF-88210-45', 'Pinecrest Inn — Folsom', '405 Riley St, Folsom, CA 95630', 2974.00, 61),
               ('pc3', 'Property', 'Travelers', 'TVP-4502118', 'Pinecrest Suites — Roseville', '2210 Eureka Rd, Roseville, CA 95661', 7410.93, 22),
               ('pc3', 'Workers Comp', 'Employers', 'EIG-3319084', 'Pinecrest Suites — Roseville', '2210 Eureka Rd, Roseville, CA 95661', 9126.55, -9))
       x(loc, kind, carrier, pol, lname, addr, prem, days);

  -- Brokered commercial binders
  insert into public.book_accounts (agency_id, id, book, name, dba, contact, phone, address, producer, data)
  select v_ag, 'bc-' || x.slug, 'brokered_commercial', x.name, x.name, x.contact, x.phone, x.addr, x.prod,
    jsonb_build_object('kind', x.kind, 'carrier', x.carrier, 'premium', x.prem, 'total', round(x.prem * 1.0612 + 350, 2), 'tax', round(x.prem * 0.03, 2), 'stamping', round(x.prem * 0.0018, 2),
      'brokerFee', 250, 'policyFee', 100, 'commission', 0.1, 'mep', '25%', 'deposit', '100%', 'best', 'A (XV)', 'naic', x.naic, 'auditable', true, 'policy', x.pol,
      'start', (today + x.days - 365)::text, 'renewal', (today + x.days)::text, 'issued', (today + x.days - 364)::text, 'broker', x.broker,
      'subjectTo', jsonb_build_array('Signed and dated application', 'Five year loss history'), 'other', '[]'::jsonb,
      'sites', jsonb_build_array(jsonb_build_object('label', x.name, 'address', x.addr, 'policies', jsonb_build_array(x.pol || ' · ' || x.carrier || ' ' || lower(x.kind)))))
  from (values ('delta-grading', 'Delta Grading & Excavation', 'Casualty', 'Kinsale Insurance Company', 18450.00, '01004871223', '38920', 'Marco Delgado', '(916) 555-0112', '8811 Florin Rd, Sacramento, CA 95829', 'Derek Whitfield', 'Pacific Wholesale Brokers', 47),
               ('bright-ember', 'Bright Ember Catering', 'General Liability', 'Scottsdale Insurance Company', 6120.00, 'CPS4410982', '41297', 'Lena Park', '(916) 555-0163', '301 J St, Sacramento, CA 95814', 'Maya Castillo', 'Pacific Wholesale Brokers', 118),
               ('river-city-roofing', 'River City Roofing', 'Casualty', 'Nautilus Insurance Company', 22785.00, 'NN1528840', '17370', 'Hank Ellison', '(916) 555-0138', '4420 Power Inn Rd, Sacramento, CA 95826', 'Maya Castillo', 'Sierra E&S Partners', 214),
               ('clearview-consulting', 'Clearview IT Consulting', 'Professional Liability', 'Hiscox Insurance Company', 3480.00, 'MPL-2290184', '10200', 'Anita Rao', '(916) 555-0191', '1500 Douglas Blvd, Roseville, CA 95661', 'Priya Nair', 'Direct', -6))
       x(slug, name, kind, carrier, prem, pol, naic, contact, phone, addr, prod, broker, days);
  insert into public.book_policies (agency_id, id, account_id, book, policy_number, insured, carrier, product, effective, expiration, premium, status, data)
  select v_ag, a.id || '-main', a.id, 'brokered_commercial', a.data->>'policy', a.name, a.data->>'carrier', a.data->>'kind', (a.data->>'start')::date, (a.data->>'renewal')::date,
    (a.data->>'premium')::numeric, 'Bound', a.data - 'sites' - 'other'
  from public.book_accounts a where a.agency_id = v_ag and a.book = 'brokered_commercial';

  -- Brokered personal lines
  for i in 1..46 loop
    v_client := first_names[1 + floor(random()::numeric * array_length(first_names, 1))] || ' ' || last_names[1 + floor(random()::numeric * array_length(last_names, 1))];
    v_cid := 'bp-nw-' || lpad(i::text, 3, '0');
    insert into public.book_accounts (agency_id, id, book, name, data) values (v_ag, v_cid, 'brokered_personal', v_client, jsonb_build_object('account', null));
    for j in 1..(1 + (random()::numeric < 0.2)::int) loop
      k := (random()::numeric * 380)::int - 15;
      v_line := (array['Homeowner (HO-3)','Homeowner (HO-3)','Dwelling Fire (DP-3)','Home'])[1 + floor(random()::numeric * 4)];
      v_prem := round(900 + power(random()::numeric, 1.4) * 3200, 2);
      insert into public.book_policies (agency_id, id, account_id, book, policy_number, insured, carrier, product, effective, expiration, premium, status, location, data)
      select v_ag, 'rb-nw-' || i || '-' || j, v_cid, 'brokered_personal', x.pol, v_client, x.carrier, v_line, today + k - 365, today + k, v_prem, 'In Force', x.addr,
        jsonb_build_object('id', 'rb-nw-' || i || '-' || j, 'broker', x.broker, 'status', 'In Force', 'termFrom', to_char(today + k - 365, mdy), 'termTo', to_char(today + k, mdy),
          'account', '', 'carrier', x.carrier, 'insured', v_client, 'premium', v_prem, 'product', v_line, 'program', 'Admitted', 'effective', to_char(today + k - 365, mdy),
          'riskAddress', x.addr, 'policyNumber', x.pol, 'totalWithFees', round(v_prem * 1.047, 2))
      from (select (array['Bamboo Insurance','Orion180','Aegis General'])[1 + floor(random()::numeric * 3)] broker,
                   (array['Sutton National Insurance Company','Orion180 Insurance','Aegis Security Insurance'])[1 + floor(random()::numeric * 3)] carrier,
                   'CA' || (array['HO','DP','HO'])[1 + floor(random()::numeric * 3)] || (100300000 + floor(random()::numeric * 899999))::text pol,
                   (100 + floor(random()::numeric * 9800))::text || ' ' || streets[1 + floor(random()::numeric * array_length(streets, 1))] || ', ' || split_part(c, '|', 1) || ', CA ' || split_part(c, '|', 2) || lpad(floor(random()::numeric * 99)::text, 2, '0') addr
            from (select cities[1 + floor(random()::numeric * array_length(cities, 1))] c) cc) x;
    end loop;
  end loop;

  -- 9. Team: producers, licences, HR, training ------------------------------------------------------------
  insert into public.producers (agency_id, name, role, active) select v_ag, name, 'producer', true from dp;
  insert into public.producers (agency_id, name, role, active) values (v_ag, 'Jordan Reyes', 'sdr', true), (v_ag, 'Kelsey Park', 'sdr', true);
  insert into public.licenses (agency_id, name, role, state, authority, license_type, number, effective, expires, quals, verify_url)
  select v_ag, x.name, x.role, 'CA', 'California Department of Insurance', 'Insurance Producer', x.num, x.eff, x.eff + interval '2 years' - interval '1 day',
    jsonb_build_array(jsonb_build_object('q', 'Property', 'eff', to_char(x.eff, mdy)), jsonb_build_object('q', 'Casualty', 'eff', to_char(x.eff, mdy)))
      || case when x.life then jsonb_build_array(jsonb_build_object('q', 'Life', 'eff', to_char(x.eff, mdy))) else '[]'::jsonb end, ''
  from (values ('Alex Morgan', 'Agency owner', '0N48213', date '2025-03-14', true), ('Maya Castillo', 'Producer', '0M77402', date '2025-06-02', true),
               ('Derek Whitfield', 'Producer', '0L93055', date '2024-11-18', true), ('Priya Nair', 'Producer', '0P10876', date '2025-09-09', true),
               ('Tom Brennan', 'Producer', '4K28814', date '2025-01-27', false), ('Alicia Moreno', 'Producer', '4N60391', (today - 21) - interval '2 years' + interval '1 day', true))
       x(name, role, num, eff, life);
  insert into public.hr_staff (agency_id, name, role, hourly, rate, active) values
    (v_ag, 'Alex Morgan', 'Agency owner', false, null, true), (v_ag, 'Maya Castillo', 'Producer', true, 27.50, true), (v_ag, 'Derek Whitfield', 'Producer', true, 25.75, true),
    (v_ag, 'Priya Nair', 'Producer', true, 26.25, true), (v_ag, 'Tom Brennan', 'Producer', true, 23.50, true), (v_ag, 'Alicia Moreno', 'Producer', true, 21.00, true),
    (v_ag, 'Jordan Reyes', 'SDR', true, 19.50, true), (v_ag, 'Kelsey Park', 'SDR', true, 19.00, true), (v_ag, 'Nina Olsen', 'Admin', true, 22.00, true);
  insert into public.hr_punches (agency_id, name, work_date, start_time, end_time, breaks)
  select v_ag, h.name, dd::date,
    to_char(timestamp '2000-01-01 08:30' + (random()::numeric * 50)::int * interval '1 minute', 'FMHH12:MIAM'), to_char(timestamp '2000-01-01 16:45' + (random()::numeric * 55)::int * interval '1 minute', 'FMHH12:MIAM'),
    jsonb_build_array(jsonb_build_array(to_char(timestamp '2000-01-01 12:00' + (random()::numeric * 60)::int * interval '1 minute', 'FMHH12:MIAM'), to_char(timestamp '2000-01-01 12:35' + (random()::numeric * 60)::int * interval '1 minute', 'FMHH12:MIAM')))
  from public.hr_staff h cross join generate_series(today - 13, today - 1, interval '1 day') dd
  where h.agency_id = v_ag and h.hourly and extract(isodow from dd) < 6;
  insert into public.training_status (agency_id, person, course, status)
  select v_ag, x.person, c.course, case when random()::numeric < x.done then 'Completed' when random()::numeric < 0.35 then 'In progress' else 'Not started' end
  from (values ('Alicia Moreno', 0.55), ('Tom Brennan', 0.92)) x(person, done)
  cross join (select distinct course from public.training_status where agency_id = iw
              union select unnest(array['Getting Started with New Agent Training','Personal Lines Products','Life Fast Start','Working Internet Leads','Sell and Cross-Sell Products','Overcome Objections'])) c;

  -- 10. Workspace: work queue, daily checklist, chat, saved logins, sync history --------------------------
  insert into public.work_items (agency_id, area, name, kind, priority, entered, due, owner, status, note, source)
  select v_ag, x.area, x.name, x.kind, x.pri, today - x.ago, today - x.ago + x.due, x.owner, x.st, x.note, 'Declara'
  from (values ('Client Support', 'Endorsement — add 2019 Tacoma to auto policy', 'Policy Change', 'High', 1, 2, 'Nina Olsen', 'In Process', 'Waiting on VIN from client'),
               ('Client Support', 'Certificate of insurance for Bright Ember Catering', 'COI', 'Critical', 0, 1, 'Nina Olsen', 'Not started', 'Holder: Sacramento Convention Center'),
               ('Client Support', 'Payment reminder — Garrison homeowners', 'Payment', 'Medium', 3, 4, 'Tom Brennan', 'Completed', 'Paid by card'),
               ('Administrative', 'Reconcile last folio against the carrier statement', 'Reporting', 'High', 2, 5, 'Alex Morgan', 'In Process', ''),
               ('Client Support', 'Requote — Delgado auto after ticket drops off', 'Requote', 'Medium', 4, 10, 'Derek Whitfield', 'Not started', ''),
               ('Sales Support', 'Follow up on 6 EverQuote leads from Monday', 'Agency Operations', 'High', 2, 1, 'Priya Nair', 'In Process', ''),
               ('Client Support', 'Update mailing address — Nakamura household', 'Update Address', 'Medium', 5, 2, 'Nina Olsen', 'Completed', ''),
               ('Administrative', 'Order new business cards for Alicia', 'Agency Operations', 'Low', 6, 14, 'Alex Morgan', 'Completed', ''),
               ('Client Support', 'River City Roofing — renewal submission to markets', 'Requote', 'Critical', 1, 20, 'Maya Castillo', 'In Process', 'Loss runs requested'),
               ('Payroll', 'Approve timesheets for the pay period', 'Agency Operations', 'Critical', 0, 2, 'Alex Morgan', 'Not started', ''),
               ('Client Support', 'Send policy documents — Okafor renters', 'Policy Documents', 'Medium', 2, 1, 'Alicia Moreno', 'Completed', ''),
               ('Troubleshooting', 'Dialer dropping calls on line 3', 'Network Infrastructure', 'High', 3, 3, 'Nina Olsen', 'In Process', 'Ticket open with provider'))
       x(area, name, kind, pri, ago, due, owner, st, note);
  insert into public.checklist_items (agency_id, area, name, priority, due_time, sort, active) values
    (v_ag, 'Administrative', 'Return missed calls and voicemails', 'Critical', '9:00 AM', 1, true), (v_ag, 'Administrative', 'Check the carrier notices inbox', 'High', '9:30 AM', 2, true),
    (v_ag, 'Client Support', 'Work the renewal list for the next 30 days', 'Medium', '10:00 AM', 3, true), (v_ag, 'Client Support', 'Send certificates requested yesterday', 'Medium', '11:00 AM', 4, true),
    (v_ag, 'Sales Support', 'Log quotes in AgencyZoom before end of day', 'High', '4:30 PM', 5, true), (v_ag, 'Payroll', 'Submit timesheets', 'Critical', '1st & 16th', 6, true),
    (v_ag, 'Troubleshooting', 'Check the dialer and phones are up', 'High', '9 AM / 1 PM / 4 PM', 7, true), (v_ag, 'Administrative', 'Close out the folio reconciliation', 'Critical', 'End of month', 8, true);
  insert into public.chat_messages (agency_id, room, author_id, author_name, body, created_at)
  select v_ag, x.room, sa.user_id, x.who, x.body, now() - x.ago * interval '1 minute'
  from (values ('general', 'Alex Morgan', 'Morning all — team huddle at 9:15 in the conference room. Bring your pipeline numbers.', 410),
               ('sales', 'Maya Castillo', 'Just bound River City Roofing''s umbrella. Renewal submission for the GL goes out this week.', 250),
               ('sales', 'Priya Nair', 'Two life apps out for signature today, both from auto cross-sells.', 190),
               ('service', 'Nina Olsen', 'Reminder: certificates requested before noon go out same day.', 150),
               ('general', 'Derek Whitfield', 'EverQuote leads have been strong this week — six quoted yesterday.', 95),
               ('sales', 'Alicia Moreno', 'First commercial quote sent! Bright Ember Catering asked about adding liquor liability.', 40),
               ('general', 'Alex Morgan', 'Great folio so far everyone. We''re ahead of pace on Farmers premium.', 12)) x(room, who, body, ago)
  cross join lateral (select user_id from public.staff_accounts where agency_id = v_ag and role = 'owner' limit 1) sa;
  insert into public.agency_logins (agency_id, grp, name, url, username, notes, has_secret, updated_by) values
    (v_ag, 'Carriers', 'Farmers Agency Portal', 'https://www.farmersagent.com', 'northwind.agency', 'Demo entry — not a real login', false, 'Alex Morgan'),
    (v_ag, 'Carriers', 'Progressive ForAgentsOnly', 'https://www.foragentsonly.com', 'nw-demo-producer', 'Demo entry — not a real login', false, 'Alex Morgan'),
    (v_ag, 'Carriers', 'Safeco Now', 'https://now.safeco.com', 'northwind-demo', 'Demo entry — not a real login', false, 'Alex Morgan'),
    (v_ag, 'Agency systems', 'AgencyZoom', 'https://app.agencyzoom.com', 'demo@northwind-demo.test', 'Demo entry — not a real login', false, 'Alex Morgan'),
    (v_ag, 'Agency systems', 'Dialer', 'https://example.com', 'northwind-front-desk', 'Demo entry — not a real login', false, 'Alex Morgan');
  insert into public.sync_log (agency_id, source, started_at, finished_at, status, records_pulled, details)
  select v_ag, 'agencyzoom', t, t + interval '84 seconds', 'success', 60 + floor(random()::numeric * 25)::int, jsonb_build_object('demo', true, 'errors', '[]'::jsonb)
  from generate_series(date_trunc('hour', now()) - interval '5 hours', date_trunc('hour', now()), interval '1 hour') t;

  -- 11. The original screens' report data (built from the rows above) ------------------------------------
  wb := jsonb_build_object('folio', (
      select jsonb_object_agg(f2.fk::text, jsonb_build_object('label', f2.label || case when f2.in_progress then ' (in progress)' else '' end, 'start', f2.fk::text, 'end', f2.fend::text,
        'inProgress', f2.in_progress, 'sales', '[]'::jsonb, 'sampleTotal', coalesce(t.prem, 0),
        'byProducer', coalesce(t.bp, '{}'::jsonb),
        'official', jsonb_build_object('pcPremium', coalesce(t.pc_prem, 0), 'pcPolicies', coalesce(t.pc_n, 0), 'pcItems', coalesce(t.pc_n, 0) + coalesce(t.bundles, 0), 'pcSales', coalesce(t.custs, 0),
          'lhPremium', coalesce(t.life_prem, 0), 'lhPolicies', coalesce(t.life_n, 0), 'lhAppts', coalesce(t.life_n, 0))))
      from df f2 left join lateral (
        select round(sum(premium), 2) prem, count(distinct cid) custs, count(*) filter (where line <> 'Life') pc_n, round(sum(premium) filter (where line <> 'Life'), 2) pc_prem,
          count(*) filter (where line = 'Life') life_n, round(sum(premium) filter (where line = 'Life'), 2) life_prem, count(*) - count(distinct cid) bundles,
          (select jsonb_object_agg(producer, pp) from (select producer, round(sum(premium), 2) pp from dsale y where y.d between f2.fk and f2.fend group by producer) z) bp
        from dsale x where x.d between f2.fk and f2.fend) t on true
      where f2.fk >= first_folio),
    'commissionsByFolio', (
      select coalesce(jsonb_object_agg(fk::text, prods), '{}'::jsonb) from (
        select f2.fk, jsonb_object_agg(c.producer, jsonb_build_object('policies', c.n, 'totalPremium', c.tot, 'farmersForemostPrem', c.ff, 'otherPrem', c.oth,
          'lifePolicies', c.life, 'iulPolicies', 0, 'brokerFeePrem', 0, 'commBrokerFee', 0, 'unclassifiedExcluded', 0, 'qualifies', c.q, 'tierRate', c.rate,
          'commFarmersForemost', round(case when c.q then c.ff * c.rate else 0 end, 2), 'commOther', round(case when c.q then c.oth * c.rate * 0.5 else 0 end, 2),
          'acceleratorBonus', round(case when c.q and c.tot >= 40000 then c.tot * 0.01 else 0 end, 2),
          'totalCommission', round(case when c.q then c.ff * c.rate + c.oth * c.rate * 0.5 + case when c.tot >= 40000 then c.tot * 0.01 else 0 end else 0 end, 2))) prods
        from df f2 join lateral (
          select producer, count(*) n, round(sum(premium), 2) tot, round(sum(premium) filter (where carrier ~* 'farmers|foremost'), 2) ff,
            round(coalesce(sum(premium) filter (where carrier !~* 'farmers|foremost'), 0), 2) oth, count(*) filter (where line = 'Life') life,
            (sum(premium) >= 9000 or count(*) >= 14) q, case when sum(premium) >= 32000 then 0.08 when sum(premium) >= 18000 then 0.06 else 0.04 end rate
          from dsale x where x.d between f2.fk and f2.fend group by producer) c on true
        where f2.fk >= first_folio and not f2.in_progress group by f2.fk) z));

  azr := (select jsonb_object_agg(f2.fk::text, jsonb_build_object(
      'period', f2.label || case when f2.in_progress then ' (in progress)' else '' end, 'periodLabel', f2.label, 'generatedAt', to_char(today, mdy), 'source', 'AgencyZoom',
      'filters', jsonb_build_object('folio', f2.label || case when f2.in_progress then ' (in progress)' else '' end, 'product', 'All', 'producer', 'All'),
      'notes', jsonb_build_array('Northwind is a demo agency: every name, policy and figure here is made up.',
                                 case when f2.in_progress then 'This folio is still open — figures are a running total through ' || to_char(today, mdy) || '.' else 'Folio closed; reconciles to the carrier statement.' end),
      'metrics', jsonb_build_object(
        'writtenPremium', jsonb_build_object('label', 'Written premium', 'value', coalesce(m.prem, 0), 'money', true, 'goal', null, 'pct', null, 'sub', m.n || ' policies · ' || m.custs || ' customers'),
        'policiesSold', jsonb_build_object('label', 'Policies sold', 'value', coalesce(m.n, 0), 'goal', null, 'pct', null, 'sub', m.custs || ' sales · ' || m.n || ' items'),
        'newCustomers', jsonb_build_object('label', 'Customers written', 'value', coalesce(m.custs, 0), 'goal', null, 'pct', null, 'sub', 'distinct customers with a sale this folio'),
        'policiesPerCustomer', jsonb_build_object('label', 'Policies per customer', 'value', round(m.n::numeric / nullif(m.custs, 0), 2), 'decimals', 2, 'goal', null, 'pct', null, 'sub', 'bundling on new business'),
        'quotes', jsonb_build_object('label', 'Quotes', 'value', round(m.custs * 2.7), 'goal', null, 'pct', null, 'sub', 'quoted leads with a premium'),
        'quoteToSale', jsonb_build_object('label', 'Quote to sale %', 'value', round(100 / 2.7, 1), 'suffix', '%', 'goal', null, 'pct', null, 'sub', m.custs || ' sales vs ' || round(m.custs * 2.7) || ' quotes · directional'),
        'revenue', jsonb_build_object('label', 'Revenue / commission', 'value', round(coalesce(m.prem, 0) * 0.112, 2), 'money', true, 'goal', null, 'pct', null, 'sub', 'agency commission at the blended rate'),
        'showRate', jsonb_build_object('label', 'Show rate %', 'noData', true, 'why', 'Not tracked in AgencyZoom'),
        'closeRate', jsonb_build_object('label', 'Close rate %', 'noData', true, 'why', 'Not tracked in AgencyZoom'),
        'appointmentsSet', jsonb_build_object('label', 'Appointments set', 'noData', true, 'why', 'Not tracked in AgencyZoom'),
        'appointmentsHeld', jsonb_build_object('label', 'Appointments held', 'noData', true, 'why', 'Not tracked in AgencyZoom')),
      'byLine', (select coalesce(jsonb_agg(jsonb_build_object('label', line, 'n', n, 'value', v) order by v desc), '[]') from (select line, count(*) n, round(sum(premium), 2) v from dsale x where x.d between f2.fk and f2.fend group by line) z),
      'byCarrier', (select coalesce(jsonb_agg(jsonb_build_object('label', carrier, 'n', n, 'value', v) order by v desc), '[]') from (select carrier, count(*) n, round(sum(premium), 2) v from dsale x where x.d between f2.fk and f2.fend group by carrier) z),
      'byProducer', (select coalesce(jsonb_agg(jsonb_build_object('label', producer, 'n', n, 'value', v) order by v desc), '[]') from (select producer, count(*) n, round(sum(premium), 2) v from dsale x where x.d between f2.fk and f2.fend group by producer) z),
      'byLeadSource', (select coalesce(jsonb_agg(jsonb_build_object('label', lead_source, 'n', n, 'value', v) order by v desc), '[]') from (select lead_source, count(*) n, round(sum(premium), 2) v from dsale x where x.d between f2.fk and f2.fend group by lead_source) z),
      'byMonth', (select jsonb_agg(jsonb_build_object('key', f3.fk::text, 'year', extract(year from f3.fend)::int, 'label', to_char(f3.fk, 'Mon FMDD') || ' – ' || to_char(f3.fend, 'Mon FMDD'),
                    'premium', (select coalesce(round(sum(premium), 2), 0) from dsale x where x.d between f3.fk and f3.fend), 'policies', (select count(*) from dsale x where x.d between f3.fk and f3.fend)) order by f3.fk)
                  from df f3 where f3.fk >= first_folio and f3.fk <= f2.fk),
      'producerDetail', (select coalesce(jsonb_object_agg(producer, jsonb_build_object('rows', rows, 'total', tot, 'policies', n, 'sourceNote', 'AgencyZoom daily sales detail')), '{}') from (
          select producer, jsonb_agg(jsonb_build_object('client', client, 'carrier', carrier, 'line', line, 'premium', premium, 'producer', producer, 'when', to_char(d, mdy)) order by d) rows,
            round(sum(premium), 2) tot, count(*) n from dsale x where x.d between f2.fk and f2.fend group by producer) z),
      'carrierDetail', (select coalesce(jsonb_object_agg(carrier, jsonb_build_object('rows', rows, 'total', tot, 'policies', n, 'sourceNote', 'AgencyZoom daily sales detail')), '{}') from (
          select carrier, jsonb_agg(jsonb_build_object('client', client, 'carrier', carrier, 'line', line, 'premium', premium, 'producer', producer, 'when', to_char(d, mdy)) order by d) rows,
            round(sum(premium), 2) tot, count(*) n from dsale x where x.d between f2.fk and f2.fend group by carrier) z),
      'renewals', '[]'::jsonb))
    from df f2 left join lateral (select round(sum(premium), 2) prem, count(*) n, count(distinct cid) custs from dsale x where x.d between f2.fk and f2.fend) m on true
    where f2.fk >= first_folio);

  -- Huddle sheet for today
  hud := (with fs as (select producer, sum(premium) p, sum(premium) filter (where carrier ~* 'farmers|foremost') fp from dsale where d between fcur.fk and today group by producer),
               ls as (select x.producer, sum(x.premium) p, sum(x.premium) filter (where x.carrier ~* 'farmers|foremost') fp from dsale x join df on df.fk = (select max(fk) from df where fk < fcur.fk) and x.d between df.fk and df.fend group by x.producer),
               mtd as (select coalesce(sum(premium), 0) p, count(*) filter (where line = 'Life') life, count(*) filter (where comm) com from dsale where d >= date_trunc('month', today::timestamp)::date)
    select jsonb_build_object(
      'asOf', to_char(today, mdy), 'weekLabel', 'Week ' || to_char(today, 'MM/DD/YY'), 'todoDate', to_char(today, mdy), 'todoPrevDate', to_char(today - 1, mdy),
      'folioLabel', upper(to_char(fcur.fk, 'FMMonth FMDD') || ' - ' || to_char(fcur.fend, 'FMMonth FMDD')),
      'lastLabel', (select upper(to_char(fk, 'FMMonth FMDD') || ' - ' || to_char(fend, 'FMMonth FMDD')) from df where fk < fcur.fk order by fk desc limit 1),
      'folioPct', ((select coalesce(sum(p), 0) from fs) / 72000)::text, 'lastPct', ((select coalesce(sum(p), 0) from ls) / 70000)::text,
      'folioTop', jsonb_build_array(jsonb_build_object('k', 'TOTAL PREMIUM', 'a', round((select coalesce(sum(p), 0) from fs))::text, 'money', true),
                                    jsonb_build_object('k', 'FARMERS PREMIUM', 'a', round((select coalesce(sum(fp), 0) from fs))::text, 'money', true),
                                    jsonb_build_object('k', 'GOAL', 'a', '72000', 'money', true)),
      'lastTop', jsonb_build_array(jsonb_build_object('k', 'TOTAL PREMIUM', 'a', round((select coalesce(sum(p), 0) from ls))::text, 'money', true),
                                   jsonb_build_object('k', 'FARMERS PREMIUM', 'a', round((select coalesce(sum(fp), 0) from ls))::text, 'money', true),
                                   jsonb_build_object('k', 'GOAL', 'a', '70000', 'money', true)),
      'folioAll', (select jsonb_agg(jsonb_build_object('n', dp.name, 'p', round(coalesce(fs.p, 0))::text, 'pipe', round(1500 + random()::numeric * 9000)::text, 'close', (round(dp.wt * 2400, -3))::text) order by coalesce(fs.p, 0) desc) from dp left join fs on fs.producer = dp.name)
                  || jsonb_build_array(jsonb_build_object('n', 'Total', 'p', round((select coalesce(sum(p), 0) from fs))::text, 'pipe', '', 'close', '72000')),
      'folioFarmers', (select jsonb_agg(jsonb_build_object('n', dp.name, 'p', round(coalesce(fs.fp, 0))::text, 'pipe', round(900 + random()::numeric * 6000)::text, 'close', (round(dp.wt * 1800, -3))::text) order by coalesce(fs.fp, 0) desc) from dp left join fs on fs.producer = dp.name),
      'lastAll', (select jsonb_agg(jsonb_build_object('n', dp.name, 'p', round(coalesce(ls.p, 0))::text, 'pipe', '', 'close', (round(dp.wt * 2400, -3))::text) order by coalesce(ls.p, 0) desc) from dp left join ls on ls.producer = dp.name),
      'lastFarmers', (select jsonb_agg(jsonb_build_object('n', dp.name, 'p', round(coalesce(ls.fp, 0))::text, 'pipe', '', 'close', (round(dp.wt * 1800, -3))::text) order by coalesce(ls.fp, 0) desc) from dp left join ls on ls.producer = dp.name),
      'pace', jsonb_build_array(jsonb_build_object('k', 'MTD PREMIUM', 'v', round((select p from mtd))::text, 'money', true), jsonb_build_object('k', 'GOAL PREMIUM', 'v', '72000', 'money', true),
                                jsonb_build_object('k', 'REMAINING PREMIUM NEEDED', 'v', greatest(0, round(72000 - (select p from mtd)))::text, 'money', true),
                                jsonb_build_object('k', 'DAILY PACE NEEDED', 'v', round(greatest(0, 72000 - (select p from mtd)) / greatest(1, (date_trunc('month', today::timestamp) + interval '1 month')::date - today))::text, 'money', true),
                                jsonb_build_object('k', 'LIFE APP COUNT', 'v', (select life from mtd)::text, 'money', false), jsonb_build_object('k', 'COMMERCIAL COUNT', 'v', (select com from mtd)::text, 'money', false)),
      'paceRank', (select jsonb_agg(jsonb_build_object('n', producer, 'v', round(p)::text) order by p desc) from fs),
      'agency', jsonb_build_array(jsonb_build_object('k', 'TOTAL DIALS', 'v', 612 + floor(random()::numeric * 90), 'money', false), jsonb_build_object('k', 'TOTAL CONTACTS', 'v', 71 + floor(random()::numeric * 20), 'money', false),
                                  jsonb_build_object('k', 'TOTAL OPPORTUNITIES', 'v', 24 + floor(random()::numeric * 8), 'money', false), jsonb_build_object('k', 'TOTAL QUOTES', 'v', 19 + floor(random()::numeric * 6), 'money', false),
                                  jsonb_build_object('k', 'TOTAL QUOTED AMOUNT $', 'v', 41250 + floor(random()::numeric * 9000), 'money', true), jsonb_build_object('k', 'TOTAL BIND', 'v', 4 + floor(random()::numeric * 4), 'money', false),
                                  jsonb_build_object('k', 'TOTAL LIFE APPS', 'v', 1 + floor(random()::numeric * 2), 'money', false), jsonb_build_object('k', 'TOTAL PREMIUM WRITTEN', 'v', round((select coalesce(sum(premium), 0) from dsale where d = today - 1)), 'money', true)),
      'agencyNotes', jsonb_build_array('Northwind is a demo agency — every figure here is made up.', 'All metrics are pulled from AgencyZoom and the dialer'),
      'indivCols', jsonb_build_array('DIALS ( OUTBOUND )', 'INBOUND', 'TALKTIME', 'CONTACTS', 'Opps', 'Xfers', 'QUOTED', 'QUOTED AMOUNT $', 'BINDS', 'LIFE', 'PREMIUM'),
      'indivDay', (select jsonb_agg(jsonb_build_object('n', name, 'total', false, 'v', jsonb_build_array((80 + floor(random()::numeric * 70))::text, (2 + floor(random()::numeric * 9))::text,
                     floor(1 + random()::numeric * 2)::text || ' HR ' || floor(random()::numeric * 59)::text || ' MINS', (8 + floor(random()::numeric * 10))::text, (3 + floor(random()::numeric * 6))::text, (floor(random()::numeric * 4))::text,
                     (2 + floor(random()::numeric * 6))::text, (6000 + floor(random()::numeric * 14000))::text, (floor(random()::numeric * 3))::text, (floor(random()::numeric * 2))::text, (floor(random()::numeric * 5200))::text))) from dp),
      'indivWeek', (select jsonb_agg(jsonb_build_object('n', name, 'total', false, 'v', jsonb_build_array((380 + floor(random()::numeric * 220))::text, (14 + floor(random()::numeric * 25))::text,
                     floor(6 + random()::numeric * 5)::text || ' HR ' || floor(random()::numeric * 59)::text || ' MINS', (40 + floor(random()::numeric * 30))::text, (15 + floor(random()::numeric * 15))::text, (floor(random()::numeric * 12))::text,
                     (12 + floor(random()::numeric * 14))::text, (30000 + floor(random()::numeric * 40000))::text, (2 + floor(random()::numeric * 6))::text, (floor(random()::numeric * 3))::text, (4000 + floor(random()::numeric * 15000))::text))) from dp),
      'todo', (select jsonb_agg(jsonb_build_object('name', name, 'cat', area, 'pri', priority, 'due', due_time, 'st', case when sort <= 4 then 'Completed' else 'Not started' end, 'prev', '')) from public.checklist_items where agency_id = v_ag),
      'todoDone', 4, 'aggAll', 12, 'aggDone', 4, 'aggOpen', 8,
      'agg', (select jsonb_agg(jsonb_build_object('name', name, 'cat', area, 'type', kind, 'pri', priority, 'who', owner, 'st', status, 'due', to_char(due, mdy), 'entered', to_char(entered, mdy), 'days', (today - entered)::text, 'note', note)) from public.work_items where agency_id = v_ag and status <> 'Completed'),
      'aggAllRows', (select jsonb_agg(jsonb_build_object('name', name, 'cat', area, 'type', kind, 'pri', priority, 'who', owner, 'st', status, 'due', to_char(due, mdy), 'entered', to_char(entered, mdy), 'days', (today - entered)::text, 'note', note)) from public.work_items where agency_id = v_ag),
      'aggByWho', (select jsonb_agg(jsonb_build_array(owner, n)) from (select owner, count(*) n from public.work_items where agency_id = v_ag and status <> 'Completed' group by owner) z),
      'xferLog', (select coalesce(jsonb_agg(jsonb_build_object('act', case when az_qualifies then 'Quoted' else 'In Process' end, 'cat', 'Transfer', 'out', case status when 'Open' then '' else status end, 'sdr', sdr,
                     'date', to_char(date_time, mdy), 'prod', split_part(producer, ' ', 1), 'phone', '(916) 555-01' || lpad((id % 100)::text, 2, '0'), 'client', client) order by date_time desc), '[]')
                  from public.sdr_transfers where agency_id = v_ag and date_time >= today - 30),
      'sdr', '[]'::jsonb, 'sdrTotal', (select count(*) from public.sdr_transfers where agency_id = v_ag and date_time >= date_trunc('month', today::timestamp)::date),
      'xferTotal', (select count(*) from public.sdr_transfers where agency_id = v_ag and date_time >= today - 30),
      'xferCounts', (select jsonb_agg(jsonb_build_object('n', split_part(producer, ' ', 1), 'v', n::text)) from (select producer, count(*) n from public.sdr_transfers where agency_id = v_ag and date_time >= today - 30 group by producer) z),
      'xferOutcomes', (select jsonb_agg(jsonb_build_object('n', status, 'v', n::text)) from (select status, count(*) n from public.sdr_transfers where agency_id = v_ag and date_time >= today - 30 group by status) z),
      'sdrBySdr', (select jsonb_agg(jsonb_build_array(sdr, n)) from (select sdr, count(*) n from public.sdr_transfers where agency_id = v_ag group by sdr) z),
      'sdrByProd', (select jsonb_agg(jsonb_build_array(split_part(producer, ' ', 1), n)) from (select producer, count(*) n from public.sdr_transfers where agency_id = v_ag group by producer) z),
      'sdrByOut', (select jsonb_agg(jsonb_build_array(status, n)) from (select status, count(*) n from public.sdr_transfers where agency_id = v_ag group by status) z),
      'sdrLists', jsonb_build_object('sdr', jsonb_build_array('Jordan', 'Kelsey'), 'action', jsonb_build_array('Appointment', 'In Process', 'Quoted', 'Resolved'),
                    'result', jsonb_build_array('Sold', 'Dead', 'In Process', 'Resolved'), 'category', jsonb_build_array('Service', 'Transfer'),
                    'producer', (select jsonb_agg(first) from dp)),
      'xferFilter', jsonb_build_object('sdrs', '[]'::jsonb, 'action', '', 'outcome', '', 'category', 'Transfer', 'producers', '[]'::jsonb),
      'xferWindow', jsonb_build_array(to_char(today - 30, mdy), to_char(today, mdy)),
      'quotesSource', 'Quotes and quoted amount are live from the AgencyZoom Quoted pipeline; dials, contacts and talk time are from the dialer export.'));

  -- 12. Settings, people and the rest of the original screens' data ---------------------------------------
  insert into public.reference_data (agency_id, key, data, admin_only) values
    (v_ag, 'lg:WB_DATA', wb, true), (v_ag, 'lg:AZ_REPORTS', azr, true), (v_ag, 'lg:HUD', hud, true), (v_ag, 'lg:COMM_SEED',
      plan || jsonb_build_object('id', 'plan-northwind', 'name', 'Northwind producer plan', 'version', 1, 'status', 'active', 'effectiveFrom', '2025-01-01', 'effectiveTo', null,
        'createdAt', to_char(today, 'YYYY-MM-DD'), 'flags', '[]'::jsonb, 'exceptions', '[]'::jsonb, 'source', jsonb_build_object('kind', 'manual', 'fileName', '')), true),
    (v_ag, 'lg:WB_EXTRA', jsonb_build_object('daily', '{}'::jsonb, 'quotes', jsonb_build_object('byDay', '{}'::jsonb, 'definition', 'Open quoted leads with a quoted premium', 'note', '', 'pulledAt', to_char(today, mdy)),
       'sdr', jsonb_build_object('activeSdrs', jsonb_build_array('Jordan', 'Kelsey'), 'tags', jsonb_build_object('Jordan', 'Jordan Transfer', 'Kelsey', 'Kelsey Transfer'),
         'qualifiedTransferBonus', 15, 'boundPolicyBonus', 35, 'rule', (select rule from public.sdr_config where agency_id = v_ag limit 1), 'pulledAt', to_char(today, mdy), 'byMonth', '{}'::jsonb, 'transfers', '[]'::jsonb)), true),
    (v_ag, 'lg:GOALS', jsonb_build_object('premium', 72000, 'policies', 58, 'newClients', 40), true),
    (v_ag, 'lg:OWNER_IDENTITY', jsonb_build_object('name', 'Alex Morgan', 'first', 'Alex', 'role', 'Agency owner'), true),
    (v_ag, 'lg:SIGNED_IN', jsonb_build_object('name', 'Alex Morgan', 'first', 'Alex', 'role', 'Agency owner'), true),
    (v_ag, 'lg:SETTINGS', jsonb_build_object('theme', 'vidura', 'font', 'inter', 'producers', (select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'role', 'producer', 'email', email)) from dp)), true),
    (v_ag, 'lg:HR_STAFF', (select jsonb_agg(jsonb_build_object('name', name, 'role', role, 'hourly', hourly, 'rate', rate)) from public.hr_staff where agency_id = v_ag), true),
    (v_ag, 'lg:HR_PUNCHES', (select jsonb_object_agg(name, pl) from (select name, jsonb_agg(jsonb_build_object('date', to_char(work_date, mdy), 'start', start_time, 'end', end_time, 'breaks', breaks) order by work_date) pl from public.hr_punches where agency_id = v_ag group by name) z), true),
    (v_ag, 'lg:LICENSES', (select jsonb_agg(jsonb_build_object('name', name, 'role', role, 'state', state, 'authority', authority, 'type', license_type, 'number', number,
       'effective', to_char(effective, mdy), 'expires', to_char(expires, mdy), 'quals', quals, 'verify', '')) from public.licenses where agency_id = v_ag), true),
    (v_ag, 'lg:DATA', jsonb_build_object('farmers', '[]'::jsonb, 'commercial', '[]'::jsonb), true), (v_ag, 'lg:CB_BINDERS', '[]'::jsonb, true), (v_ag, 'lg:RB', '[]'::jsonb, true),
    (v_ag, 'lg:CB_OWNER', 'null'::jsonb, true), (v_ag, 'lg:FARMERS_DECS', '{}'::jsonb, true), (v_ag, 'lg:RETAIL_DOCS', '{}'::jsonb, true),
    (v_ag, 'lg:COMM_RESULTS', '{}'::jsonb, true), (v_ag, 'lg:LIVE_FOLIO_ROWS', '{}'::jsonb, true), (v_ag, 'lg:HR_EDITS', '{}'::jsonb, true), (v_ag, 'lg:HR_SYNC', '{}'::jsonb, true),
    (v_ag, 'lg:AI_LOG', '[]'::jsonb, true), (v_ag, 'lg:AI_CTX', jsonb_build_object('client', null), true),
    (v_ag, 'lg:AI_CHIPS', jsonb_build_array('Which renewals are due in the next 30 days?', 'Who is our top producer this folio?', 'How much Farmers premium have we written this month?',
       'Which lead source brings the most premium?', 'What quotes are still open from last week?', 'Show commercial accounts renewing soon', 'How are we pacing against the folio goal?',
       'Which policies are past expiration?', 'What did Priya write this folio?', 'How many life policies this month?'), true),
    (v_ag, 'lg:COI_DEFAULTS', jsonb_build_object('holder', '', 'holderAddr', '', 'ops', '', 'glEach', '1,000,000', 'glAgg', '2,000,000', 'glMed', '5,000', 'glPersonal', '1,000,000',
       'glProducts', '2,000,000', 'glRented', '100,000', 'elAccident', '1,000,000', 'elDisease', '1,000,000', 'elEmployee', '1,000,000', 'wcCarrier', '', 'wcPolicy', '', 'wcStart', '', 'wcEnd', '',
       'addlInsured', false, 'primary', false, 'waiver', false), true);

  -- Protégé programme (Alicia is the protégé; Tom graduated last year)
  insert into public.reference_data (agency_id, key, data, admin_only)
  select v_ag, k, jsonb_build_object('mentor', 'Alex Morgan (NW100)', 'folioDate', to_char(fcur.fk, mdy), 'reportDate', to_char(today, mdy), 'idealTrait', 'Coachable, consistent daily activity',
      'monthGoals', jsonb_build_array(8000, 10000, 12000, 14000, 16000, 18000, 20000, 22000, 24000, 26000, 28000, 30000),
      'people', jsonb_build_array(jsonb_build_object('name', 'Alicia Moreno', 'short', 'Alicia', 'code', '001', 'start', '02/02/2026',
        'goals', jsonb_build_object('life', 12, 'premium', 150000, 'business', 6, 'specialty', 24),
        'months', (select jsonb_agg(round(coalesce(v, 0), 2) order by m) from (select date_trunc('month', x.d::timestamp) m, sum(premium) v from dsale x where producer = 'Alicia Moreno' group by 1) z),
        'currentMonth', (select count(distinct date_trunc('month', d::timestamp)) from dsale where producer = 'Alicia Moreno'),
        'life', (select count(*) from dsale where producer = 'Alicia Moreno' and line = 'Life'), 'business', (select count(*) from dsale where producer = 'Alicia Moreno' and comm),
        'specialty', (select count(*) from dsale where producer = 'Alicia Moreno' and line in ('Motorcycle', 'Mobile Home', 'Landlord', 'Earthquake', 'Umbrella')),
        'lifePremium', (select coalesce(round(sum(premium), 2), 0) from dsale where producer = 'Alicia Moreno' and line = 'Life'), 'qpd', 3.4, 'quotes30', 41,
        'note', 'On pace for premium; life count is the goal to watch.'))), false
  from unnest(array['protege', 'lg:PROTEGE']) k;
  insert into public.reference_data (agency_id, key, data, admin_only)
  select v_ag, k, jsonb_build_object('source', 'Farmers University', 'courses', coalesce((select r.data->'courses' from public.reference_data r where r.agency_id = iw and r.key = 'protege_training'), '[]'::jsonb),
      'byPerson', jsonb_build_object('Alicia Moreno', jsonb_build_object('asOf', to_char(today, mdy), 'launch', '02/02/2026',
        'status', (select jsonb_object_agg(course, status) from public.training_status where agency_id = v_ag and person = 'Alicia Moreno')))), false
  from unnest(array['protege_training', 'lg:PROTEGE_TRAINING']) k;

  -- App configuration that is the same for every agency, with the agency's name swapped in
  insert into public.reference_data (agency_id, key, data, admin_only)
  select v_ag, r.key, replace(replace(r.data::text, 'Ironwood Insurance Agency', 'Northwind Insurance Group'), 'Ironwood', 'Northwind')::jsonb, r.admin_only
  from public.reference_data r
  where r.agency_id = iw and r.key in ('lg:ACCESS','lg:AI_TYPE_LABEL','lg:ANNUAL_PERIODS','lg:ANNUAL_SECTIONS','lg:AUTO_2026','lg:AZ','lg:AZ_FIELDS','lg:BKT',
    'lg:BOOK_NAME','lg:BOOK_TAB','lg:CHART','lg:CHAT_CHANNELS','lg:COMM_METRICS','lg:COMPLIANCE_2026','lg:DASH_DEF_KEY','lg:DASH_SOURCE','lg:DASH_TONE',
    'lg:DIALERS','lg:DOC_BOOK_LABEL','lg:DOC_TYPE_LABEL','lg:EXEC_PROD_WINDOWS','lg:FARMERS_BI','lg:FARMERS_KB','lg:FONTS','lg:FORESIGHT_PAID_DEFAULTS',
    'lg:FORESIGHT_PLANS','lg:HR_TABS','lg:HUD_TABS','lg:INTEGRATIONS','lg:LEGAL_CATS','lg:MAIL','lg:MARKETS','lg:METRIC_DEFS','lg:METRIC_ICON','lg:METRIC_ORDER',
    'lg:METRIC_TONE','lg:PERIODS','lg:RB_LINES','lg:REIMB_POLICY','lg:REP_BOOKS','lg:REPORT_TABS','lg:ROLE_NAV','lg:SALES_PERIODS','lg:STATUS_LABEL',
    'lg:SUB_PLANS','lg:SYSTEMS','lg:TENURE_BANDS','lg:TERMS_TEXT','lg:THEMES','lg:WORK_STATUSES','lg:S',
    'farmers_bi','farmers_kb','fu_modules','markets','systems');
  -- Forms point at the agency's own uploaded documents, which a demo agency doesn't have: keep the list, drop the links.
  insert into public.reference_data (agency_id, key, data, admin_only)
  select v_ag, r.key, coalesce((select jsonb_agg(e - 'document_id' - 'uri' - 'file') from jsonb_array_elements(r.data) e), '[]'::jsonb), r.admin_only
  from public.reference_data r where r.agency_id = iw and r.key in ('resources', 'lg:RESOURCES');
  update public.reference_data set data = jsonb_set(data, '{client}', 'null') where agency_id = v_ag and key = 'lg:S' and data ? 'client';

  select jsonb_build_object('sales', (select count(*) from public.daily_sales where agency_id = v_ag), 'history', (select count(*) from public.sales_history where agency_id = v_ag),
    'folio_rows', (select count(*) from public.folio_line_items where agency_id = v_ag), 'quotes', (select count(*) from public.quote_leads where agency_id = v_ag),
    'transfers', (select count(*) from public.sdr_transfers where agency_id = v_ag), 'accounts', (select count(*) from public.book_accounts where agency_id = v_ag),
    'policies', (select count(*) from public.book_policies where agency_id = v_ag), 'settings', (select count(*) from public.reference_data where agency_id = v_ag),
    'ytd_premium', (select round(sum(premium)) from public.daily_sales where agency_id = v_ag and sale_date >= date_trunc('year', today::timestamp)::date)) into out;
  return out;
end $fn$;

revoke execute on function public.demo_reset(text, double precision) from public, anon, authenticated;
