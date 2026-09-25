// Team & access: lets an owner/admin add staff logins, change roles and section access, turn
// people off, and set a temporary password, all from buttons in the app.
// Body: { action: "list" | "create" | "update" | "reset_password", ... }
// Everything is limited to the caller's own agency: this runs with the service role, which skips
// row-level security, so every staff_accounts read and write names the agency.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const ROLES = ["owner", "admin", "producer", "protege", "sdr", "csr"];
const SECTIONS = ["performance", "books", "resources", "work", "chat", "training", "proteges", "passwords", "hr"];

function cleanAccess(a: unknown) {
  const out: Record<string, boolean> = {};
  if (a && typeof a === "object") for (const k of SECTIONS) if (typeof (a as any)[k] === "boolean") out[k] = (a as any)[k];
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return json({ error: "Not signed in" }, 401);
  const { data: me } = await db.from("staff_accounts").select("role, active, agency_id").eq("user_id", u.user.id).maybeSingle();
  if (!me?.active || !["owner", "admin"].includes(me.role)) return json({ error: "Only an owner or admin can manage the team." }, 403);
  const A = me.agency_id as string;
  const isOwner = me.role === "owner";
  const body = await req.json().catch(() => ({}));

  try {
    if (body.action === "list") {
      const { data: staff, error } = await db.from("staff_accounts").select("*").eq("agency_id", A).order("display_name");
      if (error) throw error;
      const mine = new Set((staff || []).map((s) => s.user_id));
      const seen: Record<string, string | null> = {};
      for (let page = 1; page < 20; page++) {
        const { data } = await db.auth.admin.listUsers({ page, perPage: 200 });
        for (const x of data?.users || []) if (mine.has(x.id)) seen[x.id] = x.last_sign_in_at || null;
        if (!data || data.users.length < 200) break;
      }
      return json({ staff: (staff || []).map((s) => ({ ...s, last_sign_in_at: seen[s.user_id] ?? null })) });
    }

    if (body.action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      const name = String(body.display_name || "").trim();
      const role = String(body.role || "producer");
      const password = String(body.password || "");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email." }, 400);
      if (!name) return json({ error: "Enter the person's name." }, 400);
      if (!ROLES.includes(role)) return json({ error: "Pick a role." }, 400);
      if (role === "owner" && !isOwner) return json({ error: "Only an owner can add another owner." }, 403);
      if (password.length < 8) return json({ error: "The temporary password needs at least 8 characters." }, 400);
      const { data: made, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) return json({ error: /already/i.test(error.message) ? "That email already has a login." : error.message }, 400);
      const { error: e2 } = await db.from("staff_accounts").insert({
        agency_id: A, user_id: made.user!.id, display_name: name, role, email, active: true, must_change_password: true,
        producer_name: body.producer_name ? String(body.producer_name).trim() : null, access: cleanAccess(body.access),
      });
      if (e2) { await db.auth.admin.deleteUser(made.user!.id); throw e2; }
      return json({ ok: true, user_id: made.user!.id });
    }

    if (body.action === "update" || body.action === "reset_password") {
      const id = String(body.user_id || "");
      const { data: target } = await db.from("staff_accounts").select("*").eq("agency_id", A).eq("user_id", id).maybeSingle();
      if (!target) return json({ error: "That person isn't on the team." }, 404);
      if (target.role === "owner" && !isOwner) return json({ error: "Only an owner can change an owner's account." }, 403);

      if (body.action === "reset_password") {
        const password = String(body.password || "");
        if (password.length < 8) return json({ error: "The temporary password needs at least 8 characters." }, 400);
        const { error } = await db.auth.admin.updateUserById(id, { password });
        if (error) throw error;
        await db.from("staff_accounts").update({ must_change_password: true }).eq("agency_id", A).eq("user_id", id);
        return json({ ok: true });
      }

      const patch: Record<string, unknown> = {};
      if (typeof body.display_name === "string" && body.display_name.trim()) patch.display_name = body.display_name.trim();
      if ("producer_name" in body) patch.producer_name = body.producer_name ? String(body.producer_name).trim() : null;
      if ("access" in body) patch.access = cleanAccess(body.access);
      if (typeof body.role === "string") {
        if (!ROLES.includes(body.role)) return json({ error: "Pick a role." }, 400);
        if (id === u.user.id && body.role !== target.role) return json({ error: "You can't change your own role." }, 400);
        if (body.role === "owner" && !isOwner) return json({ error: "Only an owner can make someone an owner." }, 403);
        patch.role = body.role;
      }
      if (typeof body.active === "boolean") {
        if (id === u.user.id && !body.active) return json({ error: "You can't turn off your own login." }, 400);
        patch.active = body.active;
        const { error } = await db.auth.admin.updateUserById(id, { ban_duration: body.active ? "none" : "876000h" });
        if (error) throw error;
      }
      const { error } = await db.from("staff_accounts").update(patch).eq("agency_id", A).eq("user_id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
