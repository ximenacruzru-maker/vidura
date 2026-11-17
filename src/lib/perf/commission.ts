// The commission rules engine from the original screens (engine.js "commission rules engine"). Every
// folio is calculated under the plan in force on its first day. Plans and carrier-statement exclusions
// are kept in this browser (the same localStorage keys the original screens use), so both read the same.
import type { FolioRow, Json, PerfData } from './data'
import { wbFolioKeys } from './data'
import { isLife, promoRates } from '../lifePromo'

/** A life policy written during the Year-End Life Promo: its case number and rate (null for anything else). */
type PromoRate = (r: FolioRow) => { n: number; rate: number } | null
const mdyIso = (s: string) => { const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : String(s || '').slice(0, 10) }

const COMM_KEY = 'declara_comm_plans_v1'
const RECON_KEY = 'declara_comm_recon_v1'

function lsGet<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } }

function commStore(D: PerfData) {
  const st = lsGet<Json | null>(COMM_KEY, null)
  if (st && st.versions && st.versions.length) return st
  return { versions: [JSON.parse(JSON.stringify(D.COMM_SEED))], activeId: 'plan-seed' }
}
function commVersions(D: PerfData): Json[] {
  return commStore(D).versions.slice().sort((a: Json, b: Json) => (a.effectiveFrom || '').localeCompare(b.effectiveFrom || '') || a.version - b.version)
}
/** The plan in force on a date: the latest published version whose effective date is on or before it. */
export function commPlanFor(D: PerfData, dateIso: string): Json {
  const pub = commVersions(D).filter((v) => v.status !== 'draft' && v.status !== 'retired')
  let hit: Json | null = null
  pub.forEach((v) => { if ((v.effectiveFrom || '') <= dateIso) hit = v })
  return hit || pub[0] || D.COMM_SEED
}
function commBucketOf(plan: Json, row: Json) {
  const car = String(row.carrier || ''), line = String(row.line || row.policyType || '')
  const hit = plan.buckets.find((b: Json) => !b.isDefault && ((b.lines || []).some((l: string) => l && line.toLowerCase() === l.toLowerCase()) ||
    (b.carriers || []).some((c: string) => c && car.toLowerCase().indexOf(c.toLowerCase()) >= 0)))
  return hit || plan.buckets.find((b: Json) => b.isDefault) || plan.buckets[plan.buckets.length - 1]
}
function commLifeWeight(plan: Json, row: Json) {
  const line = String(row.line || row.policyType || '')
  for (const r of plan.lifeRules || []) { if (r.match && line.toLowerCase().indexOf(String(r.match).toLowerCase()) >= 0) return Number(r.weight) || 1 }
  return 0
}
function commMetric(res: Json, m: string) {
  if (m === 'totalPremium') return res.totalPremium
  if (m === 'life') return res.life
  if (m === 'policies') return res.policies
  if (m && m.indexOf('bucket:') === 0) { const b = res.buckets[m.slice(7)]; return b ? b.premium : 0 }
  return 0
}
function commTest(op: string, a: number, b: number) { return op === '>=' ? a >= b : op === '>' ? a > b : op === '<=' ? a <= b : op === '<' ? a < b : a === b }
function commQualifies(plan: Json, res: Json) {
  const g = (plan.qualification && plan.qualification.groups) || []
  if (!g.length) return true
  return g.some((and: Json[]) => and.every((c) => commTest(c.op || '>=', commMetric(res, c.metric), Number(c.value) || 0)))
}
function commTierRate(plan: Json, res: Json) {
  const basis = commMetric(res, plan.tierBasis || 'totalPremium')
  let rate = 0
  plan.tiers.slice().sort((a: Json, b: Json) => a.min - b.min).forEach((t: Json) => { if (basis >= Number(t.min)) rate = Number(t.rate) || 0 })
  return rate
}
function commSplitShare(plan: Json, producer: string) {
  const r = ((plan.splits || {}).rules || []).find((x: Json) => x.producer && x.producer.toLowerCase() === String(producer).toLowerCase())
  return r ? Number(r.share) || 1 : (plan.splits || {}).defaultShare || 1
}
/** rows → results per producer. A life policy written during the life promo is paid the promo rate on its premium
 *  (whether or not the producer qualifies) instead of its bucket's rate; it still counts toward qualification. */
export function commCompute(plan: Json, rows: FolioRow[], promo?: PromoRate) {
  const out: Record<string, Json> = {}
  rows.forEach((r) => {
    if (r.confirmed === false) return
    const p = r.producer || 'Unassigned'
    const res = (out[p] = out[p] || { producer: p, buckets: {}, life: 0, totalPremium: 0, policies: 0, rows: [], promo: 0 })
    plan.buckets.forEach((b: Json) => { res.buckets[b.key] = res.buckets[b.key] || { key: b.key, label: b.label, premium: 0, commission: 0, rate: 0 } })
    const pr = promo ? promo(r) : null
    const b = commBucketOf(plan, r)
    if (pr) res.promo += (Number(r.premium) || 0) * pr.rate
    else res.buckets[b.key].premium += Number(r.premium) || 0
    res.totalPremium += Number(r.premium) || 0
    res.policies++
    res.life += commLifeWeight(plan, r)
    res.rows.push(pr ? { bucket: 'lifePromo', bucketLabel: `Life promo ${Math.round(pr.rate * 100)}% (case #${pr.n})`, ...r } : { bucket: b.key, bucketLabel: b.label, ...r })
  })
  Object.values(out).forEach((res) => {
    res.qualifies = commQualifies(plan, res); res.tierRate = commTierRate(plan, res); res.bonuses = {}; res.total = 0
    plan.buckets.forEach((b: Json) => {
      const x = res.buckets[b.key]; const ok = res.qualifies || !b.requiresQualify
      const rate = b.rateType === 'flat' ? Number(b.flatRate) || 0 : res.tierRate * (Number(b.multiplier) || 0)
      x.rate = ok ? rate : 0; x.commission = ok ? x.premium * rate : 0; res.total += x.commission
    })
    ;(plan.bonuses || []).forEach((bn: Json) => {
      const basis = commMetric(res, bn.basis || 'totalPremium')
      const ok = (res.qualifies || !bn.requiresQualify) && basis >= (Number(bn.threshold) || 0)
      const amt = ok ? basis * (Number(bn.rate) || 0) : 0
      res.bonuses[bn.key] = amt; res.total += amt
    })
    if (res.promo) { res.bonuses.lifePromo = res.promo; res.total += res.promo }
    const share = commSplitShare(plan, res.producer); res.splitShare = share
    if (share !== 1) { res.totalBeforeSplit = res.total; res.total = res.total * share }
  })
  return out
}
/** The shape the older screens read (Farmers/Foremost, Other, Broker Fee, Accelerator); buckets map by role. */
function commLegacy(plan: Json, res: Json) {
  const bk = (k: string) => res.buckets[k] || { premium: 0, commission: 0 }
  const tierFull = plan.buckets.find((b: Json) => b.rateType === 'tier' && (Number(b.multiplier) || 0) >= 1 && !b.isDefault) || plan.buckets.find((b: Json) => b.rateType === 'tier' && !b.isDefault) || { key: '__' }
  const flat = plan.buckets.find((b: Json) => b.rateType === 'flat') || { key: '__' }
  const others = plan.buckets.filter((b: Json) => b.key !== tierFull.key && b.key !== flat.key)
  const sum = (arr: Json[], f: (x: Json) => number) => arr.reduce((a, b) => a + f(bk(b.key)), 0)
  return { totalPremium: res.totalPremium, lifePolicies: res.life, iulPolicies: 0, qualifies: res.qualifies, tierRate: res.tierRate, policies: res.policies,
    farmersForemostPrem: bk(tierFull.key).premium, otherPrem: sum(others, (x) => x.premium), brokerFeePrem: bk(flat.key).premium, unclassifiedExcluded: 0,
    commFarmersForemost: bk(tierFull.key).commission, commOther: sum(others, (x) => x.commission), commBrokerFee: bk(flat.key).commission,
    acceleratorBonus: Object.values(res.bonuses || {}).reduce((a: number, b: any) => a + b, 0), totalCommission: res.total }
}

/* ---------- carrier statement exclusions ---------- */
/** Uploaded carrier statements and the owner's pay / exclude decisions, per folio. */
export const reconStore = (): Record<string, Json> => lsGet<Record<string, Json>>(RECON_KEY, {})
export function reconSave(v: Record<string, Json>) { try { localStorage.setItem(RECON_KEY, JSON.stringify(v)) } catch { /* private mode */ } }
export function reconNorm(s: string) {
  return String(s || '').toLowerCase().replace(/\b(llc|inc|corp|dba|the|and|&|co|company|mr|mrs|ms)\b/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}
export function reconRowId(r: FolioRow) { return reconNorm(r.client) + '|' + reconNorm(r.line) + '|' + Math.round(Number(r.premium) || 0) }
export function reconExcluded(k: string) {
  const r = lsGet<Json>(RECON_KEY, {})[k]
  if (!r) return new Set<string>()
  return new Set(Object.entries(r.decisions || {}).filter(([, v]) => v === 'exclude').map(([id]) => id))
}
function commFolioRowsRaw(D: PerfData, k: string): FolioRow[] {
  const rep = D.AZ_REPORTS[k]
  if (!rep) return []
  return ([] as FolioRow[]).concat(...Object.values(rep.producerDetail || {}).map((p: any) => (p.rows || []).map((x: Json) => ({
    client: x.client, carrier: x.carrier, line: x.line, premium: x.premium, producer: x.producer, when: x.when, confirmed: true }))))
}
/** A folio's sales: the live rows where the sync rebuilt the folio, otherwise the saved rows with the owner's
 *  statement exclusions applied (the live rows are used as they come, as in the original screens). */
export function commFolioRows(D: PerfData, k: string): FolioRow[] {
  if (D.LIVE_FOLIO_ROWS[k]) return D.LIVE_FOLIO_ROWS[k].map((r) => ({ ...r }))
  const ex = reconExcluded(k)
  return commFolioRowsRaw(D, k).map((r) => (ex.has(reconRowId(r)) ? { ...r, confirmed: false, excludedReason: 'Not paid on carrier statement' } : r))
}
/** the life promo's rate for a row: it numbers every life policy written during it, across all producers and folios,
 *  in date order */
function promoFor(D: PerfData): PromoRate | undefined {
  const P = D.LIFE_PROMO
  const cases = P ? promoRates(P, wbFolioKeys(D).flatMap((k) => commFolioRows(D, k)).filter((r) => r.confirmed !== false && isLife(r))
    .map((r) => ({ date: mdyIso(r.when), client: r.client, premium: Number(r.premium) || 0 }))) : null
  return cases ? (r) => (r.confirmed !== false && isLife(r) ? cases.get({ date: mdyIso(r.when), client: r.client, premium: Number(r.premium) || 0 }) : null) : undefined
}

/** The folio in progress, projected to its last day for each producer — for a one-on-one: what they've written, their
 *  average day (the days so far without the largest and smallest; the plain average with only one or two days), the
 *  working days left, the projected premium, and the commission the plan would pay on it. The projected premium is
 *  added in the same mix of business they've written so far; life promo pay counts only on life policies already
 *  written, and projected business doesn't add life policies toward qualification. */
export function commProjection(D: PerfData, k: string, today: string) {
  const f = D.WB_DATA.folio[k]
  if (!f || !(f.start <= today && today <= f.end)) return null
  const plan = commPlanFor(D, f.start), promo = promoFor(D)
  const rows = commFolioRows(D, k).filter((r) => r.confirmed !== false)
  const sold = new Set(rows.map((r) => mdyIso(r.when)))
  const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5
  const iso = (n: number) => new Date(n * 864e5).toISOString().slice(0, 10)
  const days: string[] = []
  for (let n = day(f.start); n <= day(f.end); n++) { const d = iso(n), wd = new Date(n * 864e5).getUTCDay(); if ((wd !== 0 && wd !== 6) || sold.has(d)) days.push(d) }
  const endMdy = `${f.end.slice(5, 7)}/${f.end.slice(8, 10)}/${f.end.slice(0, 4)}`
  const tiers = [...(plan.tiers || [])].sort((a: Json, b: Json) => a.min - b.min)
  const people = [...new Set(rows.map((r) => r.producer || 'Unassigned'))]
  const out = people.map((p) => {
    const mine = rows.filter((r) => (r.producer || 'Unassigned') === p)
    const sums = new Map<string, number>(); mine.forEach((r) => { const d = mdyIso(r.when); sums.set(d, (sums.get(d) || 0) + (Number(r.premium) || 0)) })
    const happened = (d: string) => d < today || (d === today && sums.has(d))
    const vals = days.filter(happened).map((d) => sums.get(d) || 0), left = days.filter((d) => !happened(d)).length
    const mx = Math.max(...vals), mn = Math.min(...vals), mid = vals.filter((v) => v < mx && v > mn)
    const avg = mid.length ? mid.reduce((a, v) => a + v, 0) / mid.length : vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : 0
    const written = mine.reduce((a, r) => a + (Number(r.premium) || 0), 0), projPrem = written + avg * left
    // the range: every day left like their slowest day with sales (low) or their best day (high)
    // kept on either side of the average day (zero days pull the average below the slowest day with sales)
    const sold = vals.filter((v) => v > 0), lowDay = Math.min(sold.length ? Math.min(...sold) : 0, avg), highDay = Math.max(vals.length ? mx : 0, avg)
    const lowPrem = written + lowDay * left, highPrem = written + highDay * left
    // the rest of the folio in the same mix: a copy of each sale scaled to the extra premium, dated the folio's last day
    // (not a promo case), and a life copy doesn't count as another life policy
    const at = (target: number) => {
      const grow = written > 0 ? (target - written) / written : 0
      const extra = grow > 0 ? mine.map((r) => ({ ...r, client: 'Projected', when: endMdy, premium: (Number(r.premium) || 0) * grow, line: isLife(r) ? 'Projected (L)' : r.line })) : []
      return commCompute(plan, [...mine, ...extra], promo)[p]
    }
    const now = commCompute(plan, mine, promo)[p], proj = at(projPrem), lo = at(lowPrem), hi = at(highPrem)
    const next = tiers.find((t: Json) => Number(t.min) > proj.totalPremium)
    // the next bonus the projected premium doesn't reach yet (an accelerator over a threshold, say)
    const bonus = (plan.bonuses || []).filter((b: Json) => (b.basis || 'totalPremium') === 'totalPremium' && Number(b.threshold) > proj.totalPremium)
      .sort((a: Json, b: Json) => Number(a.threshold) - Number(b.threshold))[0]
    return { producer: p, written, avg, trimmed: mid.length > 0, left, projPrem, lowDay, highDay, lowPrem, highPrem, low: lo.total as number, high: hi.total as number, now: now.total as number, qualifiesNow: !!now.qualifies, projected: proj.total as number,
      qualifies: !!proj.qualifies, tierRate: Number(proj.tierRate) || 0, nextTier: next ? { rate: Number(next.rate), need: Number(next.min) - proj.totalPremium, min: Number(next.min) } : null,
      nextBonus: bonus ? { label: String(bonus.label || bonus.key), rate: Number(bonus.rate) || 0, need: Number(bonus.threshold) - proj.totalPremium, min: Number(bonus.threshold) } : null }
  }).sort((a, b) => b.projected - a.projected || b.projPrem - a.projPrem)
  return { start: f.start, end: f.end, days: days.length, left: days.filter((d) => !(d < today || (d === today && sold.has(d)))).length, plan, rows: out }
}

export function commRecalc(D: PerfData) {
  D.COMM_RESULTS = {}
  D.WB_DATA.commissionsByFolio = D.WB_DATA.commissionsByFolio || {}
  const P = D.LIFE_PROMO
  const promo = promoFor(D)
  wbFolioKeys(D).forEach((k) => {
    const f = D.WB_DATA.folio[k]; const base = commPlanFor(D, f.start); const res = commCompute(base, commFolioRows(D, k), promo)
    // the promo shows as its own column on folios that have any promo pay
    const plan = Object.values(res).some((x: Json) => x.promo) ? { ...base, bonuses: [...(base.bonuses || []), { key: 'lifePromo', label: P!.name }] } : base
    D.COMM_RESULTS[k] = { plan, results: res }
    const legacy: Record<string, Json> = {}
    Object.entries(res).forEach(([p, r]) => { legacy[p] = commLegacy(plan, r) })
    D.WB_DATA.commissionsByFolio![k] = legacy
  })
}
