// Supabase Edge Function: commissions
//
// Computes producer commissions for one folio on the server, using the
// agency's comp plan stored in comp_plans (the plan in force on the folio's
// start date), and returns only what the signed-in person is allowed to see:
//   owner / admin      -> every producer (Office payroll is theirs alone)
//   commission sheet   -> every producer, for staff an admin switched "Commission sheet" on for (whoever runs payroll)
//   producer / protege -> only their own line
//   anyone else        -> nothing
// Doing this server-side is what keeps producers from seeing each other's pay.
//
// With { goal: { commission, life } } it also works out a producer's way to a commission goal for the folio (their own;
// an owner/admin can pass goal.producer): their commission so far, what it is once the life policies they plan to write
// are added (at their average life premium), how much more personal lines premium gets them to the goal under the plan
// (tiers and qualification included), and what that is in auto or home policies at their average premium over the
// last 12 months (the agency's average where they have too few to go on).

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
// ---------------- Year-End Life Promo (reference_data lg:LIFE_PROMO; same rules as src/lib/lifePromo.ts) -------
// A life policy written during the promo is paid a share of its premium set by the team's issued & paid count when
// it was written (the count on the start date plus every life policy written since, in date order), whether or not
// the producer qualifies, instead of its bucket's rate. It still counts toward qualification and the tier.
type Promo = { name: string; from: string; to: string; baseline: number; tiers: { after: number; rate: number }[] };
const isLife = (r: { line?: string; carrier?: string }) => /life/i.test(String(r.line || "")) || /life/i.test(String(r.carrier || ""));
const caseKey = (r: { sale_date: string; client: string; premium: number }) => `${r.sale_date}|${String(r.client || "").trim().toLowerCase()}|${Math.round(r.premium * 100)}`;
function promoCases(p: Promo, life: Row[]) {
  const tiers = [...p.tiers].sort((a, b) => a.after - b.after);
  const out = new Map<string, { n: number; rate: number }>();
  [...life].filter((r) => r.sale_date >= p.from && r.sale_date <= p.to)
    .sort((a, b) => a.sale_date.localeCompare(b.sale_date) || String(a.client).localeCompare(String(b.client)) || a.premium - b.premium)
    .forEach((r, i) => {
      const n = (Number(p.baseline) || 0) + i + 1;
      let rate = 0; for (const t of tiers) if (n > Number(t.after)) rate = Number(t.rate) || 0;
      out.set(caseKey(r), { n, rate });
    });
  return out;
}
type PromoRate = { label: string; cases: Map<string, { n: number; rate: number }> };

const test = (op: string, a: number, b: number) => op === ">=" ? a >= b : op === ">" ? a > b : op === "<=" ? a <= b : op === "<" ? a < b : a === b;

function compute(plan: any, rows: Row[], promo?: PromoRate) {
  const out: Record<string, any> = {};
  for (const r of rows) {
    const p = r.producer || "Unassigned";
    const res = out[p] ||= { producer: p, buckets: {}, life: 0, totalPremium: 0, policies: 0, rows: [] as any[], promo: 0 };
    for (const b of plan.buckets) res.buckets[b.key] ||= { key: b.key, label: b.label, premium: 0, commission: 0, rate: 0 };
    const b = bucketOf(plan, r);
    const pr = promo && isLife(r) ? promo.cases.get(caseKey(r)) : undefined;
    if (pr) {
      res.promo += r.premium * pr.rate;
      res.totalPremium += r.premium; res.policies++; res.life += lifeWeight(plan, r);
      res.rows.push({ ...r, bucket: `Life promo ${Math.round(pr.rate * 100)}% (case #${pr.n})` });
      continue;
    }
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
    if (res.promo) { res.bonuses[promo!.label] = res.promo; res.total += res.promo; }
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
  const { data: me } = await admin.from("staff_accounts").select("role, producer_name, active, agency_id, access").eq("user_id", u.user.id).maybeSingle();
  if (!me || !me.active) return json({ error: "Your login isn't set up as a staff account yet." }, 403);
  const body = await req.json().catch(() => ({}));
  const seesAll = me.role === "owner" || me.role === "admin" || (me.access && (me.access as Record<string, unknown>).commission_sheet === true);
  // an SDR on the path to producer who writes policies sees their own commission too
  if (!seesAll && !["producer", "protege", "sdr"].includes(me.role)) return json({ error: "Commissions aren't part of your role." }, 403);

  // The service role skips row-level security, so every read below is limited to the caller's agency.
  const A = me.agency_id as string;
  const { data: folio } = await admin.from("folios").select("*").eq("agency_id", A).eq("start_date", body.folio).maybeSingle();
  if (!folio) return json({ error: "Unknown folio." }, 400);
  const today = pacificToday();
  const end = folio.in_progress && folio.end_date > today ? today : folio.end_date;

  const { data: plans } = await admin.from("comp_plans").select("*").eq("agency_id", A).eq("status", "active").lte("effective_from", folio.start_date).order("effective_from", { ascending: false }).order("version", { ascending: false }).limit(1);
  let planRow = plans?.[0];
  if (!planRow) { const { data: any1 } = await admin.from("comp_plans").select("*").eq("agency_id", A).eq("status", "active").order("effective_from").limit(1); planRow = any1?.[0]; }
  if (!planRow) return json({ error: "No comp plan is set up." }, 400);

  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("policies_sold").select("client, carrier, line, premium, producer, sale_date")
      .eq("agency_id", A).gte("sale_date", folio.start_date).lte("sale_date", end).range(from, from + 999);
    if (error) return json({ error: error.message }, 500);
    for (const r of data || []) rows.push({ ...r, premium: Number(r.premium) || 0 } as Row);
    if (!data || data.length < 1000) break;
  }

  // the life promo numbers every life policy written during it, across all producers, so read them all from its start
  let promo: PromoRate | undefined;
  const { data: pref } = await admin.from("reference_data").select("data").eq("agency_id", A).eq("key", "lg:LIFE_PROMO").maybeSingle();
  const P = pref?.data as Promo | undefined;
  if (P && P.from && P.to && P.from <= end && P.to >= folio.start_date) {
    const life: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("policies_sold").select("client, carrier, line, premium, producer, sale_date")
        .eq("agency_id", A).gte("sale_date", P.from).lte("sale_date", end < P.to ? end : P.to)
        .or("line.ilike.%life%,carrier.ilike.%life%").range(from, from + 999);
      if (error) return json({ error: error.message }, 500);
      for (const r of data || []) life.push({ ...r, premium: Number(r.premium) || 0 } as Row);
      if (!data || data.length < 1000) break;
    }
    promo = { label: P.name || "Life promo", cases: promoCases(P, life) };
  }

  let results = compute(planRow.plan, rows, promo);
  // names compared tidied: AgencyZoom sometimes sends a double space ("Cindy  Ruiz")
  const tidy = (s: string) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
  if (!seesAll) results = results.filter((r: any) => tidy(r.producer) === tidy(me.producer_name));

  let goal: Record<string, unknown> | undefined;
  if (body.goal && Number(body.goal.commission) > 0) {
    const who = String((seesAll && body.goal.producer) || me.producer_name || "");
    if (!who) return json({ error: "Your login has no producer name, so there's no commission to plan for." }, 400);
    const target = Number(body.goal.commission), lifeN = Math.max(0, Math.min(50, Math.floor(Number(body.goal.life) || 0)));
    const mine = rows.filter((r) => tidy(r.producer) === tidy(who));
    // average premium per policy over the last 12 months: theirs, else the agency's (at least 3 policies to go on)
    const yearFrom = new Date(Date.parse(today + "T12:00:00Z") - 365 * 864e5).toISOString().slice(0, 10);
    const year: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("policies_sold").select("client, carrier, line, premium, producer, sale_date")
        .eq("agency_id", A).gte("sale_date", yearFrom).lte("sale_date", today).range(from, from + 999);
      if (error) return json({ error: error.message }, 500);
      for (const r of data || []) year.push({ ...r, premium: Number(r.premium) || 0 } as Row);
      if (!data || data.length < 1000) break;
    }
    const isAuto = (r: Row) => /auto/i.test(r.line || "") && !/commercial|business/i.test(r.line || "");
    const isHome = (r: Row) => /home|condo|dwelling|renter|landlord/i.test(r.line || "") && !/commercial|business/i.test(r.line || "");
    const avgOf = (test: (r: Row) => boolean) => {
      const m = year.filter((r) => tidy(r.producer) === tidy(who) && test(r) && r.premium > 0), a = year.filter((r) => test(r) && r.premium > 0);
      const use = m.length >= 3 ? m : a;
      return { avg: use.length ? use.reduce((t, r) => t + r.premium, 0) / use.length : 0, n: use.length, from: m.length >= 3 ? "yours" : "agency" };
    };
    const auto = avgOf(isAuto), home = avgOf(isHome), life = avgOf((r) => isLife(r));
    const lifeAvg = life.avg || 1000;
    // the planned life policies, written today; during the life promo they take the next case numbers
    const planned: Row[] = Array.from({ length: lifeN }, (_, i) => ({ client: `Planned life policy ${i + 1}`, carrier: "Farmers New World Life", line: "Life", premium: lifeAvg, producer: who, sale_date: today }));
    let goalPromo = promo;
    if (promo && P && today >= P.from && today <= P.to && planned.length) {
      const cases = new Map(promo.cases), tiers = [...P.tiers].sort((a, b) => a.after - b.after);
      planned.forEach((r, i) => { const n = (Number(P.baseline) || 0) + promo!.cases.size + i + 1; let rate = 0; for (const t of tiers) if (n > Number(t.after)) rate = Number(t.rate) || 0; cases.set(caseKey(r), { n, rate }); });
      goalPromo = { label: promo.label, cases };
    }
    const totalOf = (extra: Row[]) => (compute(planRow.plan, [...mine, ...extra], goalPromo).find((x: any) => tidy(x.producer) === tidy(who)) as any)?.total || 0;
    const autoLine = (() => { const c: Record<string, number> = {}; year.filter((r) => tidy(r.producer) === tidy(who) && isAuto(r)).forEach((r) => { c[r.line] = (c[r.line] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || "Standard Auto"; })();
    const more = (x: number) => totalOf([...planned, ...(x > 0 ? [{ client: "More personal lines", carrier: "Farmers", line: autoLine, premium: x, producer: who, sale_date: today }] : [])]);
    const current = totalOf([]), withLife = totalOf(planned);
    let need: number | null = 0;
    if (withLife < target) {
      let lo = 0, hi = 5000;
      while (more(hi) < target && hi < 5_000_000) hi *= 2;
      if (more(hi) < target) need = null;
      else { for (let i = 0; i < 40 && hi - lo > 1; i++) { const mid = (lo + hi) / 2; if (more(mid) >= target) hi = mid; else lo = mid; } need = Math.ceil(hi); }
    }
    const premiumSoFar = mine.reduce((t, r) => t + r.premium, 0);
    goal = {
      producer: who, commission: target, life: lifeN, current, withLife, premiumSoFar, policiesSoFar: mine.length,
      lifeAvg, lifeFrom: life.n ? life.from : "estimate", needPremium: need,
      auto: { avg: auto.avg, from: auto.from, policies: need && auto.avg ? Math.ceil(need / auto.avg) : 0 },
      home: { avg: home.avg, from: home.from, policies: need && home.avg ? Math.ceil(need / home.avg) : 0 },
    };
  }

  return json({
    folio: { ...folio, end },
    plan: { name: planRow.name, version: planRow.version, effective_from: planRow.effective_from, summary: summary(planRow.plan, planRow.name), buckets: planRow.plan.buckets.map((b: any) => ({ key: b.key, label: b.label })) },
    scope: seesAll ? "all" : "self",
    results,
    ...(goal ? { goal } : {}),
  });
});
