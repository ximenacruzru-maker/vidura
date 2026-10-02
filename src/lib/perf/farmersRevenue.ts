// What Farmers pays the agency on its premium, by line: auto 9%, home 12%, business 15%, umbrella 7%, life 50%.
// Shown to the agency owner on the Executive Dashboard, for what was written in the production window and for the
// Farmers book in force (a year's premium).
import { daysUntil, execProduction, isFarmersCarrier, type Row } from './executive'
import type { PerfData } from './data'

export const FARMERS_RATES = [
  { key: 'auto', label: 'Auto', rate: 0.09 },
  { key: 'home', label: 'Home', rate: 0.12 },
  { key: 'business', label: 'Business', rate: 0.15 },
  { key: 'umbrella', label: 'Umbrella', rate: 0.07 },
  { key: 'life', label: 'Life', rate: 0.5 },
] as const
export type RevLine = (typeof FARMERS_RATES)[number]['key'] | 'other'

/** Which of the five lines a policy type pays as; anything else is "other" (no rate). */
export function revenueLine(type: string | null | undefined): RevLine {
  const t = String(type || '').toLowerCase()
  if (/umbrella/.test(t)) return 'umbrella'
  if (/life/.test(t)) return 'life'
  if (/commercial|business|work(er)?s? ?comp|bop|builders|contractor|restaurant|retail|wholesale|habitational|real estate|service|package|liability|garage|artisan/.test(t)) return 'business'
  if (/auto|motorcycle|rv|boat|watercraft|vehicle/.test(t)) return 'auto'
  if (/home|condo|rent|dwelling|fire|landlord|earthquake|flood|mobile|farm|property/.test(t)) return 'home'
  return 'other'
}

export interface RevRow { key: RevLine; label: string; rate: number | null; n: number; premium: number; revenue: number }
function tally(items: { type: string | null | undefined; premium: number }[]) {
  const out: RevRow[] = [...FARMERS_RATES.map((r) => ({ key: r.key as RevLine, label: r.label, rate: r.rate as number | null, n: 0, premium: 0, revenue: 0 })),
    { key: 'other', label: 'Other (no rate)', rate: null, n: 0, premium: 0, revenue: 0 }]
  for (const i of items) {
    const o = out.find((x) => x.key === revenueLine(i.type))!
    o.n++; o.premium += i.premium || 0; o.revenue += o.rate ? (i.premium || 0) * o.rate : 0
  }
  return { lines: out, premium: out.reduce((a, x) => a + x.premium, 0), revenue: out.reduce((a, x) => a + x.revenue, 0) }
}

export function farmersRevenue(D: PerfData, rows: Row[], win: string, range: { from: string; to: string }) {
  const P = execProduction(D, win, range)
  const written = tally(P.sales.filter((s) => isFarmersCarrier(s.carrier) || isFarmersCarrier(s.source)).map((s) => ({ type: s.policyType, premium: s.premium || 0 })))
  const inForce = rows.filter((r) => r.book === 'Farmers' && !(r.status && /cancel|lapse|non-?renew|expired/i.test(r.status)) && !(r.exp && daysUntil(r.exp) < 0))
  const book = tally(inForce.map((r) => ({ type: r.kind, premium: r.prem || 0 })))
  return { label: P.r.label, written, book }
}
