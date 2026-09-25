// Staff-triggered "force refresh" of AgencyZoom data. Limited to 3 per rolling 24 hours per agency
// (enforced in the database by claim_force_refresh). Starts the same sync the hourly schedule runs and
// returns right away; the app watches sync_log for the finish.
// Only the agency the sync is set up for (agencies.agencyzoom_sync) can start it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!;
  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return json({ error: "Not signed in" }, 401);
  const { data: staff } = await db.from("staff_accounts").select("display_name, active, agency_id").eq("user_id", u.user.id).maybeSingle();
  if (!staff?.active) return json({ error: "Staff only" }, 403);
  const { data: agency } = await db.from("agencies").select("agencyzoom_sync").eq("id", staff.agency_id).maybeSingle();
  if (!agency?.agencyzoom_sync) return json({ error: "AgencyZoom isn't connected for this agency." }, 403);

  const { data: claim, error } = await db.rpc("claim_force_refresh", { p_user: u.user.id, p_name: staff.display_name });
  if (error) return json({ error: error.message }, 500);
  if (!claim?.ok) return json({ error: "limit", used: claim?.used, next_at: claim?.next_at }, 429);

  const run = fetch(url + "/functions/v1/agencyzoom-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-cron-secret": Deno.env.get("CRON_SECRET")! },
    body: "{}",
  }).then((r) => r.text()).catch((e) => console.error("sync failed", e));
  // Keep the sync call alive after we answer the browser.
  // @ts-ignore EdgeRuntime is provided by the Supabase runtime
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(run);
  return json({ ok: true, used: claim.used, left: 3 - claim.used, started_at: new Date().toISOString() });
});
