// Calls Claude for the document readers (commission plans, receipts) with the agency's API key, which is kept
// encrypted in the database (public.agency_ai_keys) and never sent to the browser.
// Body: { messages, max_tokens?, system? }  -> Claude's message response, unchanged.
//       { action: "status" }                -> { configured, model }
// Any active staff login may use it; the agency and its key come from the caller's login, not from the request.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return json({ error: "Not signed in" }, 401);
  const { data: rows, error } = await db.rpc("ai_key_for_user", { p_user: u.user.id });
  if (error) return json({ error: "Could not read the AI settings" }, 500);
  const k = (rows || [])[0] as { api_key: string; model: string } | undefined;
  const body = await req.json().catch(() => ({}));
  if (body.action === "status") return json({ configured: !!k, model: k?.model || null });
  if (!k) return json({ error: "No Claude API key is set up for this agency. An admin can add one in Settings › Commission Setup." }, 400);
  if (!Array.isArray(body.messages) || !body.messages.length) return json({ error: "messages is required" }, 400);

  try {
    const client = new Anthropic({ apiKey: k.api_key });
    const msg = await client.messages.create({
      model: k.model,
      // Room for the model's reasoning as well as the JSON it returns; capped so one call can't run up the bill.
      max_tokens: Math.min(16000, Math.max(4000, Number(body.max_tokens) || 0)),
      ...(typeof body.system === "string" ? { system: body.system } : {}),
      messages: body.messages,
    });
    return json(msg);
  } catch (e) {
    if (e instanceof Anthropic.APIError) return json({ error: e.message }, e.status || 502);
    return json({ error: String((e as Error)?.message || e) }, 502);
  }
});
