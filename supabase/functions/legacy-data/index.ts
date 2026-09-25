// One-time load of the original platform's report data (folios, huddle sheet, reports history, books
// snapshot, comp-plan seed, etc.) into admin-only reference_data rows (key "lg:<NAME>"), so the original
// Performance screens can run in the new app from the database instead of the old single file.
// Source pinned by SHA-256. Stored-credential blocks are not in the list and are never read.
// Large embedded files (data: URIs) are dropped; documents live in the private bucket.
// Writes to the Ironwood agency. Auth: x-cron-secret header. Body: { "from": 0, "to": 79 } to process a slice of the list.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SRC = "https://raw.githubusercontent.com/ximenacruzru-maker/vid/main/index.html";
const SHA = "1644e53a9ec22600e60583b85d72cf1d6891853311a4473c6a6fd55e8a6f52f7";
const MARK = "<script>\nconst DATA = ";
const LIST: [string, number, number][] = [["DATA",14,444346],["CB_BINDERS",446650,4221905],["FARMERS_DECS",4222748,5342306],["RB",5348556,5382270],["RETAIL_DOCS",5382626,9449304],["THEMES",9449542,9451421],["FONTS",9451437,9452395],["ACCESS",9452412,9452922],["SETTINGS",9452941,9453097],["INTEGRATIONS",9453120,9459093],["STATUS_LABEL",9459116,9459256],["CHART",9473151,9473212],["BOOK_TAB",9473302,9473365],["BOOK_NAME",9473385,9473454],["GOALS",9483921,9483969],["PERIODS",9483987,9484154],["LICENSES",9494138,10941551],["HR_STAFF",10946265,10946787],["HR_PUNCHES",10946924,10947694],["HR_EDITS",10947755,10947757],["HR_SYNC",10947876,10947878],["HR_TABS",10947966,10948096],["AI_CHIPS",10964289,10964721],["AI_CTX",10965548,10965563],["AI_LOG",10981938,10981940],["AI_TYPE_LABEL",10989066,10989224],["FARMERS_KB",10989901,10994415],["MARKETS",11026492,11348737],["FORESIGHT_PAID_DEFAULTS",11353218,11353492],["FARMERS_BI",11378425,11470653],["RESOURCES",11470671,14585754],["SYSTEMS",14587919,14589366],["DOC_TYPE_LABEL",14598370,14598477],["DOC_BOOK_LABEL",14598502,14598597],["SIGNED_IN",14607451,14607511],["WORK_STATUSES",14616054,14616104],["DASH_TONE",14633843,14633883],["PROTEGE",14665669,14666938],["PROTEGE_TRAINING",14666963,14693449],["REP_BOOKS",14711187,14711273],["METRIC_DEFS",14721725,14729993],["DASH_DEF_KEY",14730014,14730189],["DASH_SOURCE",14730209,14730691],["ANNUAL_SECTIONS",14736564,14737738],["ANNUAL_PERIODS",14737761,14737904],["COMM_METRICS",14753849,14753984],["COMM_SEED",14754004,14755666],["COMM_RESULTS",14761358,14761360],["SUB_PLANS",14842555,14843865],["FORESIGHT_PLANS",14843889,14844580],["TENURE_BANDS",14856468,14856722],["CHAT_CHANNELS",14859107,14859433],["DIALERS",14864961,14865791],["LEGAL_CATS",14868953,14869220],["REIMB_POLICY",14872611,14873064],["OWNER_IDENTITY",14892151,14892204],["ROLE_NAV",14892640,14893066],["TERMS_TEXT",14898394,14901591],["MAIL",14904027,14905267],["AZ",14908675,14909840],["AZ_FIELDS",14915449,14916176],["SALES_PERIODS",14927211,14927361],["HUD",14932149,15048711],["HUD_TABS",15048830,15048988],["AZ_REPORTS",15078517,15302384],["WB_DATA",15302908,15453931],["WB_EXTRA",15457138,15810473],["REPORT_TABS",15810547,15810955],["METRIC_ORDER",15811729,15811938],["METRIC_ICON",15811960,15812200],["METRIC_TONE",15812222,15812388],["EXEC_PROD_WINDOWS",15867514,15867680],["RB_LINES",15902939,15903262],["S",15908052,15908587],["BKT",15910152,15910370],["COI_DEFAULTS",15915511,15915847],["COMPLIANCE_2026",15954561,15956748],["AUTO_2026",15957230,15958569],["LIVE_FOLIO_ROWS",15974827,15974829]];

function strip(v: unknown): unknown {
  if (typeof v === "string") return v.startsWith("data:") && v.length > 2000 ? "" : v;
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === "object") { const o: Record<string, unknown> = {}; for (const [k, x] of Object.entries(v)) o[k] = strip(x); return o; }
  return v;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return new Response("forbidden", { status: 403 });
  const body = await req.json().catch(() => ({}));
  const from = body.from ?? 0, to = body.to ?? LIST.length;
  try {
    const r = await fetch(SRC);
    if (!r.ok) throw new Error("fetch " + r.status);
    const bytes = new Uint8Array(await r.arrayBuffer());
    const h = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (h !== SHA) throw new Error("source file changed; not loading");
    const html = new TextDecoder().decode(bytes);
    const st = html.indexOf(MARK) + "<script>".length;
    const code = html.slice(st, html.indexOf("</script>", st));
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // The source file is Ironwood's: every row is written to Ironwood's agency.
    const { data: ag } = await db.from("agencies").select("id").eq("slug", "ironwood").maybeSingle();
    if (!ag) throw new Error("No Ironwood agency");
    const done: string[] = [];
    let owner: unknown = null;
    for (const [name, i, e] of LIST.slice(from, to)) {
      const src = code.slice(i, e);
      // Pinned by the checksum above, so evaluating the object literal is safe.
      let v: unknown;
      try { v = JSON.parse(src); } catch { v = new Function('"use strict";return (' + src + ");")(); }
      v = strip(v);
      if (name === "DATA") {
        const c = (v as any).commercial?.[0];
        if (c) owner = { id: "owner-gas-stations", name: c.name, dba: c.dba, contact: c.contact, phone: c.phone, locations: 0, policies: 0, premium: 0 };
      }
      const { error } = await db.from("reference_data").upsert({ agency_id: ag.id, key: "lg:" + name, data: v, admin_only: true, updated_at: new Date().toISOString() });
      if (error) throw new Error(name + ": " + error.message);
      done.push(name);
    }
    if (owner) await db.from("reference_data").upsert({ agency_id: ag.id, key: "lg:CB_OWNER", data: owner, admin_only: true, updated_at: new Date().toISOString() });
    return new Response(JSON.stringify({ ok: true, count: done.length, done }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
