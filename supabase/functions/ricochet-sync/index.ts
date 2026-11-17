// Supabase Edge Function: ricochet-sync
//
// Reads Ricochet over its API and keeps, for Team Space and the Daily Huddle Report:
//   * ricochet_agents — each Ricochet user and their live status (On_Phone = on a call, Busy, Offline…) and since when
//   * ricochet_calls  — each call made or taken (who, when, inbound or outbound, the queue), one row per call
// Ricochet has no call-log endpoint, so the calls come from the leads, newest-called first: each lead lists the calls
// on it (`actions`, outbound_call / incoming_call, with the user and the time). Reading stops at the first lead last
// called before the day asked for. Ricochet keeps only a lead's most recent actions, so the sync runs every minute and
// every call is kept the first time it's seen. No phone numbers or client names are stored.
//
// Called every minute in office hours by the ricochet-sync cron job, with the agency's hook token (ricochet_hooks) in
// x-cron-secret; ricochet_hooks.api_base is the agency's Ricochet address. The API token is the edge function secret
// richochet_api_token, sent as X-Auth-Token. Body (optional): { "from": "YYYY-MM-DD" } to also read earlier days.
// Deployed with verify_jwt off: the cron job has no Supabase login, so the hook token is the credential.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TZ = "America/Los_Angeles";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const token = () => ["richochet_api_token", "RICHOCHET_API_TOKEN", "ricochet_api_token", "RICOCHET_API_TOKEN"].map((n) => Deno.env.get(n)).find((v) => v && v.trim())?.trim() || "";
const pacificDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
/** "11/17/2026 08:49:38 AM" (Ricochet's time, Pacific) → "2026-11-17T08:49:38" */
const local = (s: unknown) => {
  const m = /^(\d\d)\/(\d\d)\/(\d{4}) (\d\d):(\d\d):(\d\d) (AM|PM)$/.exec(String(s || "").trim());
  if (!m) return null;
  let h = +m[4] % 12; if (m[7] === "PM") h += 12;
  return `${m[3]}-${m[1]}-${m[2]}T${String(h).padStart(2, "0")}:${m[5]}:${m[6]}`;
};
/** a Pacific wall-clock time as an instant */
const utc = (wall: string) => {
  const guess = new Date(wall + "Z");
  const seen = new Date(guess.toLocaleString("en-US", { timeZone: TZ }));
  return new Date(guess.getTime() + (guess.getTime() - seen.getTime())).toISOString();
};

Deno.serve(async (req) => {
  const key = req.headers.get("x-cron-secret") || "";
  if (!key) return json({ ok: false, error: "missing key" }, 401);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: hook } = await db.from("ricochet_hooks").select("agency_id, api_base").eq("token", key).maybeSingle();
  if (!hook) return json({ ok: false, error: "unknown key" }, 401);
  if (!hook.api_base) return json({ ok: false, error: "no Ricochet address for this agency" }, 400);
  const tok = token();
  if (!tok) return json({ ok: false, error: "the richochet_api_token secret isn't set" }, 500);
  const A = hook.agency_id as string, base = String(hook.api_base).replace(/\/+$/, "");
  const body = await req.json().catch(() => ({}));
  const today = pacificDay();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(body?.from || "") && body.from < today ? body.from : today;
  const get = async (path: string) => {
    const r = await fetch(base + path, { headers: { Accept: "application/json", "X-Auth-Token": tok } });
    if (!r.ok) throw new Error(`Ricochet ${path.split("?")[0]}: ${r.status}`);
    return await r.json();
  };

  try {
    // the users and their live status
    const us = (await get("/api/v4/users"))?.data?.users || [];
    const names = new Map<number, string>();
    const now = Date.now();
    const agents = us.map((u: any) => {
      const name = String(u.name || [u.firstName, u.lastName].filter(Boolean).join(" ")).trim().replace(/\s+/g, " ");
      names.set(Number(u.id), name);
      const secs = Number(u.last_status_change_in_seconds);
      return { agency_id: A, user_id: Number(u.id), name, status: u.status || null, status_since: isFinite(secs) ? new Date(now - secs * 1000).toISOString() : null,
        role: u.roles?.[0]?.label || null, active: !!u.active && !u.deleted_at, updated_at: new Date().toISOString() };
    });
    if (agents.length) { const { error } = await db.from("ricochet_agents").upsert(agents, { onConflict: "agency_id,user_id" }); if (error) throw error; }

    // the calls: the leads called most recently first, until one was last called before `from`
    const calls = new Map<string, Record<string, unknown>>();
    let pages = 0;
    for (let page = 1; page <= 30; page++) {
      const leads = Object.values((await get(`/api/v4/leads?sort=last_called_at&order=desc&limit=200&page=${page}`))?.data?.leads || {}) as any[];
      pages++;
      // the page is sorted newest-called first: once its last dated lead is before `from`, nothing after it is newer
      // (a lead with no call date, e.g. one only called in, doesn't end the read)
      let lastDated: string | null = null;
      for (const l of leads) {
        const last = local(l.last_called_at);
        if (last) lastDated = last;
        if (!last || last.slice(0, 10) < from) continue;
        for (const a of (l.actions || []) as any[]) {
          if (a.action_type !== "outbound_call" && a.action_type !== "incoming_call") continue;
          const at = local(a.created_at);
          if (!at || at.slice(0, 10) < from) continue;
          const uid = a.user_id == null ? null : Number(a.user_id);
          const call_id = `api:${a.lead_id ?? l.id}:${uid ?? 0}:${at}`;
          calls.set(call_id, {
            agency_id: A, call_id, day: at.slice(0, 10), started_at: utc(at), agent: uid != null ? names.get(uid) || `Ricochet user ${uid}` : "Unassigned",
            ricochet_user_id: uid, direction: a.action_type === "incoming_call" ? "inbound" : "outbound", call_type: a.data?.call_type || null,
            lead_id: String(a.lead_id ?? l.id), source: "api", raw: { call_type: a.data?.call_type || null },
          });
        }
      }
      if (!leads.length || (lastDated && lastDated.slice(0, 10) < from)) break;
    }
    const rows = [...calls.values()];
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from("ricochet_calls").upsert(rows.slice(i, i + 500), { onConflict: "agency_id,call_id" });
      if (error) throw error;
    }
    return json({ ok: true, from, agents: agents.length, onCall: agents.filter((x: any) => /on.?phone|on.?call/i.test(x.status || "")).length, calls: rows.length, pages });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message || String(e) }, 502);
  }
});
