// Retention & book growth (Ximena's role from Oct 6, 2026): the daily huddle scorecard, the save / loss / cross-sell /
// new business log, Net Book Movement, and the folio bonus with its eligibility gates.
//   Net Book Movement = saved premium + cross-sell premium + new business premium − lost premium
//   (new business: a new customer, e.g. a lender referral; a cross-sell is a new policy for an existing client)
//   Bonus: the highest tier of agency premium written in the folio ($1,000 at $100k, $2,500 at $150k, $5,000 at $200k),
//   paid on the 21st with the folio before it, like commission (Nov 21 pays the Sep 21 – Oct 20 folio), from the first
//   folio the role was in place for, and only when all four gates are met over that folio:
//     1. at least 95% of the folio's daily scorecard entries are in (workdays from the day the role began)
//     2. every critical escalation got same-day contact (or a documented same-day attempt)
//     3. no critical case left aged over a business day without a blocker and deadline
//     4. Farmers and brokered premium reporting reconciled (marked by the person or an admin)
import { supabase } from './supabase'
import { agencyBonus, type BonusTier } from './payday'

export interface RetentionDay { name: string; day: string; at_risk_touches: number; renewal_conversations: number; escalations: number; escalations_same_day: number; open_critical_aged: number; brokered_current: boolean; priority: string | null }
export interface RetentionEntry { id: number; name: string; day: string; kind: 'save' | 'loss' | 'cross_sell' | 'new_business' | 'review'; client: string; policies: number; premium: number; carrier: string | null; reason: string | null; note: string | null }
export interface RetentionMonth { name: string; month: string; reconciled: boolean; reconciled_note: string | null }

export const ROLE_FROM = '2026-10-06' // the role took effect October 6, 2026: scorecard days count from then
export const TARGETS = { touches: 15, conversations: 5, savesPerWeek: 4, cancellationsMax: 45, netPif: 25 }
export const LOSS_REASONS = ['Price / rate increase', 'Nonpayment', 'Moved / sold property', 'Went to another agent', 'Coverage no longer needed', 'Underwriting / nonrenewal', 'Service issue', 'Other']

const pad = (n: number) => String(n).padStart(2, '0')
export const monthEnd = (m: string) => { const [y, mo] = m.split('-').map(Number); return `${m}-${pad(new Date(Date.UTC(y, mo, 0)).getUTCDate())}` }
export const monthLabel = (m: string) => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
/** Weekdays from a day (or the day the role began, if later) through another. */
export function workdays(from: string, through: string) {
  const out: string[] = []
  for (let d = new Date((from < ROLE_FROM ? ROLE_FROM : from) + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= through; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10))
  }
  return out
}

export function movement(entries: RetentionEntry[]) {
  const sum = (k: RetentionEntry['kind']) => entries.filter((e) => e.kind === k).reduce((a, e) => ({ n: a.n + Number(e.policies || 0), p: a.p + Number(e.premium || 0) }), { n: 0, p: 0 })
  const saved = sum('save'), lost = sum('loss'), cross = sum('cross_sell'), fresh = sum('new_business')
  return { saved, lost, cross, fresh, net: saved.p + cross.p + fresh.p - lost.p, netPif: cross.n + fresh.n - lost.n }
}

export interface Gate { label: string; ok: boolean; detail: string }
/** A folio (or any stretch of days) a bonus is measured on; its reconciliation mark is kept under its first day. */
export interface Period { start_date: string; end_date: string }

/** The four bonus gates for a folio, from the scorecard days logged in it and its reconciliation mark. */
export function gates(p: Period, days: RetentionDay[], rec: RetentionMonth | null, today: string): Gate[] {
  const through = p.end_date < today ? p.end_date : today
  const due = workdays(p.start_date, through)
  const inside = days.filter((d) => d.day >= p.start_date && d.day <= p.end_date)
  const logged = new Set(inside.map((d) => d.day))
  const done = due.filter((d) => logged.has(d)).length
  const pctDone = due.length ? done / due.length : 1
  const esc = inside.reduce((a, d) => a + d.escalations, 0), same = inside.reduce((a, d) => a + Math.min(d.escalations_same_day, d.escalations), 0)
  const aged = inside.filter((d) => d.open_critical_aged > 0)
  return [
    { label: 'Daily scorecard entries (95%)', ok: pctDone >= 0.95, detail: `${done} of ${due.length} workdays logged (${Math.round(pctDone * 100)}%)` },
    { label: 'Same-day contact on critical escalations', ok: same >= esc, detail: esc ? `${same} of ${esc} contacted the same day` : 'No critical escalations logged' },
    { label: 'No critical case aged over a day', ok: aged.length === 0, detail: aged.length ? `Aged cases on ${aged.length} day${aged.length === 1 ? '' : 's'}` : 'None aged' },
    { label: 'Premium reporting reconciled', ok: !!rec?.reconciled, detail: rec?.reconciled ? (rec.reconciled_note || 'Marked reconciled') : 'Not marked reconciled yet' },
  ]
}

/** Whether a folio counts for the gated bonus: the first one is the folio the role began in. */
export const bonusCounts = (p: Period) => p.end_date >= ROLE_FROM

/** A gated folio bonus: the agency premium written in the folio, the tier it reaches, and the four gates. */
export async function folioBonus(name: string, tiers: BonusTier[] | null | undefined, p: Period, today: string) {
  const [prem, days, rec] = await Promise.all([
    supabase.rpc('agency_premium', { p_from: p.start_date, p_to: p.end_date }).then((r) => { if (r.error) throw r.error; return Number(r.data) || 0 }),
    supabase.from('retention_days').select('*').eq('name', name).gte('day', p.start_date).lte('day', p.end_date).then((r) => { if (r.error) throw r.error; return r.data as RetentionDay[] }),
    supabase.from('retention_months').select('*').eq('name', name).eq('month', p.start_date).maybeSingle().then((r) => { if (r.error) throw r.error; return r.data as RetentionMonth | null }),
  ])
  const tier = agencyBonus(tiers, prem)
  const g = gates(p, days, rec, today)
  const eligible = g.every((x) => x.ok)
  return { period: p, premium: prem, tier, gates: g, eligible, amount: eligible ? tier.amount : 0 }
}
