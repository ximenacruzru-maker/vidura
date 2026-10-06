// Supabase Edge Function: agencyzoom-leads
//
// Keeps az_lead_history: every AgencyZoom lead created since Jan 1 of this year, with its producer, the day it was
// quoted, the day it was sold and its status (2 = won, 3 = lost, 5 = expired; anything else is still open). My Space
// measures each producer's closing rate from it: leads quoted since Jan 1 that were won ÷ leads quoted since Jan 1.
// Reads the lead list a page of 100 at a time (no per-lead calls), so a full pass is ~50 calls; scheduled hourly at :45
// on weekdays. Secrets: AGENCYZOOM_USERNAME, AGENCYZOOM_PASSWORD, CRON_SECRET.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const AZ = "https://api.agencyzoom.com";
const PACE_MS = 800, BUDGET_MS = 125000;
const iso = (s: unknown) => { const m = String(s || "").match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; };
const pacificToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
  const t0 = Date.now();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: agency } = await supabase.from("agencies").select("id").eq("agencyzoom_sync", true).maybeSingle();
  if (!agency) return new Response(JSON.stringify({ ok: false, error: "No agency is set up for the AgencyZoom sync" }), { status: 500 });
  const A = agency.id as string;
  const today = pacificToday(), from = today.slice(0, 4) + "-01-01";
  const stats: Record<string, unknown> = { from, pages: 0, leads: 0, quoted: 0, won: 0 };
  const { data: logRow } = await supabase.from("sync_log").insert({ agency_id: A, source: "agencyzoom-leads", status: "running" }).select().single();
  try {
    const lr = await fetch(`${AZ}/v1/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: Deno.env.get("AGENCYZOOM_USERNAME"), password: Deno.env.get("AGENCYZOOM_PASSWORD") }) });
    const lb = await lr.json().catch(() => ({}));
    if (!lr.ok) throw new Error(`AgencyZoom login failed (${lr.status}). Check the AgencyZoom username/password saved in Supabase (Edge Functions > Secrets).`);
    const h = { "Content-Type": "application/json", Authorization: `Bearer ${lb.jwt || lb.token}` };
    const rows: Record<string, unknown>[] = [];
    let complete = false;
    for (let page = 0; page < 150; page++) {
      if (Date.now() - t0 > BUDGET_MS) break;
      if (page) await new Promise((r) => setTimeout(r, PACE_MS));
      const r = await fetch(`${AZ}/v1/api/leads/list`, { method: "POST", headers: h, body: JSON.stringify({ startDate: from, endDate: today, page, pageSize: 100 }) });
      if (r.status === 429) { await new Promise((res) => setTimeout(res, 20000)); page--; continue; }
      const body = await r.json();
      if (!r.ok) throw new Error(`leads/list failed (${r.status})`);
      const leads = body.leads || body.data?.leads || [];
      stats.pages = page + 1;
      for (const l of leads) {
        if (!l.id) continue;
        rows.push({ agency_id: A, lead_id: String(l.id), producer: [l.assignToFirstname, l.assignToLastname].filter(Boolean).join(" ").trim() || "Unassigned",
          created_date: iso(l.createDate), quote_date: iso(l.quoteDate), sold_date: iso(l.soldDate), status: Number(l.status ?? 0),
          lead_source: l.leadSourceName || "", seen_at: new Date().toISOString() });
      }
      if (leads.length < 100) { complete = true; break; }
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("az_lead_history").upsert(rows.slice(i, i + 500), { onConflict: "agency_id,lead_id" });
      if (error) throw new Error(`az_lead_history: ${error.message}`);
    }
    stats.leads = rows.length; stats.complete = complete;
    stats.quoted = rows.filter((r) => r.quote_date).length; stats.won = rows.filter((r) => r.status === 2).length;
    stats.seconds = Math.round((Date.now() - t0) / 1000);
    await supabase.from("sync_log").update({ status: complete ? "success" : "partial", finished_at: new Date().toISOString(), records_pulled: rows.length, details: stats }).eq("id", logRow.id);
    return new Response(JSON.stringify({ ok: true, ...stats }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    stats.fatal = String((e as Error)?.message || e);
    await supabase.from("sync_log").update({ status: "error", finished_at: new Date().toISOString(), details: stats }).eq("id", logRow.id);
    return new Response(JSON.stringify({ ok: false, ...stats }), { status: 500 });
  }
});
