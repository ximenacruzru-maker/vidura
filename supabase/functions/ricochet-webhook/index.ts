// Supabase Edge Function: ricochet-webhook
//
// Receives Ricochet's call webhook and keeps each call in ricochet_calls, for the Daily Huddle Report's phone activity.
// Set up in Ricochet (Configuration > Posts > Webhooks): send method POST, content type application/json (or
// x-www-form-urlencoded), URL = this function's URL with ?key=<the agency's ricochet_hooks.token>, and in the Body tab
// the fields below, each set to the matching Call Field / Lead Field / User Field. Then Configuration > Event Actions >
// Call Events Action fires it on every call. Field names are matched loosely (case and punctuation don't matter, and
// common alternatives are accepted); whatever is sent is also kept as-is in `raw`.
// Deployed with verify_jwt off: Ricochet can't send a Supabase login, so the key in the URL is the credential.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FIELDS: Record<string, string[]> = {
  call_id: ["call_id", "callid", "call_uuid", "uniqueid", "unique_id", "call_sid", "id"],
  agent: ["agent", "agent_name", "user", "user_name", "username", "rep", "owner", "agent_full_name"],
  direction: ["direction", "call_direction", "call_type", "type"],
  phone: ["phone", "phone_number", "number", "lead_phone", "to", "from", "caller_id"],
  duration: ["duration", "call_duration", "length", "call_length", "seconds", "billsec"],
  talk: ["talk_time", "talktime", "talk_seconds", "talk_duration", "conversation_time"],
  disposition: ["disposition", "call_status", "status", "call_result", "result", "outcome", "lead_status"],
  started: ["started_at", "start_time", "call_start", "call_time", "call_date", "date", "datetime", "created_at", "timestamp"],
  lead_id: ["lead_id", "leadid", "lead"],
  first: ["first_name", "firstname", "first"],
  last: ["last_name", "lastname", "last"],
  lead_name: ["lead_name", "name", "full_name", "contact_name"],
  recording: ["recording_url", "recording", "recording_link", "call_recording"],
};
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
const pick = (body: Record<string, unknown>, f: string) => {
  const keys = new Map(Object.keys(body).map((k) => [norm(k), k]));
  for (const alt of FIELDS[f]) { const k = keys.get(norm(alt)); if (k != null && body[k] != null && String(body[k]).trim() !== "") return String(body[k]).trim(); }
  return null;
};
/** Seconds from "125", "125.4", "02:05" or "00:02:05". */
const secs = (v: string | null) => {
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v));
  const p = v.split(":").map(Number); if (p.some(isNaN)) return null;
  return p.reduce((a, x) => a * 60 + x, 0);
};
const pacificDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("x-webhook-key") || "";
  if (!key) return json({ ok: false, error: "missing key" }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: hook } = await supabase.from("ricochet_hooks").select("agency_id").eq("token", key).maybeSingle();
  if (!hook) return json({ ok: false, error: "unknown key" }, 401);

  // the call: JSON, a form post, or (for a GET test) the query string
  let body: Record<string, unknown> = {};
  const type = req.headers.get("content-type") || "";
  try {
    if (req.method === "GET") body = Object.fromEntries(url.searchParams);
    else if (type.includes("json")) body = await req.json();
    else { const t = await req.text(); body = t.trim().startsWith("{") ? JSON.parse(t) : Object.fromEntries(new URLSearchParams(t)); }
  } catch { return json({ ok: false, error: "could not read the body" }, 400); }
  delete body.key;
  if (Array.isArray(body)) return json({ ok: false, error: "send one call per request" }, 400);

  const startedRaw = pick(body, "started");
  const started = startedRaw ? new Date(/^\d{10}$/.test(startedRaw) ? Number(startedRaw) * 1000 : startedRaw) : null;
  const when = started && !isNaN(started.getTime()) ? started : new Date();
  const name = pick(body, "lead_name") || [pick(body, "first"), pick(body, "last")].filter(Boolean).join(" ") || null;
  const dir = (pick(body, "direction") || "").toLowerCase();
  const row = {
    agency_id: hook.agency_id, call_id: pick(body, "call_id"), day: pacificDay(when), started_at: started && !isNaN(started.getTime()) ? started.toISOString() : null,
    agent: pick(body, "agent"), direction: dir.startsWith("in") ? "inbound" : dir.startsWith("out") || dir === "" ? "outbound" : dir,
    phone: pick(body, "phone"), duration_sec: secs(pick(body, "duration")), talk_sec: secs(pick(body, "talk")), disposition: pick(body, "disposition"),
    lead_id: pick(body, "lead_id"), lead_name: name, recording_url: pick(body, "recording"), raw: body,
  };
  const q = row.call_id
    ? supabase.from("ricochet_calls").upsert(row, { onConflict: "agency_id,call_id" })
    : supabase.from("ricochet_calls").insert(row);
  const { error } = await q;
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true });
});
