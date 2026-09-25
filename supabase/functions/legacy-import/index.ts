// One-time import of the legacy single-file dashboard's books, documents and reference data.
// Reads ONE pinned byte range of index.html from the ximenacruzru-maker/vid repo, checks every
// slice against a SHA-256 taken from the audited copy, then writes rows and uploads documents to
// the PRIVATE "documents" bucket. Safe to run repeatedly: rows upsert, uploads resume.
// Auth: x-cron-secret header (same secret the sync uses). Body: { "part": "data" | "docs" }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { transform } from "./transform.js";

const SRC = "https://raw.githubusercontent.com/ximenacruzru-maker/vid/main/index.html";
const RANGE = [7483689, 22534035];
const MANIFEST: Record<string, { start: number; end: number; json: boolean; sha256: string }> = {"DATA": {"start": 7483689, "end": 7928021, "json": true, "sha256": "b6bb5506d1c0a32e7037da2efa060aadc3c8a71adc4bb0dc52ae872125f48ceb"}, "CB_BINDERS": {"start": 7930325, "end": 11705598, "json": true, "sha256": "b39a49eb98c294082d54c00b15eace54e478c4d7077e5e1bdc68be534771b6dd"}, "RETAIL_DOCS": {"start": 12866321, "end": 16932999, "json": false, "sha256": "442d4b51de8a9200be139fa08229263e8032e5a78063f6d1a3a9568362c08c7c"}, "FARMERS_DECS": {"start": 11706441, "end": 12825999, "json": false, "sha256": "65dbf9aea5acacab203c330f83462439c3e7a7c4c6e3e304d2f43b81b818b608"}, "LICENSES": {"start": 16977871, "end": 18425284, "json": false, "sha256": "b40d36eb3c25c35beb21958c42004ee1e1484ed24fd3a017cf2716713f1691c6"}, "RESOURCES": {"start": 18955291, "end": 22070382, "json": true, "sha256": "be2f99642b66b406cd2b07cc9bef506342a430c85eb0011ea1299cd86bafe689"}, "MARKETS": {"start": 18510415, "end": 18832660, "json": false, "sha256": "067e120c9fc9c198144a9cef35e9f6b2ecc4121966b01585884ed9963a3ca582"}, "FARMERS_BI": {"start": 18862409, "end": 18955273, "json": true, "sha256": "3ef908062c4777ad2396752f2ddc3ccf7c4ddf2b013d81d13b21b86d01a94dff"}, "FARMERS_KB": {"start": 18473743, "end": 18478265, "json": false, "sha256": "e6c4a54544c75682dc658a1d9d57e8967cbf91ae342e4eaa8f705527727fae25"}, "PROTEGE": {"start": 22150483, "end": 22151754, "json": false, "sha256": "a5b29a8a22284dc04665c729b84d42ebc742c13796dae025529ab6df469f0b30"}, "PROTEGE_TRAINING": {"start": 22151779, "end": 22178336, "json": true, "sha256": "4e024afe4e9f5c1714e09017399f77136013f45dae0954d124752a7c29ab179c"}, "SYSTEMS": {"start": 22072556, "end": 22074003, "json": false, "sha256": "cbd221828045f1b5655b0ead6b78542f4d55411fc1aab6510efec1f131d7ab4f"}, "HR_STAFF": {"start": 18430004, "end": 18430526, "json": false, "sha256": "33d74900ca7383dec512d029d53f99ff4e740eb42cb1c88eb8269ea180c09f83"}, "HR_PUNCHES": {"start": 18430663, "end": 18431433, "json": false, "sha256": "31b41b855dbf2470416e6c8187dd6e6e836410e937b26b9d37f161458a78383f"}, "HUD": {"start": 22417473, "end": 22534035, "json": true, "sha256": "77bb83c2b37e225e680d95c7642997695481da2a0ae3c1e33f4a1e48683ffd8e"}, "RB": {"start": 12832249, "end": 12865965, "json": false, "sha256": "7744df8a00d837eb5cf5f675a2d6f05a4a80ac76febeb2ebcb80a8ab8843d27a"}};

async function sha(bytes: Uint8Array) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadLegacy() {
  const r = await fetch(SRC, { headers: { Range: `bytes=${RANGE[0]}-${RANGE[1] - 1}` } });
  if (r.status !== 206 && r.status !== 200) throw new Error("fetch " + r.status);
  let buf = new Uint8Array(await r.arrayBuffer());
  const base = r.status === 206 ? RANGE[0] : 0;
  const dec = new TextDecoder();
  const L: Record<string, unknown> = {};
  for (const [name, m] of Object.entries(MANIFEST)) {
    const slice = buf.subarray(m.start - base, m.end - base);
    if ((await sha(slice)) !== m.sha256) throw new Error("checksum mismatch for " + name + " — the source file changed");
    const src = dec.decode(slice);
    // Content is pinned by the checksum above, so evaluating the object literal is safe.
    L[name] = m.json ? JSON.parse(src) : new Function('"use strict";return (' + src + ");")();
  }
  buf = new Uint8Array(0);
  return L;
}

function b64ToBytes(uri: string) {
  const bin = atob(uri.slice(uri.indexOf(",") + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return new Response("forbidden", { status: 403 });
  const started = Date.now();
  const body = await req.json().catch(() => ({}));
  const part = body.part || "data";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const out: Record<string, unknown> = { part };
  // The source file is Ironwood's, so everything lands in Ironwood's agency (the service role skips
  // row-level security; rows must name their agency).
  const { data: ag } = await db.from("agencies").select("id").eq("slug", "ironwood").maybeSingle();
  if (!ag) return new Response(JSON.stringify({ ok: false, error: "No Ironwood agency" }), { status: 500 });
  const A = ag.id as string;
  try {
    const T = transform(await loadLegacy());
    const up = async (table: string, rows: any[], onConflict?: string) => {
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await db.from(table).upsert(rows.slice(i, i + 200).map((r) => ({ ...r, agency_id: A })), onConflict ? { onConflict } : undefined);
        if (error) throw new Error(table + ": " + error.message);
      }
      out[table] = rows.length;
    };
    const insertIfEmpty = async (table: string, rows: any[]) => {
      const { count } = await db.from(table).select("*", { count: "exact", head: true }).eq("agency_id", A);
      if (count) { out[table] = "kept " + count; return; }
      const { error } = await db.from(table).insert(rows.map((r) => ({ ...r, agency_id: A })));
      if (error) throw new Error(table + ": " + error.message);
      out[table] = rows.length;
    };
    if (part === "data") {
      await up("book_accounts", T.accounts);
      await up("book_policies", T.policies);
      await up("documents", T.documents.map(({ uri, ...d }: any) => d));
      await up("reference_data", T.reference);
      await up("hr_staff", T.hr_staff);
      await up("hr_punches", T.hr_punches, "agency_id,name,work_date");
      await insertIfEmpty("licenses", T.licenses);
      await insertIfEmpty("work_items", T.work_items);
      await insertIfEmpty("checklist_items", T.checklist_items);
    } else if (part === "docs") {
      const { data: pending } = await db.from("documents").select("id").eq("agency_id", A).eq("uploaded", false);
      const todo = new Set((pending || []).map((d: any) => d.id));
      let n = 0;
      for (const d of T.documents as any[]) {
        if (!todo.has(d.id)) continue;
        if (Date.now() - started > 110000) break;
        const { error } = await db.storage.from("documents").upload(d.storage_path, b64ToBytes(d.uri), { contentType: d.mime, upsert: true });
        if (error) throw new Error("upload " + d.id + ": " + error.message);
        await db.from("documents").update({ uploaded: true }).eq("agency_id", A).eq("id", d.id);
        n++;
      }
      out.uploaded = n;
      out.remaining = todo.size - n;
    }
    out.ms = Date.now() - started;
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    out.error = String(e);
    return new Response(JSON.stringify(out), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
