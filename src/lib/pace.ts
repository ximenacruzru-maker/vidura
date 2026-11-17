// The folio pace, the same rule as the folio worksheet: the working days (Monday–Friday, plus any day something was
// sold); a day has happened once it's before today, or it's today and something has been sold. Each working day left
// counts as the average day so far without the largest and smallest days (the plain average when that leaves
// nothing). The range: every day left like the slowest day with sales (low) or the best day (high), kept on either
// side of the average. Used by the Running total vs goal chart and Team Space.
export function pace(start: string, end: string, today: string, points: { date: string; value: number }[]) {
  const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5
  const iso = (n: number) => new Date(n * 864e5).toISOString().slice(0, 10)
  const d0 = day(start), d1 = Math.max(day(end), d0 + 1)
  const sums = new Map<string, number>()
  points.filter((p) => p.date >= start && p.date <= end).forEach((p) => sums.set(p.date, (sums.get(p.date) || 0) + (Number(p.value) || 0)))
  const days: string[] = []
  for (let n = d0; n <= d1; n++) { const s = iso(n), wd = new Date(n * 864e5).getUTCDay(); if ((wd !== 0 && wd !== 6) || sums.has(s)) days.push(s) }
  const happened = (s: string) => s < today || (s === today && sums.has(s))
  const done = days.filter(happened), left = days.filter((s) => !happened(s))
  const vals = done.map((s) => sums.get(s) || 0)
  const mx = Math.max(...vals), mn = Math.min(...vals)
  const mid = vals.filter((v) => v < mx && v > mn)
  const avg = mid.length ? mid.reduce((a, v) => a + v, 0) / mid.length : vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : 0
  const total = vals.reduce((a, v) => a + v, 0)
  const projected = left.length ? total + avg * left.length : null
  const sold = vals.filter((v) => v > 0)
  const lowDay = Math.min(sold.length ? Math.min(...sold) : 0, avg), highDay = Math.max(vals.length ? mx : 0, avg)
  const low = left.length ? total + lowDay * left.length : null, high = left.length ? total + highDay * left.length : null
  return { day, iso, d0, d1, sums, days, done, left, vals, mx, mn, mid, avg, total, projected, low, high, lowDay, highDay }
}
