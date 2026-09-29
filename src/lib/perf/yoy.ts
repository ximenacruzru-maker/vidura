// This year against last year, from AgencyZoom's policies (az_policies: every policy on every customer, with the day
// it was sold). Both years are counted from the same list, so they are counted the same way. A period is always
// compared with the same dates a year earlier: year to date through today against Jan 1 – the same day last year.
import { supabase } from '../supabase'

export interface SoldPolicy { day: string; premium: number; producer: string; cancelled: boolean; type?: string }
export interface Yoy { rows: SoldPolicy[]; producers: string[]; loaded: boolean; first: string | null; outliers: SoldPolicy[] }

/** A single policy's premium at or above this is taken for an entry error (a limit typed as premium) and left out. */
export const OUTLIER = 1_000_000

export async function loadYoy(today: string): Promise<Yoy> {
  // back to the start of last year, and far enough for the last 12 months a year earlier
  const from = [`${+today.slice(0, 4) - 1}-01-01`, lastYear(lastYear(today))].sort()[0]
  let rows: SoldPolicy[] = []
  for (let at = 0; ; at += 1000) {
    const { data, error } = await supabase.from('az_policies').select('sold_date, premium, producer, status, policy_type')
      .gte('sold_date', from).lte('sold_date', today).order('sold_date').range(at, at + 999)
    if (error) throw error
    rows = rows.concat((data || []).map((r: any) => ({ day: r.sold_date, premium: Number(r.premium) || 0, producer: r.producer || 'Unassigned', cancelled: r.status === 0, type: r.policy_type || '' })))
    if (!data || data.length < 1000) break
  }
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
export interface Compare { key: string; label: string; range: string; now: Sum; prior: Sum; priorFrom: string; full?: Sum }
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
    key, label, range: `${span(a, b)} vs ${span(lastYear(a), lastYear(b))}`, now: sum(a, b), prior: sum(lastYear(a), lastYear(b)), priorFrom: lastYear(a),
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
