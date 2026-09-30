// This year against last year, from AgencyZoom's policies (az_policies: every policy on every customer, with the day
// it was sold). Both years are counted from the same list, so they are counted the same way. A period is always
// compared with the same dates a year earlier: year to date through today against Jan 1 – the same day last year.
import { supabase } from '../supabase'

export interface SoldPolicy {
  day: string; premium: number; producer: string; cancelled: boolean; type?: string
  id?: string; cid?: string; customer?: string; number?: string; carrier?: string
  /** sold on the customer's first day with the agency (a new customer), rather than added to an existing one */
  isNew?: boolean
}
export interface Yoy { rows: SoldPolicy[]; producers: string[]; loaded: boolean; first: string | null; outliers: SoldPolicy[] }

/** A single policy's premium at or above this is taken for an entry error (a limit typed as premium) and left out. */
export const OUTLIER = 1_000_000

export async function loadYoy(today: string): Promise<Yoy> {
  // back to the start of last year, and far enough for the last 12 months a year earlier
  const from = [`${+today.slice(0, 4) - 1}-01-01`, lastYear(lastYear(today))].sort()[0]
  let rows: SoldPolicy[] = []
  for (let at = 0; ; at += 1000) {
    const { data, error } = await supabase.from('az_policies').select('policy_id, customer_id, customer_name, policy_number, sold_date, premium, producer, carrier, status, policy_type')
      .gte('sold_date', from).lte('sold_date', today).order('sold_date').order('policy_id').range(at, at + 999)
    if (error) throw error
    rows = rows.concat((data || []).map((r: any) => ({
      day: r.sold_date, premium: Number(r.premium) || 0, producer: r.producer || 'Unassigned', cancelled: r.status === 0, type: r.policy_type || '',
      id: r.policy_id, cid: r.customer_id, customer: r.customer_name || '', number: r.policy_number || '', carrier: r.carrier || '',
    })))
    if (!data || data.length < 1000) break
  }
  // each customer's first sale (over all their history), to tell a new customer from a policy added to an existing one
  const firstSale = new Map<string, string>()
  for (let at = 0; ; at += 1000) {
    const { data, error } = await supabase.from('az_policies').select('customer_id, sold_date').not('sold_date', 'is', null)
      .order('customer_id').order('policy_id').range(at, at + 999)
    if (error) break
    for (const r of data || []) { const d = firstSale.get(r.customer_id); if (!d || r.sold_date < d) firstSale.set(r.customer_id, r.sold_date) }
    if (!data || data.length < 1000) break
  }
  for (const r of rows) r.isNew = !!r.cid && (firstSale.get(r.cid) ?? r.day) >= r.day
  const outliers = rows.filter((r) => r.premium >= OUTLIER)
  rows = rows.filter((r) => r.premium < OUTLIER)
  const producers = [...new Set(rows.map((r) => r.producer))].sort()
  // the earliest sale AgencyZoom holds: before it, "last year" is missing rather than zero
  const { data: f } = await supabase.from('az_policies').select('sold_date').not('sold_date', 'is', null).order('sold_date').limit(1)
  return { rows, producers, loaded: rows.length > 0, first: f?.[0]?.sold_date ?? null, outliers }
}

/** The same calendar day a year earlier (29 February falls back to the 28th). */
export function lastYear(iso: string) {
  const y = +iso.slice(0, 4) - 1, md = iso.slice(5)
  return md === '02-29' ? `${y}-02-28` : `${y}-${md}`
}

export interface Sum { premium: number; policies: number }
export interface Compare { key: string; label: string; range: string; a: string; b: string; now: Sum; prior: Sum; priorFrom: string; full?: Sum }
export interface MonthRow { month: number; label: string; now: Sum | null; prior: Sum; priorToDate: Sum | null; partial: boolean }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmt = (iso: string, year = true) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' })
const span = (a: string, b: string) => `${fmt(a, a.slice(0, 4) !== b.slice(0, 4))} – ${fmt(b)}`
const pad = (n: number) => String(n).padStart(2, '0')
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate() // m is 1-12

export function yoyFigures(Y: Yoy, today: string, o: { producer: string; dropCancelled: boolean }) {
  const rows = Y.rows.filter((r) => (o.producer === 'all' || r.producer === o.producer) && !(o.dropCancelled && r.cancelled))
  const sum = (a: string, b: string): Sum => {
    let premium = 0, policies = 0
    for (const r of rows) if (r.day >= a && r.day <= b) { premium += r.premium; policies++ }
    return { premium: Math.round(premium * 100) / 100, policies }
  }
  const y = +today.slice(0, 4), m = +today.slice(5, 7)
  const q0 = Math.floor((m - 1) / 3) * 3 + 1
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y
  const lmA = `${py}-${pad(pm)}-01`, lmB = `${py}-${pad(pm)}-${pad(lastDay(py, pm))}`
  const periods: [string, string, string, string][] = [
    ['mtd', 'Month to date', `${y}-${pad(m)}-01`, today],
    ['qtd', 'Quarter to date', `${y}-${pad(q0)}-01`, today],
    ['ytd', 'Year to date', `${y}-01-01`, today],
    ['lm', 'Last month', lmA, lmB],
    ['t12', 'Last 12 months', addDay(lastYear(today)), today],
  ]
  // each against the same dates a year earlier (a month's last day lands on last year's last day, 29 Feb on the 28th)
  // the year so far is also measured against the whole of last year (Jan 1 – Dec 31): how far toward beating it
  const fullYear = sum(`${y - 1}-01-01`, `${y - 1}-12-31`)
  const compares: Compare[] = periods.map(([key, label, a, b]) => ({ ...(key === 'ytd' ? { full: fullYear } : {}),
    key, label, a, b, range: `${span(a, b)} vs ${span(lastYear(a), lastYear(b))}`, now: sum(a, b), prior: sum(lastYear(a), lastYear(b)), priorFrom: lastYear(a),
  }))
  const months: MonthRow[] = MONTHS.map((label, i) => {
    const mo = i + 1, a = `${y}-${pad(mo)}-01`, pa = `${y - 1}-${pad(mo)}-01`
    const pb = `${y - 1}-${pad(mo)}-${pad(lastDay(y - 1, mo))}`
    const partial = mo === m
    return {
      month: mo, label, partial,
      now: mo > m ? null : sum(a, partial ? today : `${y}-${pad(mo)}-${pad(lastDay(y, mo))}`),
      prior: sum(pa, pb),
      priorToDate: partial ? sum(pa, lastYear(today)) : null,
    }
  })
  return { compares, months, year: y, count: rows.length }
}

function addDay(iso: string) {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10)
}

/** "+12.4%", or "new" when last year had nothing to compare with. */
export function change(now: number, prior: number) {
  if (!prior) return now ? 'new' : '—'
  const p = ((now - prior) / prior) * 100
  return (p >= 0 ? '+' : '−') + Math.abs(p).toFixed(1) + '%'
}

/* ---------- drill-down: every policy behind a period, this year and the same dates last year ---------- */

export interface Group { key: string; now: Sum; prior: Sum }
export interface Side { rows: SoldPolicy[]; sum: Sum; customers: number; fresh: Sum; added: Sum; cancelled: Sum }
export interface Drill { label: string; range: string; now: Side | null; prior: Side; byProducer: Group[]; byType: Group[]; byCarrier: Group[] }

/** A month of this year (1-12) as a drill range: to today for the current month, none yet for a month ahead. */
export function monthRange(year: number, month: number, today: string) {
  const a = `${year}-${pad(month)}-01`, end = `${year}-${pad(month)}-${pad(lastDay(year, month))}`
  const future = a > today, partial = !future && end > today
  const label = new Date(a + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return {
    label, a: future ? null : a, b: partial ? today : end,
    pa: `${year - 1}-${pad(month)}-01`, pb: partial ? lastYear(today) : `${year - 1}-${pad(month)}-${pad(lastDay(year - 1, month))}`,
  }
}

export function drill(Y: Yoy, r: { label: string; a: string | null; b: string; pa: string; pb: string }, o: { producer: string; dropCancelled: boolean }): Drill {
  const keep = (x: SoldPolicy) => (o.producer === 'all' || x.producer === o.producer) && !(o.dropCancelled && x.cancelled)
  const pick = (a: string, b: string) => Y.rows.filter((x) => x.day >= a && x.day <= b && keep(x))
  const now = r.a ? pick(r.a, r.b) : null, prior = pick(r.pa, r.pb)
  const total = (xs: SoldPolicy[]): Sum => ({ premium: Math.round(xs.reduce((s, x) => s + x.premium, 0) * 100) / 100, policies: xs.length })
  const side = (xs: SoldPolicy[]): Side => ({
    rows: xs, sum: total(xs), customers: new Set(xs.map((x) => x.cid || x.id)).size,
    fresh: total(xs.filter((x) => x.isNew)), added: total(xs.filter((x) => !x.isNew)), cancelled: total(xs.filter((x) => x.cancelled)),
  })
  const group = (f: (x: SoldPolicy) => string) => {
    const m = new Map<string, Group>()
    const add = (xs: SoldPolicy[] | null, k: 'now' | 'prior') => { for (const x of xs || []) {
      const key = f(x) || '(none)'; const g = m.get(key) ?? { key, now: { premium: 0, policies: 0 }, prior: { premium: 0, policies: 0 } }
      g[k].premium += x.premium; g[k].policies++; m.set(key, g)
    } }
    add(now, 'now'); add(prior, 'prior')
    return [...m.values()].sort((x, y) => y.now.premium - x.now.premium || y.prior.premium - x.prior.premium)
  }
  return {
    label: r.label, range: r.a ? `${span(r.a, r.b)} vs ${span(r.pa, r.pb)}` : span(r.pa, r.pb),
    now: now && side(now), prior: side(prior),
    byProducer: group((x) => x.producer), byType: group((x) => x.type || ''), byCarrier: group((x) => x.carrier || ''),
  }
}
