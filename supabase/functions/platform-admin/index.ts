// Platform administration for the people who run Declara (listed in public.platform_admins), not agency owners.
// Body: { action: "list" } -> every agency with its staff count and owner logins
//       { action: "create", name, short_name?, owner_name, owner_email, password } -> a new agency, its standard
//         settings (public.agency_seed) and its owner login, who must choose their own password on first sign-in.
// Runs with the service role, so it checks the caller itself; a failed create removes whatever it had made.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").slice(0, 40);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return json({ error: "Not signed in" }, 401);
  const { data: admin } = await db.from("platform_admins").select("user_id").eq("user_id", u.user.id).maybeSingle();
  if (!admin) return json({ error: "Only a Declara platform admin can manage agencies." }, 403);
  const body = await req.json().catch(() => ({}));

  try {
    if (body.action === "list") {
      const { data: agencies, error } = await db.from("agencies").select("id, slug, name, short_name, is_demo, agencyzoom_sync, created_at").order("created_at");
      if (error) throw error;
      const { data: staff } = await db.from("staff_accounts").select("agency_id, role, email, display_name, active");
      return json({
        agencies: (agencies || []).map((a) => {
          const mine = (staff || []).filter((s) => s.agency_id === a.id);
          return { ...a, staff: mine.filter((s) => s.active).length, owners: mine.filter((s) => s.role === "owner").map((s) => ({ name: s.display_name, email: s.email })) };
        }),
      });
    }

    if (body.action === "create") {
      const name = String(body.name || "").trim();
      const short = String(body.short_name || "").trim() || null;
      const ownerName = String(body.owner_name || "").trim();
      const email = String(body.owner_email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (name.length < 3) return json({ error: "Enter the agency's name." }, 400);
      if (!ownerName) return json({ error: "Enter the owner's name." }, 400);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email for the owner." }, 400);
      if (password.length < 8) return json({ error: "The temporary password needs at least 8 characters." }, 400);

      // a unique slug from the name (northwind, northwind-2, ...)
      const base = slugify(name) || "agency";
      const { data: taken } = await db.from("agencies").select("slug").like("slug", base + "%");
      let slug = base;
      for (let i = 2; (taken || []).some((t) => t.slug === slug); i++) slug = `${base}-${i}`;

      const { data: ag, error: e1 } = await db.from("agencies").insert({ slug, name, short_name: short }).select("id").single();
      if (e1) throw e1;
      let userId: string | null = null;
      try {
        const { error: e2 } = await db.rpc("agency_seed", { p_agency: ag.id, p_owner: ownerName });
        if (e2) throw e2;
        const { data: made, error: e3 } = await db.auth.admin.createUser({ email, password, email_confirm: true });
        if (e3) throw new Error(/already/i.test(e3.message) ? "That email already has a Declara login." : e3.message);
        userId = made.user!.id;
        const { error: e4 } = await db.from("staff_accounts").insert({
          agency_id: ag.id, user_id: userId, display_name: ownerName, role: "owner", email, active: true, must_change_password: true, access: {},
        });
        if (e4) throw e4;
      } catch (e) {
        // undo: the owner login, the settings, the agency
        if (userId) await db.auth.admin.deleteUser(userId);
        await db.from("reference_data").delete().eq("agency_id", ag.id);
        await db.from("agencies").delete().eq("id", ag.id);
        throw e;
      }
      return json({ ok: true, agency: { id: ag.id, slug, name } });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
