// What Farmers pays the agency on its premium, by line: auto 9%, home 12%, business 15%, umbrella 7%, life 50%.
// The rates apply to new business only: shown to the agency owner on the Executive Dashboard for this year so far.
import { execProduction } from './executive'
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

/** Farmers revenue on new business written this year (Jan 1 – today), from the AgencyZoom policies synced into
 *  the sales ledger. The rates apply to new business only, so the book in force is not counted. */
/** Farmers and Foremost (a Farmers company) policies; brokered carriers such as Bristol West or Kraft Lake are not paid at these rates. */
export const isFarmersRevenue = (carrier: string | null | undefined) => /farmers|foremost/i.test(carrier || '')

export function farmersRevenue(D: PerfData) {
  const P = execProduction(D, 'ytd')
  const written = tally(P.sales.filter((s) => isFarmersRevenue(s.carrier)).map((s) => ({ type: s.policyType, premium: s.premium || 0 })))
  return { start: P.r.start, end: P.r.end, ...written }
}
