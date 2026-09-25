// The commission rules engine from the original screens (engine.js "commission rules engine"). Every
// folio is calculated under the plan in force on its first day. Plans and carrier-statement exclusions
// are kept in this browser (the same localStorage keys the original screens use), so both read the same.
import type { FolioRow, Json, PerfData } from './data'
import { wbFolioKeys } from './data'

const COMM_KEY = 'vidura_comm_plans_v1'
const RECON_KEY = 'vidura_comm_recon_v1'

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
/** rows → results per producer. */
export function commCompute(plan: Json, rows: FolioRow[]) {
  const out: Record<string, Json> = {}
  rows.forEach((r) => {
    if (r.confirmed === false) return
    const p = r.producer || 'Unassigned'
    const res = (out[p] = out[p] || { producer: p, buckets: {}, life: 0, totalPremium: 0, policies: 0, rows: [] })
    plan.buckets.forEach((b: Json) => { res.buckets[b.key] = res.buckets[b.key] || { key: b.key, label: b.label, premium: 0, commission: 0, rate: 0 } })
    const b = commBucketOf(plan, r)
    res.buckets[b.key].premium += Number(r.premium) || 0
    res.totalPremium += Number(r.premium) || 0
    res.policies++
    res.life += commLifeWeight(plan, r)
    res.rows.push({ bucket: b.key, bucketLabel: b.label, ...r })
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
function reconNorm(s: string) {
  return String(s || '').toLowerCase().replace(/\b(llc|inc|corp|dba|the|and|&|co|company|mr|mrs|ms)\b/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}
function reconRowId(r: FolioRow) { return reconNorm(r.client) + '|' + reconNorm(r.line) + '|' + Math.round(Number(r.premium) || 0) }
function reconExcluded(k: string) {
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
export function commRecalc(D: PerfData) {
  D.COMM_RESULTS = {}
  D.WB_DATA.commissionsByFolio = D.WB_DATA.commissionsByFolio || {}
  wbFolioKeys(D).forEach((k) => {
    const f = D.WB_DATA.folio[k]; const plan = commPlanFor(D, f.start); const res = commCompute(plan, commFolioRows(D, k))
    D.COMM_RESULTS[k] = { plan, results: res }
    const legacy: Record<string, Json> = {}
    Object.entries(res).forEach(([p, r]) => { legacy[p] = commLegacy(plan, r) })
    D.WB_DATA.commissionsByFolio![k] = legacy
  })
}
