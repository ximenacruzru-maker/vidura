// Retention & book growth (Ximena's role from Oct 6, 2026): the daily huddle scorecard, the save / loss / cross-sell
// log, Net Book Movement, and the monthly bonus with its eligibility gates.
//   Net Book Movement = saved premium + cross-sell premium − lost premium
//   Bonus: the highest tier of qualifying monthly agency premium ($1,000 at $100k, $2,500 at $150k, $5,000 at $200k),
//   measured by calendar month from October 2026, paid on the 21st after month-end reconciliation, and only when all
//   four gates are met:
//     1. at least 95% of the month's daily scorecard entries are in
//     2. every critical escalation got same-day contact (or a documented same-day attempt)
//     3. no critical case left aged over a business day without a blocker and deadline
//     4. Farmers and brokered premium reporting reconciled (marked by the person or an admin)
import { supabase } from './supabase'
import { agencyBonus, type BonusTier } from './payday'

export interface RetentionDay { name: string; day: string; at_risk_touches: number; renewal_conversations: number; escalations: number; escalations_same_day: number; open_critical_aged: number; brokered_current: boolean; priority: string | null }
export interface RetentionEntry { id: number; name: string; day: string; kind: 'save' | 'loss' | 'cross_sell'; client: string; policies: number; premium: number; carrier: string | null; reason: string | null; note: string | null }
export interface RetentionMonth { name: string; month: string; reconciled: boolean; reconciled_note: string | null }

export const BONUS_FROM = '2026-10' // the plan measures bonuses from October 2026 results
export const ROLE_FROM = '2026-10-06' // the role took effect October 6, 2026: scorecard days count from then
export const TARGETS = { touches: 15, conversations: 5, savesPerWeek: 4, cancellationsMax: 45, netPif: 25 }
export const LOSS_REASONS = ['Price / rate increase', 'Nonpayment', 'Moved / sold property', 'Went to another agent', 'Coverage no longer needed', 'Underwriting / nonrenewal', 'Service issue', 'Other']

const pad = (n: number) => String(n).padStart(2, '0')
export const monthEnd = (m: string) => { const [y, mo] = m.split('-').map(Number); return `${m}-${pad(new Date(Date.UTC(y, mo, 0)).getUTCDate())}` }
export const monthLabel = (m: string) => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
/** The calendar month a monthly bonus paid on this payday covers: the month before a 21st. None on the 5th. */
export function bonusMonthFor(pay: string) {
  if (!pay.endsWith('-21')) return null
  const [y, m] = pay.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`
}
/** Weekdays from the 1st of a month (or the day the role began) through a day (the month's end, or today for the month in progress). */
export function workdays(month: string, through: string) {
  const out: string[] = []
  const start = month + '-01' < ROLE_FROM && ROLE_FROM.startsWith(month) ? ROLE_FROM : month + '-01'
  for (let d = new Date(start + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= through && d.toISOString().slice(0, 7) === month; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10))
  }
  return out
}

export function movement(entries: RetentionEntry[]) {
  const sum = (k: RetentionEntry['kind']) => entries.filter((e) => e.kind === k).reduce((a, e) => ({ n: a.n + Number(e.policies || 0), p: a.p + Number(e.premium || 0) }), { n: 0, p: 0 })
  const saved = sum('save'), lost = sum('loss'), cross = sum('cross_sell')
  return { saved, lost, cross, net: saved.p + cross.p - lost.p, netPif: cross.n - lost.n }
}

export interface Gate { label: string; ok: boolean; detail: string }
/** The four bonus gates for a month, from the scorecard days logged in it and its reconciliation mark. */
export function gates(month: string, days: RetentionDay[], rec: RetentionMonth | null, today: string): Gate[] {
  const through = monthEnd(month) < today ? monthEnd(month) : today
  const due = workdays(month, through)
  const logged = new Set(days.map((d) => d.day))
  const done = due.filter((d) => logged.has(d)).length
  const pctDone = due.length ? done / due.length : 1
  const esc = days.reduce((a, d) => a + d.escalations, 0), same = days.reduce((a, d) => a + Math.min(d.escalations_same_day, d.escalations), 0)
  const aged = days.filter((d) => d.open_critical_aged > 0)
  return [
    { label: 'Daily scorecard entries (95%)', ok: pctDone >= 0.95, detail: `${done} of ${due.length} workdays logged (${Math.round(pctDone * 100)}%)` },
    { label: 'Same-day contact on critical escalations', ok: same >= esc, detail: esc ? `${same} of ${esc} contacted the same day` : 'No critical escalations logged' },
    { label: 'No critical case aged over a day', ok: aged.length === 0, detail: aged.length ? `Aged cases on ${aged.length} day${aged.length === 1 ? '' : 's'}` : 'None aged' },
    { label: 'Premium reporting reconciled', ok: !!rec?.reconciled, detail: rec?.reconciled ? (rec.reconciled_note || 'Marked reconciled') : 'Not marked reconciled yet' },
  ]
}

/** A salaried person's monthly bonus for a month: qualifying agency premium, the tier it reaches, and the gates. */
export async function monthBonus(name: string, tiers: BonusTier[] | null | undefined, month: string, today: string) {
  const [prem, days, rec] = await Promise.all([
    supabase.rpc('agency_premium', { p_from: month + '-01', p_to: monthEnd(month) }).then((r) => { if (r.error) throw r.error; return Number(r.data) || 0 }),
    supabase.from('retention_days').select('*').eq('name', name).gte('day', month + '-01').lte('day', monthEnd(month)).then((r) => { if (r.error) throw r.error; return r.data as RetentionDay[] }),
    supabase.from('retention_months').select('*').eq('name', name).eq('month', month).maybeSingle().then((r) => { if (r.error) throw r.error; return r.data as RetentionMonth | null }),
  ])
  const tier = agencyBonus(tiers, prem)
  const g = gates(month, days, rec, today)
  const eligible = g.every((x) => x.ok)
  return { month, premium: prem, tier, gates: g, eligible, amount: eligible ? tier.amount : 0 }
}
