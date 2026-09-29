// Supabase Edge Function: agencyzoom-sync (v17)
//
// Keeps the Ironwood dashboard current from AgencyZoom:
//   sold   - every policy written (from customer policies) -> daily_sales
//   quotes - leads in Quoted with an actual quote       -> quote_leads
//   sdr    - leads tagged "Jackeline Transfer" / "Rhon Transfer" -> sdr_transfers
//
// Sales are found by reading customers' policies: customers created in the window, customers behind leads won in the
// window, and customers whose policy summary (in the customer list) changed since the last run, which is how a
// policy added to an existing customer shows. {"sweep": true} instead re-reads every customer's policies, a page
// of 100 per call, adding sales after the history cutoff that aren't recorded yet (az_sync_state keeps its place).
//
// {"history": true} fills az_sales_daily with AgencyZoom's own sales-dashboard totals per day (agency and producer),
// from 2025-01-01 on, resuming where it stopped (az_sync_state.history_through); every hourly run refreshes the
// last 7 days. {"history": true, "from", "to", "dry": true} only returns what it would store.
//
// Window: by default re-syncs the last 3 days (Pacific time) every run, so
// nothing is missed if a run fails. A backfill can pass {"start":"YYYY-MM-DD",
// "end":"YYYY-MM-DD"} in the POST body, and {"parts":["sold"]} to run one part.
// Never writes sales dated on/before the agency's history_cutoff: those days came from the
// agency's own reconciled export and already live in the table.
//
// AgencyZoom API facts this relies on (from its published OpenAPI spec):
//   - leads/list startDate/endDate filter on lead CREATION date, YYYY-MM-DD
//   - lastActivityEarliestDate / lastActivityLatestDate, YYYY-MM-DD
//   - GET leads/{id}/quotes -> [{id, carrierName, productName, premium, items, sold}]
//   - soldPeriod only honours its named ranges (mtd, lastmonth, ...), not a
//     custom YYYY-MM-DD|YYYY-MM-DD range, so the window is applied here.
//   - 120 calls/minute per account (shared with staff), so calls are paced.
//
// Secrets: AGENCYZOOM_USERNAME, AGENCYZOOM_PASSWORD, CRON_SECRET.
//
// Writes into the one agency marked agencies.agencyzoom_sync (the credentials above are that agency's).
// This runs with the service role, which skips row-level security, so every read and write names
// the agency itself; rows written without one are rejected by the database.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const AZ_BASE = "https://api.agencyzoom.com";
const PACE_MS = 800;           // ~75 calls/minute; AgencyZoom allows 120/min (spec, Aug 2026)
const TIME_BUDGET_MS = 125000; // stop starting new AgencyZoom calls after this
const SDR_TAGS: Record<string, string> = { "Jackeline Transfer": "Jackeline", "Rhon Transfer": "Rhon" };
const FAMILY_RX = /farmers|foremost/i;

let t0 = Date.now();
let lastCall = 0;
let calls = 0;
let outOfTime = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const timeLeft = () => Date.now() - t0 < TIME_BUDGET_MS;

function pacificISO(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function addDays(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
function isoDate(s: any): string | null {
  if (!s) return null;
  const str = String(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}
// AgencyZoom timestamps ("2026-09-24 05:39:59") are UTC. Turn one into the
// Pacific-time calendar day, so an evening sale isn't dated tomorrow.
function pacificDay(ts: any): string | null {
  if (!ts) return null;
  const str = String(ts);
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(str)) return null; // date only, no time to convert
  const d = new Date(str.replace(" ", "T") + (/[zZ]|[+-]\d{2}:?\d{2}$/.test(str) ? "" : "Z"));
  return isNaN(d.getTime()) ? null : pacificISO(d);
}
function mdy(iso: string | null) { return iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : ""; }

async function az(token: string, method: string, path: string, body?: unknown): Promise<any> {
  if (!timeLeft()) { outOfTime = true; throw new Error("__TIME__"); }
  const wait = lastCall + PACE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  for (let attempt = 0; attempt < 2; attempt++) {
    lastCall = Date.now(); calls++;
    const res = await fetch(`${AZ_BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt === 0) { await sleep(20000); continue; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`AgencyZoom ${path} failed (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
    return data;
  }
}

async function azLogin(username: string, password: string) {
  const res = await fetch(`${AZ_BASE}/v1/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = String(body?.message || body?.error || body?.errorMessage || "").replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`AgencyZoom login failed (${res.status})${why ? ": " + why : ""}. Check the AgencyZoom username/password saved in Supabase (Edge Functions > Secrets).`);
  }
  const token = body.jwt || body.token || body?.data?.token;
  if (!token) throw new Error("AgencyZoom login did not return a token.");
  return { token: token as string, ownerAgent: body.ownerAgent };
}

async function leadsList(token: string, filters: Record<string, unknown>) {
  const out: any[] = [];
  for (let page = 0; page < 20; page++) {
    const body = await az(token, "POST", "/v1/api/leads/list", { ...filters, page, pageSize: 100 });
    const leads = body.leads || body.data?.leads || [];
    out.push(...leads);
    if (leads.length < 100) break;
  }
  return out;
}

async function leadQuotes(token: string, leadId: any): Promise<any[]> {
  const body = await az(token, "GET", `/v1/api/leads/${leadId}/quotes`);
  const q = Array.isArray(body) ? body : (body.quotes || body.data?.quotes || body.data || []);
  return Array.isArray(q) ? q : [];
}

const personName = (l: any) => {
  const biz = l.businessName || l.name || "";
  const person = [l.firstname, l.lastname].filter(Boolean).join(" ").trim();
  return biz && person && biz !== person ? `${biz} (contact: ${person})` : (biz || person || "(no name)");
};
const producerName = (l: any) => [l.assignToFirstname, l.assignToLastname].filter(Boolean).join(" ").trim() || "Unassigned";
const tagList = (l: any): string[] => {
  const t = l.tagNames;
  if (Array.isArray(t)) return t.map(String);
  return t ? String(t).split(/[,;|]/).map((s) => s.trim()).filter(Boolean) : [];
};
const quoteShape = (q: any, submitted: string | null) => ({
  quoteId: String(q.id ?? ""), product: q.productName || "", premium: Number(q.premium || 0),
  carrier: q.carrierName || "", submitted: mdy(submitted), sold: !!q.sold,
});

async function loadFingerprints(supabase: any, A: string, err: (m: string) => void) {
  const out = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("az_customers").select("customer_id, policy_summary").eq("agency_id", A).range(from, from + 999);
    if (error) { err(`az_customers: ${error.message}`); break; }
    for (const r of data || []) out.set(r.customer_id, r.policy_summary);
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function saveFingerprints(supabase: any, A: string, rows: { id: string; fp: string }[], err: (m: string) => void) {
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("az_customers").upsert(rows.slice(i, i + 500).map((r) => ({ agency_id: A, customer_id: r.id, policy_summary: r.fp, seen_at: now })), { onConflict: "agency_id,customer_id" });
    if (error) { err(`az_customers save: ${error.message}`); break; }
  }
}

/** One page of the one-time sweep: every customer's policies, adding sold policies after the cutoff not yet recorded. */
async function sweep(supabase: any, A: string, cutoff: string, today: string, azUser: string, azPass: string) {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  const { data: st } = await supabase.from("az_sync_state").select("*").eq("agency_id", A).maybeSingle();
  if (st?.sweep_done) return json({ ok: true, done: true });
  const page = Number(st?.sweep_page || 0);
  const stats: Record<string, any> = { page, checked: 0, added: 0, errors: [] as string[] };
  const err = (m: string) => { if (stats.errors.length < 10) stats.errors.push(m); };
  const { data: logRow } = await supabase.from("sync_log").insert({ agency_id: A, source: "agencyzoom-sweep", status: "running" }).select().single();
  let done = false, complete = true;
  try {
    const { token } = await azLogin(azUser, azPass);
    const carriers: Record<string, string> = {};
    try { const cr = await az(token, "GET", "/v1/api/carriers"); for (const c of (Array.isArray(cr) ? cr : (cr.carriers || cr.data || []))) carriers[String(c.id)] = c.name || c.carrierName || ""; } catch (e) { err(`carriers: ${e}`); }
    const r = await az(token, "POST", "/v1/api/customers", { page, pageSize: 100, sort: "id", order: "desc" });
    const cs = r.customers || r.data || [];
    done = cs.length < 100;
    const fps: { id: string; fp: string }[] = [];
    for (const c of cs) {
      const cid = String(c.id);
      let pol: any;
      try { pol = await az(token, "GET", `/v1/api/customers/${cid}/policies`); } catch (e) { complete = false; if (String(e).includes("__TIME__")) break; err(`policies ${cid}: ${e}`); continue; }
      stats.checked++; fps.push({ id: cid, fp: String(c.policySummary ?? "") });
      for (const x of (Array.isArray(pol) ? pol : (pol.policies || pol.data || []))) {
        let sold = isoDate(x.soldDate);
        if (!sold || sold <= cutoff) continue;
        if (sold > today) sold = today;
        if (Number(x.status) === 0) continue; // cancelled
        const carrier = carriers[String(x.carrierId)] || x.carrierName || x.standardCarrierCode || null;
        const { data, error } = await supabase.from("daily_sales").upsert({
          agency_id: A, az_ref: `pol-${x.id}`, sale_date: sold, producer: (x.agentName || "").trim() || "Unassigned", client_name: personName(c),
          premium: Math.round(Number(x.premium || 0)) / 100, source: carrier ? (FAMILY_RX.test(carrier) ? "Farmers" : "Brokered") : null,
          carrier, policy_type: x.policyTypeName || null, customer_id: cid, confirmed: true,
        }, { onConflict: "agency_id,az_ref", ignoreDuplicates: true }).select("az_ref");
        if (error) err(`daily_sales pol-${x.id}: ${error.message}`); else if (data?.length) { stats.added++; (stats.addedRefs ||= []).push(`pol-${x.id}`); }
      }
    }
    await saveFingerprints(supabase, A, fps, err);
    // a page read only in part is read again next time (adding is idempotent)
    const next = complete ? page + 1 : page;
    done = done && complete;
    await supabase.from("az_sync_state").upsert({
      agency_id: A, sweep_page: done ? page : next, sweep_done: done, sweep_added: Number(st?.sweep_added || 0) + stats.added,
      sweep_started_at: st?.sweep_started_at || new Date().toISOString(), sweep_finished_at: done ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
    }, { onConflict: "agency_id" });
    stats.done = done; stats.calls = calls;
    await supabase.from("sync_log").update({ status: "success", finished_at: new Date().toISOString(), records_pulled: stats.added, details: stats }).eq("id", logRow.id);
    return json({ ok: true, ...stats });
  } catch (e) {
    stats.fatal = String((e as any)?.message || e);
    await supabase.from("sync_log").update({ status: "error", finished_at: new Date().toISOString(), details: stats }).eq("id", logRow.id);
    return json({ ok: false, ...stats }, 500);
  }
}

/** AgencyZoom's sales dashboard for one day: the agency's totals and each producer's. */
async function dashDay(token: string, names: Record<string, string>, day: string) {
  const dash = await az(token, "POST", "/v1/api/dashboard-data/sales-data", { period: `${day}|${day}` });
  const row = (agent: string, a: any) => ({ day, agent, premium: Number(a?.monthlyPremium || 0), policies: Number(a?.monthlyPolicies || 0), items: Number(a?.monthlyItems || 0) });
  const out = [row("(agency)", dash.agency)];
  for (const a of (dash.agents || [])) if (Number(a.monthlyPremium) || Number(a.monthlyPolicies)) out.push(row(names[String(a.agentId)] || String(a.agentId), a));
  return out;
}
async function employeeNames(token: string) {
  const emp = await az(token, "GET", "/v1/api/employees");
  const names: Record<string, string> = {};
  for (const e of (Array.isArray(emp) ? emp : (emp.employees || emp.data || []))) names[String(e.id)] = [e.firstname, e.lastname].filter(Boolean).join(" ");
  return names;
}
/** Replaces the stored totals for a day (a producer with nothing that day has no row). */
async function saveDay(supabase: any, A: string, day: string, rows: { day: string; agent: string; premium: number; policies: number; items: number }[]) {
  const del = await supabase.from("az_sales_daily").delete().eq("agency_id", A).eq("day", day);
  if (del.error) throw new Error(`az_sales_daily ${day}: ${del.error.message}`);
  const ins = await supabase.from("az_sales_daily").insert(rows.map((r) => ({ agency_id: A, ...r, pulled_at: new Date().toISOString() })));
  if (ins.error) throw new Error(`az_sales_daily ${day}: ${ins.error.message}`);
}

/** The history backfill: day by day from 2025-01-01 (or where it stopped) through yesterday, as time allows. */
async function history(supabase: any, A: string, today: string, azUser: string, azPass: string, params: any) {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  const { token } = await azLogin(azUser, azPass);
  const names = await employeeNames(token);
  if (params.dry) {
    const out: any[] = [];
    for (let d = isoDate(params.from) || today; d <= (isoDate(params.to) || d); d = addDays(d, 1)) out.push(...await dashDay(token, names, d));
    return json({ ok: true, dry: true, rows: out, calls });
  }
  const { data: st } = await supabase.from("az_sync_state").select("history_through").eq("agency_id", A).maybeSingle();
  const last = addDays(today, -1);
  let d = st?.history_through ? addDays(st.history_through, 1) : (isoDate(params.from) || "2025-01-01");
  let through = st?.history_through || null, days = 0, error = "";
  while (d <= last) {
    try { await saveDay(supabase, A, d, await dashDay(token, names, d)); } catch (e) { if (!String(e).includes("__TIME__")) error = String(e).slice(0, 300); break; }
    through = d; days++; d = addDays(d, 1);
  }
  const done = !!through && through >= last;
  await supabase.from("az_sync_state").upsert({ agency_id: A, history_through: through, history_done: done, updated_at: new Date().toISOString() }, { onConflict: "agency_id" });
  return json({ ok: !error, days, through, done, error, calls });
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  t0 = Date.now(); lastCall = 0; calls = 0; outOfTime = false;
  const params = await req.json().catch(() => ({}));
  const today = pacificISO(new Date());
  const end = isoDate(params.end) || today;
  const start = isoDate(params.start) || addDays(end, -2);
  const parts: string[] = Array.isArray(params.parts) ? params.parts : ["sold", "quotes", "sdr"];

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const azUser = Deno.env.get("AGENCYZOOM_USERNAME"), azPass = Deno.env.get("AGENCYZOOM_PASSWORD");
  if (!azUser || !azPass) return new Response(JSON.stringify({ ok: false, error: "AgencyZoom secrets not set" }), { status: 500 });

  const { data: agency, error: agErr } = await supabase.from("agencies").select("id, history_cutoff").eq("agencyzoom_sync", true).maybeSingle();
  if (agErr || !agency) return new Response(JSON.stringify({ ok: false, error: "No agency is set up for the AgencyZoom sync" }), { status: 500 });
  const A = agency.id as string;
  const cutoff = String(agency.history_cutoff || "0000-00-00");
  if (params.sweep) return await sweep(supabase, A, cutoff, today, azUser, azPass);
  if (params.history) {
    try { return await history(supabase, A, today, azUser, azPass, params); }
    catch (e) { return new Response(JSON.stringify({ ok: false, error: String((e as any)?.message || e) }), { status: 500 }); }
  }
  const { data: logRow } = await supabase.from("sync_log").insert({ agency_id: A, source: "agencyzoom", status: "running" }).select().single();
  const stats: Record<string, any> = { window: { start, end }, parts, errors: [] as string[] };
  const err = (m: string) => { if (stats.errors.length < 10) stats.errors.push(m); };

  try {
    const { token, ownerAgent } = await azLogin(azUser, azPass);
    stats.ownerAgent = ownerAgent;

    // ---------------- SOLD -> daily_sales (one row per written policy) -----------
    // Source of truth is the policy record itself (customer -> policies): it
    // carries soldDate, the credited producer (agentName), line and premium,
    // and matches AgencyZoom's own sales dashboard. Customers to check:
    //   - customers created in the window (new business)
    //   - customers behind leads marked Won in the window (cross-sells)
    if (parts.includes("sold")) {
      const carriers: Record<string, string> = {};
      try {
        const cr = await az(token, "GET", "/v1/api/carriers");
        for (const c of (Array.isArray(cr) ? cr : (cr.carriers || cr.data || []))) carriers[String(c.id)] = c.name || c.carrierName || "";
      } catch (e) { err(`carriers: ${e}`); }

      const custIds = new Map<string, string>(); // id -> display name
      const custTs = new Map<string, string>();  // id -> a UTC timestamp for the sale (to fix the day)
      for (let page = 0; page < 10; page++) {
        const r = await az(token, "POST", "/v1/api/customers", { startDate: addDays(start, -1), endDate: addDays(end, 1), page, pageSize: 100, sort: "id", order: "desc" });
        const cs = r.customers || r.data || [];
        for (const c of cs) { custIds.set(String(c.id), personName(c)); if (c.createDate) custTs.set(String(c.id), String(c.createDate)); }
        if (cs.length < 100) break;
      }
      stats.newCustomers = custIds.size;
      const soldById = new Map<string, any>();
      const ranges = start.slice(0, 7) < today.slice(0, 7) ? ["mtd", "lastmonth"] : ["mtd"];
      for (const r of ranges) for (const l of await leadsList(token, { status: 2, soldPeriod: r })) if (l.id) soldById.set(String(l.id), l);
      // Lead source of each converted customer, from the won lead (latest win when a household has several).
      // Customers who never came through a won lead keep no source rather than a guessed one.
      const custSource = new Map<string, { source: string; sold: string }>();
      for (const l of soldById.values()) {
        const src = String(l.leadSourceName || "").trim();
        if (!l.convertedHouseholdId || !src) continue;
        const cid = String(l.convertedHouseholdId), sold = isoDate(l.soldDate) || "";
        const prev = custSource.get(cid);
        if (!prev || sold > prev.sold) custSource.set(cid, { source: src, sold });
      }
      let wonInWindow = 0;
      for (const l of soldById.values()) {
        const d = isoDate(l.soldDate);
        if (d && d >= addDays(start, -1) && d <= addDays(end, 1) && l.convertedHouseholdId) {
          wonInWindow++;
          const cid = String(l.convertedHouseholdId);
          if (!custIds.has(cid)) custIds.set(cid, personName(l));
          if (!custTs.has(cid) && pacificDay(l.soldDate)) custTs.set(cid, String(l.soldDate));
        }
      }
      // Customers whose policy list changed since the last run: a policy added to an existing customer, with no new
      // customer and no won lead to find it by. The customer list carries each customer's policy summary (one entry
      // per policy); the last one seen is kept in az_customers. Their existing rows are left as they are (only new
      // policies are added), since those rows' days may already have been corrected to Pacific time.
      const knownFp = await loadFingerprints(supabase, A, err);
      const baseline = knownFp.size === 0; // first run: remember the summaries, nothing to compare yet
      const seenFp: { id: string; fp: string }[] = [], changed = new Set<string>(), insertOnly = new Set<string>();
      for (let page = 0; page < 60; page++) {
        let r: any;
        try { r = await az(token, "POST", "/v1/api/customers", { page, pageSize: 100, sort: "id", order: "desc" }); }
        catch (e) { if (!String(e).includes("__TIME__")) err(`customer list: ${e}`); break; }
        const cs = r.customers || r.data || [];
        for (const c of cs) {
          const id = String(c.id), fp = String(c.policySummary ?? "");
          seenFp.push({ id, fp });
          if (baseline || knownFp.get(id) === fp) continue;
          changed.add(id);
          if (!custIds.has(id)) { custIds.set(id, personName(c)); insertOnly.add(id); }
        }
        if (cs.length < 100) break;
      }
      stats.customersListed = seenFp.length; stats.policyListChanged = changed.size;
      const checkedIds = new Set<string>();
      stats.wonLeadsInWindow = wonInWindow; stats.customersChecked = 0; stats.soldRows = 0;
      const synced: Record<string, number> = {};
      for (const [cid, cname] of custIds) {
        let pol: any;
        try { pol = await az(token, "GET", `/v1/api/customers/${cid}/policies`); } catch (e) { if (String(e).includes("__TIME__")) break; err(`policies ${cid}: ${e}`); continue; }
        stats.customersChecked++; checkedIds.add(cid);
        const list = Array.isArray(pol) ? pol : (pol.policies || pol.data || []);
        for (const x of list) {
          let sold = isoDate(x.soldDate);
          // soldDate is a UTC calendar day. When we have the matching UTC
          // timestamp (customer created / lead won the same UTC day), use its
          // Pacific day instead; otherwise never let a sale land after today.
          const ts = custTs.get(cid);
          if (sold && ts && isoDate(ts) === sold && pacificDay(ts)) sold = pacificDay(ts);
          if (sold && sold > today) sold = today;
          if (!sold || sold < start || sold > end || sold <= cutoff) continue;
          if (Number(x.status) === 0) continue; // cancelled
          const carrier = carriers[String(x.carrierId)] || x.carrierName || x.standardCarrierCode || null;
          const premium = Math.round(Number(x.premium || 0)) / 100; // AgencyZoom returns cents
          const producer = (x.agentName || "").trim() || "Unassigned";
          const { error } = await supabase.from("daily_sales").upsert({
            agency_id: A, az_ref: `pol-${x.id}`, sale_date: sold, producer, client_name: cname,
            premium, source: carrier ? (FAMILY_RX.test(carrier) ? "Farmers" : "Brokered") : null,
            carrier, policy_type: x.policyTypeName || null, customer_id: String(cid), confirmed: true,
            // only when known, so a later run without the won lead in view never blanks a captured source
            ...(custSource.has(cid) ? { lead_source: custSource.get(cid)!.source } : {}),
          }, { onConflict: "agency_id,az_ref", ignoreDuplicates: insertOnly.has(cid) });
          if (error) err(`daily_sales pol-${x.id}: ${error.message}`); else { stats.soldRows++; synced[producer] = (synced[producer] || 0) + premium; }
        }
      }
      stats.syncedPremiumByProducer = synced;
      // remember the summaries seen, except a changed customer whose policies weren't read this time (so the next
      // run still sees the change)
      await saveFingerprints(supabase, A, seenFp.filter((x) => knownFp.get(x.id) !== x.fp && (!changed.has(x.id) || checkedIds.has(x.id))), err);

      // Cross-check against AgencyZoom's own sales totals for the same window.
      try {
        const names = await employeeNames(token);
        const dash = await az(token, "POST", "/v1/api/dashboard-data/sales-data", { period: `${start}|${end}` });
        const azTotals: Record<string, number> = {};
        for (const a of (dash.agents || [])) if (a.monthlyPremium) azTotals[names[String(a.agentId)] || String(a.agentId)] = a.monthlyPremium;
        stats.agencyZoomPremiumByProducer = azTotals;
        // AgencyZoom's own daily totals for the last week (late entries included), for the last-year comparison
        stats.historyDays = 0;
        for (let d = addDays(today, -6); d <= today; d = addDays(d, 1)) { await saveDay(supabase, A, d, await dashDay(token, names, d)); stats.historyDays++; }
      } catch (e) { if (!String(e).includes("__TIME__")) err(`dashboard: ${e}`); }
    }

    // ---------------- QUOTES -> quote_leads ---------------------------------------
    // One pull of every lead touched in the window feeds both quotes and SDR.
    let active: any[] = [];
    if ((parts.includes("quotes") || parts.includes("sdr")) && !outOfTime) {
      active = await leadsList(token, { lastActivityEarliestDate: start, lastActivityLatestDate: end });
      stats.activeLeads = active.length;
    }

    if (parts.includes("quotes") && !outOfTime) {
      // "Quoted" = still open (not sold/lost/expired) and carrying a quote.
      const quoted = active.filter((l) => ![2, 3, 5].includes(Number(l.status)) && (Number(l.quoted) > 0 || isoDate(l.quoteDate)));
      stats.quotedLeads = quoted.length; stats.quoteRows = 0; stats.quoteUnchanged = 0;
      for (const lead of quoted) {
        const leadId = String(lead.id || ""); if (!leadId) continue;
        // Adopt any historical row for this lead so it is updated, not duplicated.
        await supabase.from("quote_leads").update({ az_ref: leadId }).eq("agency_id", A).eq("lead_id", leadId).is("az_ref", null);
        const { data: existing } = await supabase.from("quote_leads").select("quoted_premium, quote_count").eq("agency_id", A).eq("az_ref", leadId).maybeSingle();
        const leadQuoted = Number(lead.quoted || lead.premium || 0);
        if (existing && existing.quote_count > 0 && leadQuoted && Number(existing.quoted_premium) === leadQuoted) { stats.quoteUnchanged++; continue; }
        let quotes: any[] = [];
        try { quotes = await leadQuotes(token, leadId); } catch (e) { if (String(e).includes("__TIME__")) break; err(`quotes ${leadId}: ${e}`); continue; }
        const firstQuote = pacificDay(lead.quoteDate) || isoDate(lead.quoteDate) || pacificDay(lead.enterStageDate) || isoDate(lead.enterStageDate) || pacificDay(lead.lastActivityDate) || isoDate(lead.lastActivityDate) || end;
        const shaped = quotes.map((q) => quoteShape(q, firstQuote));
        const total = shaped.reduce((s, q) => s + q.premium, 0) || leadQuoted;
        if (!total) continue; // definition: only leads with an actual quoted premium
        const sdr = tagList(lead).map((t) => SDR_TAGS[t]).filter(Boolean);
        const { error } = await supabase.from("quote_leads").upsert({
          agency_id: A, az_ref: leadId, lead_id: leadId, name: personName(lead), created_date: isoDate(lead.createDate) || firstQuote,
          producer: producerName(lead), pipeline: lead.workflowName || "Pipeline", lead_source: lead.leadSourceName || "",
          stage_entry: mdy(isoDate(lead.enterStageDate)), quoted_premium: total, sdr_tag: sdr[0] || "",
          quotes: shaped, quote_count: shaped.length || 1, quote_day: firstQuote,
          day_basis: isoDate(lead.quoteDate) ? "quote submission" : "entered Quoted",
          lines: [...new Set(shaped.map((q) => q.product).filter(Boolean))].join(", "),
          url: `https://app.agencyzoom.com/lead/index?id=${leadId}`,
        }, { onConflict: "agency_id,az_ref" });
        if (error) err(`quote_leads ${leadId}: ${error.message}`); else stats.quoteRows++;
      }
    }

    // ---------------- SDR transfers -> sdr_transfers -------------------------------
    if (parts.includes("sdr") && !outOfTime) {
      // New transfers: leads created in the window carrying an SDR transfer tag.
      const created = await leadsList(token, { startDate: start, endDate: end });
      const byId = new Map<string, any>();
      for (const l of [...created, ...active]) if (l.id) byId.set(String(l.id), l);
      const tagged = [...byId.values()].filter((l) => tagList(l).some((t) => SDR_TAGS[t]));
      stats.sdrTaggedSeen = tagged.length; stats.sdrRows = 0; stats.sdrSkippedPaidMonth = 0;
      // Months already paid out are never rewritten. Anything before the
      // earliest unpaid month counts as paid.
      const { data: periods } = await supabase.from("sdr_pay_periods").select("month, closed").eq("agency_id", A);
      const closed = new Set((periods || []).filter((p: any) => p.closed).map((p: any) => p.month));
      const openMonths = (periods || []).filter((p: any) => !p.closed).map((p: any) => p.month).sort();
      const earliestOpen = openMonths[0] || addDays(today.slice(0, 7) + "-01", -1).slice(0, 7);
      const known = new Set((periods || []).map((p: any) => p.month));
      const { data: cfg } = await supabase.from("sdr_config").select("qualified_transfer_bonus, bound_policy_bonus").eq("agency_id", A).order("id", { ascending: false }).limit(1).maybeSingle();
      for (const lead of tagged) {
        const leadId = String(lead.id);
        const sdrs = tagList(lead).map((t) => SDR_TAGS[t]).filter(Boolean);
        const transferDay = pacificDay(lead.createDate) || isoDate(lead.createDate) || end;
        const month = transferDay.slice(0, 7);
        if (closed.has(month) || month < earliestOpen) { stats.sdrSkippedPaidMonth++; continue; }
        if (!known.has(month)) {
          // First transfer of a new month: open its pay period (paid the 21st of the following month).
          const payDate = addDays(month + "-01", 40).slice(0, 7) + "-21";
          const label = new Date(month + "-15T12:00:00Z").toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
          await supabase.from("sdr_pay_periods").insert({ agency_id: A, month, pay_date: payDate, period_label: label, closed: false,
            qualified_transfer_bonus: cfg?.qualified_transfer_bonus ?? 15, bound_policy_bonus: cfg?.bound_policy_bonus ?? 35 });
          known.add(month);
        }
        const status = Number(lead.status);
        // Already qualified and nothing changed: no need to spend an AgencyZoom call.
        // (Re-read whenever the lead's quoted amount changed, e.g. a quote was added or edited.)
        const { data: prior } = await supabase.from("sdr_transfers").select("az_qualifies, status, az_quote_premium").eq("agency_id", A).eq("az_ref", leadId).maybeSingle();
        const statusNow = status === 2 ? "Sold" : status === 3 ? "Dead" : status === 5 ? "Expired" : "Open";
        const leadQuotedNow = Number(lead.quoted || lead.premium || 0);
        const sameQuote = !leadQuotedNow || Math.abs(leadQuotedNow - Number(prior?.az_quote_premium || 0)) < 0.5;
        if (prior && prior.az_qualifies && prior.status === statusNow && sameQuote) { stats.sdrUnchanged = (stats.sdrUnchanged || 0) + 1; continue; }
        let quotes: any[] = [];
        try { quotes = await leadQuotes(token, leadId); } catch (e) { if (String(e).includes("__TIME__")) break; err(`quotes ${leadId}: ${e}`); continue; }
        const shaped = quotes.map((q) => quoteShape(q, isoDate(lead.quoteDate)));
        const quotePrem = shaped.reduce((s, q) => s + q.premium, 0);
        const bound = status === 2;
        const statusText = statusNow;
        const { error } = await supabase.from("sdr_transfers").upsert({
          agency_id: A, az_ref: leadId, lead_id: leadId, sdr: sdrs.includes("Jackeline") ? "Jackeline" : sdrs[0],
          date_time: transferDay, month, client: personName(lead), producer: producerName(lead),
          csr: [lead.csrFirstname, lead.csrLastname].filter(Boolean).join(" "), lead_source: lead.leadSourceName || "",
          stage: lead.workflowStageName || "", status: statusText, loss_reason: "", action: statusText, outcome: statusText,
          az_in_pipeline: [0, 1, 4].includes(status), az_tagged: true, az_quote_premium: quotePrem,
          quote_count: shaped.length, quotes: shaped, az_qualifies: shaped.length > 0, bound, bound_via_ledger: false,
          bound_premium: shaped.filter((q) => q.sold).reduce((s, q) => s + q.premium, 0),
          tags: (sdrs.includes("Rhon") ? "R" : "") + (sdrs.includes("Jackeline") ? "J" : ""),
          url: `https://app.agencyzoom.com/lead/index?id=${leadId}`,
        }, { onConflict: "agency_id,az_ref" });
        if (error) err(`sdr_transfers ${leadId}: ${error.message}`); else stats.sdrRows++;
      }
    }

    stats.calls = calls; stats.truncated = outOfTime; stats.seconds = Math.round((Date.now() - t0) / 1000);
    await supabase.from("sync_log").update({
      status: outOfTime ? "partial" : "success", finished_at: new Date().toISOString(),
      records_pulled: (stats.soldRows || 0) + (stats.quoteRows || 0) + (stats.sdrRows || 0), details: stats,
    }).eq("id", logRow.id);
    return new Response(JSON.stringify({ ok: true, ...stats }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    const msg = String((e as any)?.message || e);
    stats.calls = calls; stats.fatal = msg;
    await supabase.from("sync_log").update({ status: msg.includes("__TIME__") ? "partial" : "error", finished_at: new Date().toISOString(), details: stats }).eq("id", logRow.id);
    return new Response(JSON.stringify({ ok: false, ...stats }), { status: 500 });
  }
});
