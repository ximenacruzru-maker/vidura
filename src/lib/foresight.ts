// Vida Foresight: sales patterns, producer ranking and lead-spend analysis, computed only from what is on
// file — daily_sales (sold policies), lead_spend (what each source cost) and the AgencyZoom folio reports'
// premium by lead source (lg:AZ_REPORTS) for the months before lead source was captured on each sale.
import { supabase } from './supabase'
import { addDays } from './format'

export interface Sale { sale_date: string; premium: number; producer: string; lead_source: string | null }
export interface Spend { id: string; source: string; period_start: string; period_end: string; amount: number; notes: string | null }
/** Premium by lead source for one AgencyZoom folio, from the saved folio reports. */
export interface FolioSources { start: string; end: string; rows: { source: string; premium: number; policies: number }[] }
export interface ForesightData {
  sales: Sale[]; spend: Spend[]; folios: FolioSources[]
  /** False until the Vida Foresight migration has run: no lead source column, no lead_spend table. */
  hasLeadSource: boolean; hasSpendTable: boolean
}

/** Every row of a table, 1000 at a time, in a stable order so pages never overlap. */
async function pageAll<T>(table: string, cols: string, order: string[]): Promise<T[]> {
  let out: T[] = []
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(cols)
    for (const o of order) q = q.order(o, { nullsFirst: true })
    const { data, error } = await q.range(from, from + 999)
    if (error) throw error
    out = out.concat((data || []) as T[])
    if (!data || data.length < 1000) break
  }
  return out
}
/** A missing column or table, i.e. the migration hasn't been run on this database yet. */
const isMissing = (e: any) => ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(e?.code)

export async function loadForesight(): Promise<ForesightData> {
  const SALE_ORDER = ['sale_date', 'producer', 'client_name', 'premium', 'az_ref']
  type Raw = Sale & { az_ref: string | null }
  let hasLeadSource = true, hasSpendTable = true
  const salesQ = pageAll<Raw>('daily_sales', 'sale_date,premium,producer,lead_source,az_ref', SALE_ORDER).catch((e) => {
    if (!isMissing(e)) throw e
    hasLeadSource = false
    return pageAll<Raw>('daily_sales', 'sale_date,premium,producer,az_ref', SALE_ORDER)
  })
  const spendQ = pageAll<Spend>('lead_spend', 'id,source,period_start,period_end,amount,notes', ['period_start', 'id']).catch((e) => {
    if (!isMissing(e)) throw e
    hasSpendTable = false
    return [] as Spend[]
  })
  const [salesRaw, spend, reports] = await Promise.all([salesQ, spendQ, supabase.from('reference_data').select('data').eq('key', 'lg:AZ_REPORTS').maybeSingle()])
  if (reports.error) throw reports.error
  // Same rule as the Performance screens: synced sales are AgencyZoom policy records ("pol-…");
  // rows from the earlier lead-based sync were superseded by them. Rows with no az_ref are history.
  const sales = salesRaw.filter((r) => r.sale_date && (!r.az_ref || String(r.az_ref).startsWith('pol-')))
    .map((r) => ({ sale_date: String(r.sale_date).slice(0, 10), premium: Number(r.premium) || 0, producer: r.producer || 'Unassigned', lead_source: r.lead_source?.trim() || null }))
  return { sales, spend: spend.map((s) => ({ ...s, amount: Number(s.amount) || 0 })), folios: folioSources(reports.data?.data || {}), hasLeadSource, hasSpendTable }
}

/** Folio reports keyed by folio start; each runs to the day before the next folio (last one: 30 days). */
export function folioSources(reports: Record<string, any>): FolioSources[] {
  const keys = Object.keys(reports).sort()
  return keys.map((k, i) => ({
    start: k, end: keys[i + 1] ? addDays(keys[i + 1], -1) : addDays(k, 29),
    rows: ((reports[k] || {}).byLeadSource || []).map((l: any) => ({ source: String(l.label || '').trim() || 'Unknown', premium: Number(l.value) || 0, policies: Number(l.n) || 0 })),
  })).filter((f) => f.rows.length)
}

/* ---------- dates ---------- */
const dayMs = 86400000
const toDay = (iso: string) => Math.floor(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / dayMs)
const fromDay = (n: number) => new Date(n * dayMs).toISOString().slice(0, 10)
export const daysBetween = (a: string, b: string) => toDay(b) - toDay(a) + 1
export interface Window { from: string; to: string }

/* ---------- 1. day of week ---------- */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export interface WeekdayStat { day: string; dates: number; premium: number; policies: number; avgPremium: number; avgPolicies: number }
/** Average sold premium and policies per calendar day of each weekday, over the days in the window that
 *  have sales history (days with no sales count as zero, so a weekday isn't flattered by skipping them). */
export function weekdayPattern(sales: Sale[], w: Window): { stats: WeekdayStat[]; from: string; to: string } {
  const inWin = sales.filter((s) => s.sale_date >= w.from && s.sale_date <= w.to)
  const first = inWin.reduce((m, s) => (s.sale_date < m ? s.sale_date : m), w.to)
  const stats = WEEKDAYS.map((day) => ({ day, dates: 0, premium: 0, policies: 0, avgPremium: 0, avgPolicies: 0 }))
  const wd = (n: number) => (new Date(n * dayMs).getUTCDay() + 6) % 7
  if (!inWin.length) return { stats, from: w.from, to: w.to }
  for (let n = toDay(first); n <= toDay(w.to); n++) stats[wd(n)].dates++
  inWin.forEach((s) => { const x = stats[wd(toDay(s.sale_date))]; x.premium += s.premium; x.policies++ })
  stats.forEach((x) => { x.avgPremium = x.dates ? x.premium / x.dates : 0; x.avgPolicies = x.dates ? x.policies / x.dates : 0 })
  return { stats, from: first, to: w.to }
}

/* ---------- 2. producers ---------- */
export interface ProducerStat { producer: string; premium: number; policies: number; avg: number; share: number }
export function producerRanking(sales: Sale[], w: Window): ProducerStat[] {
  const by: Record<string, ProducerStat> = {}
  let total = 0
  sales.forEach((s) => {
    if (s.sale_date < w.from || s.sale_date > w.to) return
    const p = (by[s.producer] = by[s.producer] || { producer: s.producer, premium: 0, policies: 0, avg: 0, share: 0 })
    p.premium += s.premium; p.policies++; total += s.premium
  })
  return Object.values(by).map((p) => ({ ...p, avg: p.policies ? p.premium / p.policies : 0, share: total ? p.premium / total : 0 }))
    .sort((a, b) => b.premium - a.premium)
}

/* ---------- 3. lead sources ---------- */
export interface SourceStat {
  source: string; premium: number; policies: number; spend: number
  /** Monthly figures over the days the source could be measured. */
  monthlySpend: number; monthlyPremium: number; monthlyPolicies: number
  premiumPerDollar: number | null; policiesPerDollar: number | null
}
export interface SourceAnalysis {
  sources: SourceStat[]
  /** Days in the window where sold premium can be tied to a source. */
  attributedDays: number; windowDays: number
  /** Share of the window's sold premium (daily_sales) that falls on attributed days. */
  coverage: number; soldPremium: number
  /** Where the attribution came from, for the page's explanation. */
  folioDays: number; capturedFrom: string | null
  unattributedPremium: number
}
const norm = (s: string) => s.trim().toLowerCase()

/** Premium and policies by source, cross-referenced with spend over the same days. A day is "attributed"
 *  when it falls in a folio whose AgencyZoom report lists premium by lead source, or on/after the first
 *  sale that carries a captured lead source. Spend is prorated by day to those attributed days only, so
 *  premium per dollar compares like with like. */
export function analyseSources(D: ForesightData, w: Window): SourceAnalysis {
  const lo = toDay(w.from), hi = toDay(w.to)
  const folioDay = new Map<number, FolioSources>()
  D.folios.forEach((f) => { for (let n = toDay(f.start); n <= toDay(f.end); n++) folioDay.set(n, f) })
  const captured = D.sales.filter((s) => s.lead_source)
  const capturedFrom = captured.length ? captured.reduce((m, s) => (s.sale_date < m ? s.sale_date : m), captured[0].sale_date) : null
  const capLo = capturedFrom ? toDay(capturedFrom) : Infinity

  const by: Record<string, SourceStat> = {}
  const get = (name: string) => {
    const k = norm(name)
    return (by[k] = by[k] || { source: name, premium: 0, policies: 0, spend: 0, monthlySpend: 0, monthlyPremium: 0, monthlyPolicies: 0, premiumPerDollar: null, policiesPerDollar: null })
  }
  // folio reports count only when the whole folio sits inside the window; a report can't be split by day
  const usedFolios = D.folios.filter((f) => toDay(f.start) >= lo && toDay(f.end) <= hi)
  const used = new Set(usedFolios)
  usedFolios.forEach((f) => f.rows.forEach((r) => { const s = get(r.source); s.premium += r.premium; s.policies += r.policies }))
  let attributedDays = 0, folioDays = 0
  const counted = (n: number) => { const f = folioDay.get(n); return f ? used.has(f) : n >= capLo }
  for (let n = lo; n <= hi; n++) if (counted(n)) { attributedDays++; if (folioDay.has(n)) folioDays++ }
  let soldPremium = 0, coveredPremium = 0, unattributedPremium = 0
  D.sales.forEach((s) => {
    const n = toDay(s.sale_date); if (n < lo || n > hi) return
    soldPremium += s.premium
    if (!counted(n)) return
    coveredPremium += s.premium
    if (folioDay.has(n)) return // this day's split by source comes from the folio report
    if (s.lead_source) { const x = get(s.lead_source); x.premium += s.premium; x.policies++ } else unattributedPremium += s.premium
  })
  D.spend.forEach((r) => {
    const a = Math.max(lo, toDay(r.period_start)), b = Math.min(hi, toDay(r.period_end))
    if (b < a) return
    const perDay = r.amount / daysBetween(r.period_start, r.period_end)
    let days = 0
    for (let n = a; n <= b; n++) if (counted(n)) days++
    if (days) get(r.source).spend += perDay * days
  })
  const months = attributedDays / 30.4375
  const sources = Object.values(by).map((s) => ({
    ...s,
    monthlySpend: months ? s.spend / months : 0, monthlyPremium: months ? s.premium / months : 0, monthlyPolicies: months ? s.policies / months : 0,
    premiumPerDollar: s.spend > 0 ? s.premium / s.spend : null, policiesPerDollar: s.spend > 0 ? s.policies / s.spend : null,
  })).sort((a, b) => b.premium - a.premium)
  return { sources, attributedDays, windowDays: hi - lo + 1, coverage: soldPremium ? coveredPremium / soldPremium : 0, soldPremium, folioDays, capturedFrom: capturedFrom && toDay(capturedFrom) <= hi ? capturedFrom : null, unattributedPremium }
}

/* ---------- recommendation ---------- */
/** A source needs this much history before the engine moves its budget. */
export const MIN_POLICIES = 3, MIN_SPEND = 500, MIN_DAYS = 30
/** Shifts never go past half or one-and-a-half times current spend: the linear premium-per-dollar
 *  assumption stops holding well before that, so bigger moves would overstate the result. */
export const SHIFT_FLOOR = 0.5, SHIFT_CEIL = 1.5

export interface Recommendation {
  source: SourceStat; current: number; recommended: number; eligible: boolean; reason: string
}
export interface Plan { rows: Recommendation[]; blended: number | null; budget: number; currentPremium: number; recommendedPremium: number; organic: SourceStat[] }

/** Keeps the same monthly budget across the paid sources with enough history, weighting each by how its
 *  premium per dollar compares with the blended rate, bounded to ±50% of what it gets now. */
export function recommend(a: SourceAnalysis): Plan {
  const paid = a.sources.filter((s) => s.spend > 0)
  const enoughDays = a.attributedDays >= MIN_DAYS
  const isEligible = (s: SourceStat) => enoughDays && (s.policies >= MIN_POLICIES || s.spend >= MIN_SPEND)
  const pool = paid.filter(isEligible)
  const spend = pool.reduce((t, s) => t + s.spend, 0), prem = pool.reduce((t, s) => t + s.premium, 0)
  const blended = spend ? prem / spend : null
  const budget = pool.reduce((t, s) => t + s.monthlySpend, 0)
  // water-fill: weight by relative return, clamp to the bounds, and re-spread whatever the clamps free up
  const alloc = new Map<SourceStat, number>()
  if (blended && pool.length > 1) {
    const want = new Map(pool.map((s) => [s, s.monthlySpend * ((s.premiumPerDollar || 0) / blended)]))
    let free = [...pool], left = budget
    for (let guard = 0; guard < 20 && free.length; guard++) {
      // every free source's share from the same snapshot, then clamp all the out-of-bounds ones together
      const w = free.reduce((t, s) => t + want.get(s)!, 0)
      const share = new Map(free.map((s) => [s, w ? left * (want.get(s)! / w) : left / free.length]))
      const clamped = free.filter((s) => share.get(s)! < s.monthlySpend * SHIFT_FLOOR || share.get(s)! > s.monthlySpend * SHIFT_CEIL)
      if (!clamped.length) { free.forEach((s) => alloc.set(s, share.get(s)!)); break }
      clamped.forEach((s) => { const c = Math.min(Math.max(share.get(s)!, s.monthlySpend * SHIFT_FLOOR), s.monthlySpend * SHIFT_CEIL); alloc.set(s, c); left -= c })
      free = free.filter((s) => !clamped.includes(s))
    }
  }
  const money = (n: number) => '$' + n.toFixed(2)
  const rows = paid.map((s) => {
    const eligible = isEligible(s) && pool.length > 1
    const recommended = eligible ? alloc.get(s) ?? s.monthlySpend : s.monthlySpend
    const ppd = s.premiumPerDollar || 0
    const reason = !enoughDays ? `Only ${a.attributedDays} days can be tied to a source yet — hold until there are ${MIN_DAYS}.`
      : !isEligible(s) ? `Not enough history to judge (${s.policies} polic${s.policies === 1 ? 'y' : 'ies'} on ${'$' + Math.round(s.spend).toLocaleString('en-US')} spent) — hold.`
        : pool.length < 2 ? 'Only one paid source has enough history, so there is nothing to shift budget between.'
          : s.policies === 0 ? `No sold policies traced to ${'$' + Math.round(s.spend).toLocaleString('en-US')} of spend.`
            : `${money(ppd)} of sold premium per $1, ${ppd >= blended! ? 'above' : 'below'} the ${money(blended!)} blended across paid sources.`
    return { source: s, current: s.monthlySpend, recommended, eligible, reason }
  }).sort((x, y) => (y.source.premiumPerDollar || 0) - (x.source.premiumPerDollar || 0))
  const currentPremium = rows.reduce((t, r) => t + r.current * (r.source.premiumPerDollar || 0), 0)
  const recommendedPremium = rows.reduce((t, r) => t + r.recommended * (r.source.premiumPerDollar || 0), 0)
  return { rows, blended, budget, currentPremium, recommendedPremium, organic: a.sources.filter((s) => s.spend === 0) }
}

/* ---------- 4. linear projection ---------- */
/** Monthly change from moving a source's spend by `pct` (0.2 = +20%), at its historical rate per dollar. */
export function project(s: SourceStat, pct: number, commissionRate: number | null) {
  const dSpend = s.monthlySpend * pct
  const dPremium = dSpend * (s.premiumPerDollar || 0)
  return { dSpend, dPremium, dPolicies: dSpend * (s.policiesPerDollar || 0), dRevenue: commissionRate != null ? dPremium * commissionRate : null }
}

/* ---------- windows ---------- */
export function windowFor(key: string, today: string, first: string): Window {
  const y = today.slice(0, 4)
  if (key === 'mtd') return { from: today.slice(0, 8) + '01', to: today }
  if (key === 'ytd') return { from: y + '-01-01', to: today }
  if (key === 'all') return { from: first, to: today }
  return { from: fromDay(toDay(today) - Number(key) + 1), to: today }
}

/* ---------- lead spend records ---------- */
export async function addSpend(row: Omit<Spend, 'id'>) {
  const { error } = await supabase.from('lead_spend').insert(row)
  if (error) throw error
}
export async function deleteSpend(id: string) {
  const { error } = await supabase.from('lead_spend').delete().eq('id', id)
  if (error) throw error
}
