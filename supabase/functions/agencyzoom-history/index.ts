// Supabase Edge Function: agencyzoom-history
//
// Loads past sales from AgencyZoom for the owner's year-over-year view.
//   {"months":["2025-09", ...]}
//     every policy on customers created that month -> sales_history
// Only ever writes sales dated before HISTORY_BEFORE, where the reconciled
// folio export begins, so it can't touch anything commissions are paid from.
// Called by the database (x-cron-secret) or by a signed-in owner/admin of the agency the
// AgencyZoom login belongs to (agencies.agencyzoom_sync); rows are written to that agency.
//
// Secrets: AGENCYZOOM_USERNAME, AGENCYZOOM_PASSWORD, CRON_SECRET.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const AZ_BASE = "https://api.agencyzoom.com";
const HISTORY_BEFORE = "2025-12-19";
const PACE_MS = 800;
const TIME_BUDGET_MS = 130000;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

let t0 = Date.now(), lastCall = 0, calls = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const timeLeft = () => Date.now() - t0 < TIME_BUDGET_MS;
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monthEnd = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
function isoDate(s: any): string | null {
  if (!s) return null; const str = String(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}
const personName = (l: any) => {
  const biz = l.businessName || l.name || ""; const person = [l.firstname, l.lastname].filter(Boolean).join(" ").trim();
  return biz && person && biz !== person ? `${biz} (contact: ${person})` : (biz || person || "(no name)");
};

async function az(token: string, method: string, path: string, body?: unknown): Promise<any> {
  if (!timeLeft()) throw new Error("__TIME__");
  const wait = lastCall + PACE_MS - Date.now(); if (wait > 0) await sleep(wait);
  for (let attempt = 0; attempt < 2; attempt++) {
    lastCall = Date.now(); calls++;
    const res = await fetch(`${AZ_BASE}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 429 && attempt === 0) { await sleep(20000); continue; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`AgencyZoom ${path} failed (${res.status}): ${JSON.stringify(data).slice(0, 200)}`);
    return data;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: agency } = await supabase.from("agencies").select("id").eq("agencyzoom_sync", true).maybeSingle();
  if (!agency) return json({ error: "No agency is set up for the AgencyZoom sync" }, 500);
  const A = agency.id as string;
  const cron = Deno.env.get("CRON_SECRET");
  if (!(cron && req.headers.get("x-cron-secret") === cron)) {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await supabase.auth.getUser(token);
    if (!u?.user) return json({ error: "Not signed in" }, 401);
    const { data: me } = await supabase.from("staff_accounts").select("role, active, agency_id").eq("user_id", u.user.id).maybeSingle();
    if (!me?.active || !["owner", "admin"].includes(me.role)) return json({ error: "Owner or admin only" }, 403);
    if (me.agency_id !== A) return json({ error: "AgencyZoom isn't connected for this agency." }, 403);
  }
  t0 = Date.now(); lastCall = 0; calls = 0;
  const p = await req.json().catch(() => ({}));
  const months: string[] = (Array.isArray(p.months) ? p.months : []).filter((m: string) => /^\d{4}-\d{2}$/.test(m)).slice(0, 24);
  if (!months.length) return json({ error: "Pass months like [\"2025-09\"]" }, 400);

  const azUser = Deno.env.get("AGENCYZOOM_USERNAME"), azPass = Deno.env.get("AGENCYZOOM_PASSWORD");
  if (!azUser || !azPass) return json({ error: "AgencyZoom secrets not set" }, 500);
  const lr = await fetch(`${AZ_BASE}/v1/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: azUser, password: azPass }) });
  const lb = await lr.json().catch(() => ({}));
  const token = lb.jwt || lb.token || lb?.data?.token;
  if (!lr.ok || !token) return json({ error: "AgencyZoom login failed" }, 502);

  const out: Record<string, any> = { months: {}, errors: [] as string[] };
  const err = (m: string) => { if (out.errors.length < 12) out.errors.push(m); };
  try {
    const carriers: Record<string, string> = {};
    const cr = await az(token, "GET", "/v1/api/carriers");
    for (const c of (Array.isArray(cr) ? cr : (cr.carriers || cr.data || []))) carriers[String(c.id)] = c.name || c.carrierName || "";

    for (const m of months) {
      const start = `${m}-01`, end = monthEnd(m);
      const rec: Record<string, any> = {};
      if (start >= HISTORY_BEFORE) { rec.skipped = "already covered by the folio data"; out.months[m] = rec; continue; }
      const cust = new Map<string, string>();
      try {
        for (let page = 0; page < 10; page++) {
          const r = await az(token, "POST", "/v1/api/customers", { startDate: addDays(start, -1), endDate: addDays(end, 1), page, pageSize: 100, sort: "id", order: "desc" });
          const cs = r.customers || r.data || [];
          for (const c of cs) cust.set(String(c.id), personName(c));
          if (cs.length < 100) break;
        }
      } catch (e) { if (String(e).includes("__TIME__")) { rec.stopped = "time"; out.months[m] = rec; break; } err(`${m} customers: ${e}`); }
      let rows = 0, prem = 0, checked = 0;
      for (const [cid, cname] of cust) {
        let pol: any;
        try { pol = await az(token, "GET", `/v1/api/customers/${cid}/policies`); } catch (e) { if (String(e).includes("__TIME__")) { rec.stopped = "time"; break; } err(`${m} policies ${cid}: ${e}`); continue; }
        checked++;
        for (const x of (Array.isArray(pol) ? pol : (pol.policies || pol.data || []))) {
          const sold = isoDate(x.soldDate);
          if (!sold || sold < start || sold > end || sold >= HISTORY_BEFORE) continue;
          if (Number(x.status) === 0) continue;
          const premium = Math.round(Number(x.premium || 0)) / 100;
          const { error } = await supabase.from("sales_history").upsert({
            agency_id: A, az_ref: `pol-${x.id}`, sale_date: sold, producer: (x.agentName || "").trim() || "Unassigned", client: cname,
            line: x.policyTypeName || null, carrier: carriers[String(x.carrierId)] || x.carrierName || null, premium, customer_id: cid,
          }, { onConflict: "agency_id,az_ref" });
          if (error) err(`${m} save: ${error.message}`); else { rows++; prem += premium; }
        }
      }
      Object.assign(rec, { customers: cust.size, customersChecked: checked, policies: rows, premium: Math.round(prem) });
      out.months[m] = rec;
      if (rec.stopped) break;
    }
  } catch (e) { err(String(e)); }
  out.calls = calls; out.seconds = Math.round((Date.now() - t0) / 1000);
  return json(out);
});
