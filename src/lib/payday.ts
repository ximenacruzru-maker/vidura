// Paydays: payroll is paid twice a month.
//   the 21st — hours for the 1st–15th, plus producers' commission and SDR bonuses, both a month behind: the folio
//              that closed on the 20th of the month before (e.g. Oct 21 pays the Aug 20 – Sep 20 folio), and last
//              month's SDR transfers
//   the 5th  — hours for the 16th–end of the previous month (no commission)
// Shared by Office Payroll and My Pay so both always agree on what a payday covers.
import type { Folio } from './data'

const pad = (n: number) => String(n).padStart(2, '0')
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** What a payday covers: its hours period, and whether commission and SDR bonuses ride on it. */
export function checkFor(pay: string) {
  const [y, m] = pay.split('-').map(Number)
  if (pay.endsWith('-21')) return { pay, from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-15`, commission: true }
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1
  return { pay, from: `${py}-${pad(pm)}-16`, to: `${py}-${pad(pm)}-${pad(lastDay(py, pm))}`, commission: false }
}

/** The next payday on or after a day. */
export function nextPay(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  if (d <= 5) return `${y}-${pad(m)}-05`
  if (d <= 21) return `${y}-${pad(m)}-21`
  return m === 12 ? `${y + 1}-01-05` : `${y}-${pad(m + 1)}-05`
}

export function stepPay(pay: string, dir: -1 | 1) {
  const [y, m] = pay.split('-').map(Number)
  if (pay.endsWith('-05')) return dir > 0 ? `${y}-${pad(m)}-21` : m === 1 ? `${y - 1}-12-21` : `${y}-${pad(m - 1)}-21`
  return dir < 0 ? `${y}-${pad(m)}-05` : m === 12 ? `${y + 1}-01-05` : `${y}-${pad(m + 1)}-05`
}

/** The folio a 21st pays: commission is paid a month after the folio closes, so the one that closed the month
 *  before (by the previous month's 20th, e.g. Oct 21 pays the folio closed Sep 20; the folio open now is paid next
 *  month). None on the 5th. */
export function folioFor(pay: string, folios: Folio[]) {
  if (!pay.endsWith('-21')) return null
  const [y, m] = pay.split('-').map(Number)
  const back = (n: number) => { const t = (y * 12 + (m - 1)) - n; return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}-21` }
  const from = back(2), to = back(1) // closed on/after the 21st two months back, before the 21st last month
  return folios.filter((f) => f.end_date >= from && f.end_date < to).sort((a, b) => (a.end_date < b.end_date ? 1 : -1))[0] || null
}

/** Salaried staff: the annual salary in 24 equal checks, one each payday. */
export const salaryCheck = (annual: number | null | undefined) => Math.round(((Number(annual) || 0) / 24) * 100) / 100

export interface BonusTier { min: number; amount: number }
/** A salaried person's cash bonus on the agency's premium for a folio: the highest tier reached (tiers don't add up). */
export function agencyBonus(tiers: BonusTier[] | null | undefined, premium: number) {
  const hit = (tiers || []).filter((t) => premium >= Number(t.min)).sort((a, b) => Number(b.min) - Number(a.min))[0]
  return hit ? { amount: Number(hit.amount), min: Number(hit.min) } : { amount: 0, min: 0 }
}
