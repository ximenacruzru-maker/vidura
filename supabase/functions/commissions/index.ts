// Supabase Edge Function: commissions
//
// Computes producer commissions for one folio on the server, using the
// agency's comp plan stored in comp_plans (the plan in force on the folio's
// start date), and returns only what the signed-in person is allowed to see:
//   owner / admin      -> every producer
//   producer / protege -> only their own line
//   anyone else        -> nothing
// Doing this server-side is what keeps producers from seeing each other's pay.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Row = { client: string; carrier: string; line: string; premium: number; producer: string; sale_date: string };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function pacificToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// ---------------- comp-plan engine (same rules as the Setup screen) ----------
function bucketOf(plan: any, r: Row) {
  const car = String(r.carrier || "").toLowerCase(), line = String(r.line || "").toLowerCase();
  const hit = plan.buckets.find((b: any) => !b.isDefault && (
    (b.lines || []).some((l: string) => l && line === l.toLowerCase()) ||
    (b.carriers || []).some((c: string) => c && car.indexOf(c.toLowerCase()) >= 0)));
  return hit || plan.buckets.find((b: any) => b.isDefault) || plan.buckets[plan.buckets.length - 1];
}
function lifeWeight(plan: any, r: Row) {
  const line = String(r.line || "").toLowerCase();
  for (const x of plan.lifeRules || []) if (x.match && line.indexOf(String(x.match).toLowerCase()) >= 0) return Number(x.weight) || 1;
  return 0;
}
function metric(res: any, m: string) {
  if (m === "totalPremium") return res.totalPremium;
  if (m === "life") return res.life;
  if (m === "policies") return res.policies;
  if (m && m.startsWith("bucket:")) return res.buckets[m.slice(7)]?.premium || 0;
  return 0;
}
const test = (op: string, a: number, b: number) => op === ">=" ? a >= b : op === ">" ? a > b : op === "<=" ? a <= b : op === "<" ? a < b : a === b;

function compute(plan: any, rows: Row[]) {
  const out: Record<string, any> = {};
  for (const r of rows) {
    const p = r.producer || "Unassigned";
    const res = out[p] ||= { producer: p, buckets: {}, life: 0, totalPremium: 0, policies: 0, rows: [] as any[] };
    for (const b of plan.buckets) res.buckets[b.key] ||= { key: b.key, label: b.label, premium: 0, commission: 0, rate: 0 };
    const b = bucketOf(plan, r);
    res.buckets[b.key].premium += r.premium;
    res.totalPremium += r.premium;
    res.policies++;
    res.life += lifeWeight(plan, r);
    res.rows.push({ ...r, bucket: b.label });
  }
  for (const res of Object.values(out)) {
    const groups = plan.qualification?.groups || [];
    res.qualifies = !groups.length || groups.some((and: any[]) => and.every((c) => test(c.op || ">=", metric(res, c.metric), Number(c.value) || 0)));
    const basis = metric(res, plan.tierBasis || "totalPremium");
    res.tierRate = 0;
    for (const t of [...plan.tiers].sort((a: any, b: any) => a.min - b.min)) if (basis >= Number(t.min)) res.tierRate = Number(t.rate) || 0;
    res.total = 0; res.bonuses = {};
    for (const b of plan.buckets) {
      const x = res.buckets[b.key];
      const ok = res.qualifies || !b.requiresQualify;
      const rate = b.rateType === "flat" ? Number(b.flatRate) || 0 : res.tierRate * (Number(b.multiplier) || 0);
      x.rate = ok ? rate : 0; x.commission = ok ? x.premium * rate : 0; res.total += x.commission;
    }
    for (const bn of plan.bonuses || []) {
      const basisV = metric(res, bn.basis || "totalPremium");
      const ok = (res.qualifies || !bn.requiresQualify) && basisV >= (Number(bn.threshold) || 0);
      const amt = ok ? basisV * (Number(bn.rate) || 0) : 0;
      res.bonuses[bn.label || bn.key] = amt; res.total += amt;
    }
    const rule = (plan.splits?.rules || []).find((x: any) => x.producer && x.producer.toLowerCase() === res.producer.toLowerCase());
    res.splitShare = rule ? Number(rule.share) || 1 : plan.splits?.defaultShare || 1;
    if (res.splitShare !== 1) { res.totalBeforeSplit = res.total; res.total *= res.splitShare; }
    res.rows.sort((a: any, b: any) => b.sale_date.localeCompare(a.sale_date));
  }
  return Object.values(out).sort((a: any, b: any) => b.total - a.total || b.totalPremium - a.totalPremium);
}

function summary(plan: any, name: string) {
  const m = (v: number) => "$" + Math.round(v).toLocaleString("en-US");
  const p = (v: number) => Math.round(v * 1000) / 10 + "%";
  const labels: Record<string, string> = { totalPremium: "total premium", life: "life policies", policies: "policies" };
  const lab = (k: string) => k.startsWith("bucket:") ? (plan.buckets.find((b: any) => b.key === k.slice(7))?.label || k) + " premium" : labels[k] || k;
  const q = (plan.qualification?.groups || []).map((g: any[]) => g.map((c) => `${lab(c.metric)} ${c.op || ">="} ${c.metric === "life" || c.metric === "policies" ? c.value : m(c.value)}`).join(" and ")).join("; or ");
  const t = [...plan.tiers].sort((a: any, b: any) => a.min - b.min).map((x: any) => `${p(x.rate)} from ${m(x.min)}`).join(", ");
  const b = plan.buckets.map((x: any) => x.rateType === "flat" ? `${p(x.flatRate)} flat on ${x.label}` : `${x.multiplier === 1 ? "full" : p(x.multiplier) + " of the"} tier rate on ${x.label}`).join(", ");
  const bn = (plan.bonuses || []).map((x: any) => `+${p(x.rate)} ${String(x.label).toLowerCase()} over ${m(x.threshold)}`).join(", ");
  return `${name}: qualifies with ${q}. Tier: ${t}. ${b}${bn ? `. Bonus: ${bn}` : ""}.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u, error: ue } = await admin.auth.getUser(jwt);
  if (ue || !u?.user) return json({ error: "Please sign in again." }, 401);
  const { data: me } = await admin.from("staff_accounts").select("role, producer_name, active").eq("user_id", u.user.id).maybeSingle();
  if (!me || !me.active) return json({ error: "Your login isn't set up as a staff account yet." }, 403);
  const seesAll = me.role === "owner" || me.role === "admin";
  if (!seesAll && !["producer", "protege"].includes(me.role)) return json({ error: "Commissions aren't part of your role." }, 403);

  const body = await req.json().catch(() => ({}));
  const { data: folio } = await admin.from("folios").select("*").eq("start_date", body.folio).maybeSingle();
  if (!folio) return json({ error: "Unknown folio." }, 400);
  const today = pacificToday();
  const end = folio.in_progress && folio.end_date > today ? today : folio.end_date;

  const { data: plans } = await admin.from("comp_plans").select("*").eq("status", "active").lte("effective_from", folio.start_date).order("effective_from", { ascending: false }).order("version", { ascending: false }).limit(1);
  let planRow = plans?.[0];
  if (!planRow) { const { data: any1 } = await admin.from("comp_plans").select("*").eq("status", "active").order("effective_from").limit(1); planRow = any1?.[0]; }
  if (!planRow) return json({ error: "No comp plan is set up." }, 400);

  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("policies_sold").select("client, carrier, line, premium, producer, sale_date")
      .gte("sale_date", folio.start_date).lte("sale_date", end).range(from, from + 999);
    if (error) return json({ error: error.message }, 500);
    for (const r of data || []) rows.push({ ...r, premium: Number(r.premium) || 0 } as Row);
    if (!data || data.length < 1000) break;
  }

  let results = compute(planRow.plan, rows);
  if (!seesAll) results = results.filter((r: any) => r.producer.toLowerCase() === String(me.producer_name || "").toLowerCase());

  return json({
    folio: { ...folio, end },
    plan: { name: planRow.name, version: planRow.version, effective_from: planRow.effective_from, summary: summary(planRow.plan, planRow.name), buckets: planRow.plan.buckets.map((b: any) => ({ key: b.key, label: b.label })) },
    scope: seesAll ? "all" : "self",
    results,
  });
});
