// Paydays: payroll is paid twice a month.
//   the 21st — hours for the 1st–15th, plus producers' commission (the folio that closed just before it, usually on
//              the 20th) and SDR bonuses
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

/** The folio a 21st pays: the one that closed just before it (one closed more than a month earlier was paid on an
 *  earlier 21st). None on the 5th. */
export function folioFor(pay: string, folios: Folio[]) {
  if (!pay.endsWith('-21')) return null
  const [y, m] = pay.split('-').map(Number)
  const monthBack = m === 1 ? `${y - 1}-12-21` : `${y}-${pad(m - 1)}-21`
  return folios.filter((f) => f.end_date < pay && f.end_date >= monthBack).sort((a, b) => (a.end_date < b.end_date ? 1 : -1))[0] || null
}
