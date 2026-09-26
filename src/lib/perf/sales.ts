// Everything the Sales KPIs screen computes, as plain functions over PerfData. Ported from engine.js (salesRange,
// salesRows, salesMonths, salesBy, salesBook, salesIso, cusRange) so the figures match the original screen exactly.
import { wbFolioKeys, type PerfData } from './data'
import { pDate, today0, type Book, type Month } from './executive'

export interface Sale { prem: number; client: string; producer: string; kind: string; carrier: string; source: string; book: Book; when: Date | null; day: string }
export interface SalesRange { start: Date; end: Date; label: string; buckets: 'day' | 'month'; folioKey?: string }

export const salesIso = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const isoToDate = (iso: string) => pDate(iso.slice(5, 7) + '/' + iso.slice(8, 10) + '/' + iso.slice(0, 4))!
const COMMERCIAL_RX = /commercial|workers comp|\bbop\b|\bgl\b|builders risk|e&o|umbrella.*business/i
const salesBook = (source: string, policyType: string): Book => source === 'Farmers' ? 'Farmers' : policyType && COMMERCIAL_RX.test(policyType) ? 'Commercial' : 'Retail'

/** The custom From/To, defaulting to Jan 1 – today and swapped if entered backwards. */
export function cusRange(from?: string, to?: string): [string, string] {
  const t = today0(), iso = /^\d{4}-\d{2}-\d{2}$/
  const a = from && iso.test(from) ? from : t.getFullYear() + '-01-01'
  const b = to && iso.test(to) ? to : salesIso(t)
  return a <= b ? [a, b] : [b, a]
}

export function salesRange(D: PerfData, k: string, custom?: { from?: string; to?: string }): SalesRange {
  const t = today0()
  if (k === 'custom') {
    const [a, b] = cusRange(custom?.from, custom?.to)
    const s = new Date(a + 'T00:00:00'), e = new Date(b + 'T00:00:00')
    return { start: s, end: e, label: 'Custom range (' + a + ' to ' + b + ')', buckets: e.getTime() - s.getTime() > 62 * 864e5 ? 'month' : 'day' }
  }
  if (k === 'prev') { const d = new Date(t); d.setDate(t.getDate() - 1); return { start: d, end: d, label: 'Previous day (' + salesIso(d) + ')', buckets: 'day' } }
  if (k === 'wtd') { const d = new Date(t); d.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return { start: d, end: t, label: 'Week to date (from ' + salesIso(d) + ')', buckets: 'day' } }
  if (k === 'ytd') return { start: new Date(t.getFullYear(), 0, 1), end: t, label: 'Year to date ' + t.getFullYear(), buckets: 'month' }
  const keys = wbFolioKeys(D)
  const key = k && D.WB_DATA.folio[k] ? k : keys.find((x) => { const f = D.WB_DATA.folio[x]; return f.start <= salesIso(t) && salesIso(t) <= f.end }) || keys[0]
  const f = key ? D.WB_DATA.folio[key] : null
  // A new agency has no folios yet: the current folio falls back to month to date.
  if (!f) return { start: new Date(t.getFullYear(), t.getMonth(), 1), end: t, label: 'Month to date', buckets: 'day' }
  return { start: isoToDate(f.start), end: new Date(Math.min(t.getTime(), isoToDate(f.end).getTime())), label: 'Folio ' + f.label.replace(' (in progress)', ''), buckets: 'day', folioKey: key }
}

/** Policies written in the period: the folio's AgencyZoom producer detail when there is one, otherwise the daily sales ledger. */
export function salesRows(D: PerfData, k: string, custom?: { from?: string; to?: string }) {
  const range = salesRange(D, k, custom), a = salesIso(range.start), b = salesIso(range.end), out: Sale[] = []
  const rep = range.folioKey ? D.AZ_REPORTS[range.folioKey] : null
  const detail = rep && rep.producerDetail && Object.keys(rep.producerDetail).length ? rep.producerDetail : null
  if (detail) {
    Object.values(detail).forEach((p: any) => (p.rows || []).forEach((r: any) => {
      const w = pDate(r.when); if (!w) return
      const day = salesIso(w); if (day < a || day > b) return
      const source = /farmers|foremost/i.test(r.carrier || '') ? 'Farmers' : 'Other'
      out.push({ prem: r.premium || 0, client: r.client, producer: r.producer || '', kind: r.line || '', carrier: r.carrier || '', source, book: salesBook(source, r.line), when: w, day })
    }))
  } else {
    Object.entries(D.WB_EXTRA.daily || {}).forEach(([day, v]: [string, any]) => {
      if (day < a || day > b) return
      ;(v.sales || []).forEach((s: any) => out.push({
        prem: s.premium || 0, client: s.name, producer: s.producer || '', kind: s.policyType || '', carrier: s.carrier || '', source: s.source,
        book: salesBook(s.source, s.policyType), when: isoToDate(day), day }))
    })
  }
  out.sort((x, y) => y.day.localeCompare(x.day) || y.prem - x.prem)
  return { written: out, undated: [] as Sale[], range }
}

/** Day buckets (short periods) or month buckets (year to date, long custom ranges) for the stacked chart. */
export function salesMonths(rows: Sale[], range: SalesRange): Month[] {
  const blank = (key: string, label: string, year: number | string): Month => ({ key, label, year: year as number, Commercial: 0, Farmers: 0, Retail: 0,
    cCommercial: 0, cFarmers: 0, cRetail: 0, n: 0, total: 0, priced: 0, pricedPrem: 0, ready: null })
  const out: Month[] = []
  if (range.buckets === 'day') {
    for (let d = new Date(range.start); d <= range.end; d.setDate(d.getDate() + 1)) out.push(blank(salesIso(d), (d.getMonth() + 1) + '/' + d.getDate(), ''))
  } else {
    for (let d = new Date(range.start.getFullYear(), range.start.getMonth(), 1); d <= range.end; d.setMonth(d.getMonth() + 1))
      out.push(blank(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), d.toLocaleString('en-US', { month: 'short' }), d.getFullYear()))
  }
  const idx: Record<string, Month> = {}
  out.forEach((m) => { idx[m.key] = m })
  rows.forEach((r) => {
    const m = idx[range.buckets === 'day' ? r.day : r.day.slice(0, 7)]; if (!m) return
    m[r.book] += r.prem; m[('c' + r.book) as 'cCommercial']++; m.n++; m.total += r.prem
    if (r.prem > 0) { m.priced++; m.pricedPrem += r.prem }
  })
  out.forEach((m) => { m.ready = m.n ? (m.priced / m.n) * 100 : null })
  return out
}

export function salesBy(rows: Sale[], key: 'producer' | 'kind' | 'book') {
  const g: Record<string, { label: string; value: number; n: number; pct: number }> = {}
  rows.forEach((r) => {
    const k = String(r[key] || '').trim() || 'Unassigned'
    const x = (g[k] = g[k] || { label: k, value: 0, n: 0, pct: 0 }); x.value += r.prem; x.n++
  })
  const list = Object.values(g).sort((a, b) => b.value - a.value), total = list.reduce((s, x) => s + x.value, 0)
  list.forEach((x) => { x.pct = total ? (x.value / total) * 100 : 0 })
  return list
}

/** Every number on the screen for one period. */
export function computeSales(D: PerfData, k: string, custom?: { from?: string; to?: string }) {
  const { written, undated, range } = salesRows(D, k, custom)
  const total = written.reduce((s, r) => s + r.prem, 0)
  const clients = new Set(written.map((r) => r.book + '|' + r.client)).size
  return {
    written, undated, range, total, clients,
    avg: written.length ? total / written.length : 0,
    ppc: clients ? written.length / clients : 0,
    months: salesMonths(written, range),
    byProducer: salesBy(written, 'producer'),
    byLine: salesBy(written, 'kind'),
    byBook: salesBy(written, 'book').map((x) => ({ ...x, label: D.BOOK_NAME[x.label] || x.label })),
    hasProducer: written.some((r) => r.producer),
  }
}
