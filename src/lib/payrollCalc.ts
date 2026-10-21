// What everyone in the office is owed on one payday — the math behind Office Payroll, shared with the owner's report
// PDFs (payroll register, commissions and SDR bonuses paid over a period) so both always agree.
//   hourly staff: hours worked in the pay period × rate (including someone whose last day falls in it)
//   salaried staff: 1/24 of the yearly salary every payday, and on the 21st a cash bonus on the agency's premium
//   on the 21st: producers' commission for the folio that closed the month before, and SDR bonuses for last month's
//   transfers (a bound transfer earns the bound bonus in place of the qualified one)
import { supabase } from './supabase'
import { agencyBonus, checkFor, folioFor, salaryCheck, type BonusTier } from './payday'
import { getSdrPeriods, getSdrTransfers, type Folio, type SdrPeriod, type SdrTransfer } from './data'
import { bonusCounts, folioBonus } from './retention'
import { shortDate } from './format'

export interface Staff { name: string; role: string | null; hourly: boolean; rate: number | null; active: boolean; hired_on?: string | null; left_on: string | null; salary_annual: number | null; bonus_tiers: BonusTier[] | null; bonus_period?: string | null }
export interface Punch { id: number; name: string; work_date: string; start_time: string | null; end_time: string | null; breaks: [string, string][]; edited: boolean }
export interface Comm { producer: string; totalPremium: number; policies: number; qualifies: boolean; tierRate: number; total: number }
export interface PayLine { name: string; role: string; hours: number; pay: number; salary: number; comm: number; bonus: number; cash: number; total: number }
type Check = ReturnType<typeof checkFor>
type Gated = Record<string, { amount: number } | undefined>

const first = (n: string) => n.trim().split(/\s+/)[0].toLowerCase()

/** "9:15AM" -> minutes after midnight */
export function clock(t: string | null) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP])M$/i.exec((t || '').trim())
  if (!m) return null
  let h = Number(m[1]) % 12
  if (m[3].toUpperCase() === 'P') h += 12
  return h * 60 + Number(m[2])
}
/** Minutes worked on one punch: in to out, less breaks. */
export function workedMinutes(p: Pick<Punch, 'start_time' | 'end_time' | 'breaks'>) {
  const s = clock(p.start_time), e = clock(p.end_time)
  if (s == null || e == null || e <= s) return 0
  const br = (p.breaks || []).reduce((a, [b1, b2]) => { const x = clock(b1), y = clock(b2); return a + (x != null && y != null && y > x ? y - x : 0) }, 0)
  return e - s - br
}

export function payrollLines(x: { staff: Staff[]; punches: Punch[]; comm: Comm[]; sdr: SdrTransfer[]; qb: number; bb: number; check: Check; agencyPrem: number | null; gated: Gated }) {
  const { staff, punches, comm, sdr, qb, bb, check, agencyPrem, gated } = x
  // hourly staff on the books in the period, including anyone whose last day falls in it (their final check)
  const hourly = staff.filter((s) => s.hourly && (s.active || (s.left_on && s.left_on >= check.from))).map((s) => {
    const ps = punches.filter((p) => p.name === s.name)
    const m = ps.reduce((a, p) => a + workedMinutes(p), 0)
    return { name: s.name, role: (s.role || '') + (!s.active && s.left_on ? ` (last day ${shortDate(s.left_on)})` : ''), days: ps.length, mins: m, rate: s.rate, pay: s.rate ? Math.round((m / 60) * s.rate * 100) / 100 : 0 }
  })
  const sdrs = new Map<string, { logged: number; qualified: number; bound: number; qOnly: number }>()
  for (const t of sdr) {
    const o = sdrs.get(t.sdr) || { logged: 0, qualified: 0, bound: 0, qOnly: 0 }
    // a bound transfer earns the bound bonus in place of the qualified one ($35 total, not $15 + $35)
    o.logged++; if (t.az_qualifies) o.qualified++; if (t.bound) o.bound++; else if (t.az_qualifies) o.qOnly++
    sdrs.set(t.sdr, o)
  }
  // one line per person: SDR tags carry first names, so they join a full name with the same first name
  const people = new Map<string, Omit<PayLine, 'total'>>()
  const person = (name: string, role = '') => {
    const k = first(name)
    const p = people.get(k) || { name, role, hours: 0, pay: 0, salary: 0, comm: 0, bonus: 0, cash: 0 }
    if (name.length > p.name.length) p.name = name
    if (!p.role) p.role = role
    people.set(k, p); return p
  }
  for (const h of hourly) { const p = person(h.name, h.role); p.hours += h.mins / 60; p.pay += h.pay }
  // salaried staff on the books: a salary check every payday, and on the 21st their cash bonus instead of commission
  const salaried = staff.filter((s) => s.salary_annual && (s.active || (s.left_on && s.left_on >= check.from)))
  const noComm = new Set(salaried.map((s) => first(s.name)))
  for (const s of salaried) {
    const p = person(s.name, s.role || '')
    p.salary += salaryCheck(s.salary_annual)
    if (s.bonus_period === 'folio_gated') p.cash += gated[s.name]?.amount || 0
    else if (check.commission && agencyPrem != null) p.cash += agencyBonus(s.bonus_tiers, agencyPrem).amount
  }
  for (const c of comm) if (c.total && !noComm.has(first(c.producer))) person(c.producer, 'Producer').comm += c.total
  for (const [n, o] of sdrs) person(n, 'SDR').bonus += o.qOnly * qb + o.bound * bb
  const who: PayLine[] = [...people.values()].map((p) => ({ ...p, total: p.pay + p.salary + p.comm + p.bonus + p.cash })).filter((p) => p.total || p.hours).sort((a, b) => b.total - a.total)
  return { hourly, sdrs, who, salaried }
}

/** Everything one payday needs, fetched — for the report PDFs (Office Payroll fetches the same pieces itself). */
export async function loadPayday(pay: string, folios: Folio[], periods: SdrPeriod[], staff: Staff[], today: string) {
  const check = checkFor(pay)
  const folio = folioFor(pay, folios)
  const period = check.commission ? periods.find((p) => p.pay_date === pay) : undefined
  const [punches, comm, sdr, agencyPrem] = await Promise.all([
    supabase.from('hr_punches').select('*').gte('work_date', check.from).lte('work_date', check.to).then((r) => { if (r.error) throw r.error; return r.data as Punch[] }),
    folio ? supabase.functions.invoke('commissions', { body: { folio: folio.start_date, scope: 'office' } }).then((r) => (r.error ? [] : ((r.data?.results || []) as Comm[]))) : Promise.resolve([] as Comm[]),
    period ? getSdrTransfers(period.month) : Promise.resolve([] as SdrTransfer[]),
    folio ? supabase.rpc('agency_premium', { p_from: folio.start_date, p_to: folio.end_date }).then((r) => (r.error ? null : Number(r.data) || 0)) : Promise.resolve(null),
  ])
  const gated: Gated = {}
  if (folio && bonusCounts(folio)) for (const s of staff.filter((x) => x.salary_annual && x.bonus_period === 'folio_gated' && x.bonus_tiers?.length && x.active)) gated[s.name] = await folioBonus(s.name, s.bonus_tiers, folio, today).catch(() => undefined)
  const qb = Number(period?.qualified_transfer_bonus) || 0, bb = Number(period?.bound_policy_bonus) || 0
  return { pay, check, folio, period, lines: payrollLines({ staff, punches, comm, sdr, qb, bb, check, agencyPrem, gated }) }
}
export const loadSdrPeriods = getSdrPeriods
