// The owner's report PDFs: pick a period (this folio, last folio, a month, a quarter, the year to date, a full year or
// any range) and the reports to include, and get one tidy PDF — for the owner, the accountant or the year-end review.
// Everything comes from what Declara already holds: sold policies, the SDR transfers, the quoted pipeline, the payroll
// math Office Payroll uses, the vendor register and lead spend, the staff list and the compliance files.
import { loadScript } from './perf/commissionFiles'
import type { Json, PerfData } from './perf/data'
import { sdrData } from './perf/sdr'
import { getFolios } from './data'
import { getAccounts, getBookPolicies } from './books'
import { loadForesight } from './foresight'
import { getVendors, perMonth, KIND_LABEL } from './vendors'
import { getFiles, getMarks, getPeople, riskGaps } from './compliance'
import { loadPayday, loadSdrPeriods, type PayLine, type Staff } from './payrollCalc'
import { supabase } from './supabase'
import { atRisk, commercialQuotes } from './opportunities'

export interface PdfPeriod { label: string; from: string; to: string; folioKey?: string }
export type Section = 'summary' | 'producers' | 'lines' | 'carriers' | 'leadSources' | 'sdr' | 'opportunities' | 'payroll' | 'commissions' | 'sdrBonus' | 'vendors' | 'leadSpend' | 'payrollFiles' | 'people' | 'compliance'
export const SECTIONS: { key: Section; label: string; group: 'Sales & production' | 'For the accountant' | 'People & compliance'; note: string }[] = [
  { key: 'summary', label: 'Summary', group: 'Sales & production', note: 'Premium written, policies, customers, average premium' },
  { key: 'producers', label: 'Written by producer', group: 'Sales & production', note: 'Premium and policies per person' },
  { key: 'lines', label: 'Written by line', group: 'Sales & production', note: 'Auto, home, business…' },
  { key: 'carriers', label: 'Written by carrier', group: 'Sales & production', note: 'Where it was placed' },
  { key: 'leadSources', label: 'Sold by lead source & return on spend', group: 'Sales & production', note: 'Premium per $1 of lead spend' },
  { key: 'sdr', label: 'SDR transfers → sold', group: 'Sales & production', note: 'Close rate per producer and per SDR' },
  { key: 'opportunities', label: 'Top 10 opportunities (today)', group: 'Sales & production', note: 'At-risk accounts and open commercial quotes' },
  { key: 'payroll', label: 'Payroll register', group: 'For the accountant', note: 'Every payday in the period, by person: hours, salary, commission, bonuses' },
  { key: 'commissions', label: 'Commissions paid to producers', group: 'For the accountant', note: 'By payday and producer' },
  { key: 'sdrBonus', label: 'SDR bonuses paid', group: 'For the accountant', note: 'By payday and SDR' },
  { key: 'vendors', label: 'Vendors & software spend', group: 'For the accountant', note: 'From the vendor register, for the period' },
  { key: 'leadSpend', label: 'Lead spend by source', group: 'For the accountant', note: 'Recorded lead spend in the period' },
  { key: 'payrollFiles', label: 'Payroll files on file', group: 'For the accountant', note: 'The payroll provider files uploaded per payday' },
  { key: 'people', label: 'Headcount & employee retention', group: 'People & compliance', note: 'Hires, departures, retention and turnover rate' },
  { key: 'compliance', label: 'Compliance & risk gaps', group: 'People & compliance', note: 'Required records missing, expired or expiring' },
]
export const PRESETS: { key: string; label: string; sections: Section[] }[] = [
  { key: 'sales', label: 'Sales report', sections: ['summary', 'producers', 'lines', 'carriers', 'leadSources', 'sdr', 'opportunities'] },
  { key: 'accountant', label: 'For the accountant', sections: ['summary', 'payroll', 'commissions', 'sdrBonus', 'vendors', 'leadSpend', 'payrollFiles', 'people'] },
  { key: 'yearend', label: 'Year-end review', sections: ['summary', 'producers', 'lines', 'carriers', 'leadSources', 'sdr', 'payroll', 'commissions', 'sdrBonus', 'vendors', 'leadSpend', 'people', 'compliance'] },
  { key: 'all', label: 'Everything', sections: SECTIONS.map((s) => s.key) },
]

const m0 = (n: number) => (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US')
const m2 = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—')
const us = (iso: string) => iso.slice(5, 7) + '/' + iso.slice(8, 10) + '/' + iso.slice(0, 4)
const daysIn = (from: string, to: string) => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1)
/** paydays (the 5th and the 21st) that fall inside the period */
export function paydaysIn(from: string, to: string) {
  const out: string[] = []
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7))
  while (`${y}-${String(m).padStart(2, '0')}` <= to.slice(0, 7)) {
    for (const d of ['05', '21']) { const k = `${y}-${String(m).padStart(2, '0')}-${d}`; if (k >= from && k <= to) out.push(k) }
    m++; if (m > 12) { m = 1; y++ }
  }
  return out
}

export async function buildReportsPdf(o: { D: PerfData; period: PdfPeriod; sections: Section[]; agency: string; today: string; onProgress: (msg: string) => void }) {
  const { D, period, today } = o
  const want = new Set(o.sections)
  /* ---------- the sold policies in the period ---------- */
  const folios: Record<string, Json> = D.WB_DATA?.folio || {}
  // a folio: the folio's own sales (what Reports shows for it); any other dates: the daily sales ledger (what Sales KPIs
  // and the year to date use), since older folios aren't kept policy by policy
  const daily: Record<string, Json> = D.WB_EXTRA?.daily || {}
  const sales: Json[] = period.folioKey ? (folios[period.folioKey]?.sales || [])
    : Object.entries(daily).filter(([d]) => d >= period.from && d <= period.to).flatMap(([, x]) => x.sales || [])
  const sum = (rows: Json[]) => rows.reduce((t, s) => t + (Number(s.premium) || 0), 0)
  const group = (key: (s: Json) => string) => {
    const m = new Map<string, { n: number; p: number }>()
    for (const s of sales) { const k = key(s) || '—'; const x = m.get(k) || { n: 0, p: 0 }; x.n++; x.p += Number(s.premium) || 0; m.set(k, x) }
    return [...m.entries()].sort((a, b) => b[1].p - a[1].p)
  }
  const total = sum(sales)

  /* ---------- the PDF ---------- */
  o.onProgress('Loading the PDF maker…')
  const w = window as unknown as { jspdf?: { jsPDF: new (opts: object) => any } }
  if (!w.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
  const pdf = new w.jspdf!.jsPDF({ unit: 'pt', format: 'letter' })
  const W = 612, H = 792, L = 40, R = W - 40, CW = R - L, BOTTOM = H - 50
  type RGB = [number, number, number]
  const C: Record<string, RGB> = { navy: [22, 45, 120], blue: [22, 79, 236], ink: [30, 34, 48], muted: [110, 116, 134], line: [225, 229, 238], soft: [245, 247, 252], zebra: [250, 251, 254], red: [196, 43, 43], green: [22, 140, 80], amber: [190, 120, 20] }
  let y = 0, page = 1
  const font = (size: number, bold = false, c: RGB = C.ink) => { pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.setTextColor(c[0], c[1], c[2]) }
  const txt = (s: string, x: number, yy: number, size = 10, bold = false, c: RGB = C.ink, align?: 'right' | 'center') => { font(size, bold, c); pdf.text(s, x, yy, align ? { align } : undefined) }
  const fit = (s: string, size: number, maxW: number, bold = false) => { font(size, bold); let t = String(s); if (pdf.getTextWidth(t) <= maxW) return t; while (t.length > 1 && pdf.getTextWidth(t + '…') > maxW) t = t.slice(0, -1); return t + '…' }
  const fill = (c: RGB) => pdf.setFillColor(c[0], c[1], c[2])
  const footer = () => { txt(`${o.agency} · ${period.label} · made ${us(today)} in Declara`, L, H - 24, 8, false, C.muted); txt(`Page ${page}`, R, H - 24, 8, false, C.muted, 'right') }
  const newPage = () => { footer(); pdf.addPage(); page++; fill(C.navy); pdf.rect(0, 0, W, 34, 'F'); txt(`${o.agency} — ${period.label}`, L, 22, 10, true, [255, 255, 255]); y = 60 }
  const room = (h: number) => { if (y + h > BOTTOM) newPage() }
  // cover band
  fill(C.navy); pdf.rect(0, 0, W, 120, 'F'); fill(C.blue); pdf.rect(0, 120, W, 4, 'F')
  txt(o.agency, L, 44, 12, true, [200, 214, 255])
  txt('Agency reports', L, 76, 26, true, [255, 255, 255])
  txt(`${period.label}  ·  ${us(period.from)} – ${us(period.to)}`, L, 102, 11, false, [220, 228, 255])
  y = 150
  const h2 = (s: string, sub?: string) => { room(56); y += 8; txt(s, L, y, 15, true, C.navy); y += 6; fill(C.blue); pdf.rect(L, y, 40, 2.5, 'F'); y += 14; if (sub) { font(9, false, C.muted); const lines = pdf.splitTextToSize(sub, CW); pdf.text(lines, L, y); y += lines.length * 11 + 4 } }
  const note = (s: string) => { font(9, false, C.muted); const lines = pdf.splitTextToSize(s, CW); room(lines.length * 11 + 6); pdf.text(lines, L, y); y += lines.length * 11 + 6 }
  const kpis = (items: [string, string, string?][]) => {
    room(66); const n = items.length, gap = 10, bw = (CW - gap * (n - 1)) / n
    items.forEach(([label, value, sub], i) => {
      const x = L + i * (bw + gap); fill(C.soft); pdf.roundedRect(x, y, bw, 56, 6, 6, 'F')
      txt(fit(label.toUpperCase(), 7.5, bw - 16, true), x + 10, y + 16, 7.5, true, C.muted)
      txt(fit(value, 16, bw - 16, true), x + 10, y + 36, 16, true, C.ink)
      if (sub) txt(fit(sub, 8, bw - 16), x + 10, y + 49, 8, false, C.muted)
    })
    y += 68
  }
  /** a table: cols with widths (fractions of the page width) and alignment; long tables continue on the next page */
  const table = (cols: { h: string; w: number; r?: boolean }[], rows: (string | number)[][], foot?: (string | number)[]) => {
    const tw = cols.reduce((t, c) => t + c.w, 0), xs: number[] = []
    let acc = L; cols.forEach((c) => { xs.push(acc); acc += (c.w / tw) * CW })
    const cw = (i: number) => (cols[i].w / tw) * CW
    const head = () => { room(22); fill(C.navy); pdf.rect(L, y - 11, CW, 17, 'F'); cols.forEach((c, i) => txt(fit(c.h, 8, cw(i) - 8, true), c.r ? xs[i] + cw(i) - 4 : xs[i] + 4, y, 8, true, [255, 255, 255], c.r ? 'right' : undefined)); y += 16 }
    head()
    rows.forEach((r, k) => {
      if (y + 15 > BOTTOM) { newPage(); head() }
      if (k % 2) { fill(C.zebra); pdf.rect(L, y - 10, CW, 15, 'F') }
      r.forEach((v, i) => txt(fit(String(v ?? ''), 8.5, cw(i) - 8), cols[i].r ? xs[i] + cw(i) - 4 : xs[i] + 4, y, 8.5, false, C.ink, cols[i].r ? 'right' : undefined))
      y += 15
    })
    if (foot) { room(18); pdf.setDrawColor(C.navy[0], C.navy[1], C.navy[2]); pdf.line(L, y - 10, R, y - 10); foot.forEach((v, i) => txt(fit(String(v ?? ''), 8.5, cw(i) - 8, true), cols[i].r ? xs[i] + cw(i) - 4 : xs[i] + 4, y + 2, 8.5, true, C.ink, cols[i].r ? 'right' : undefined)); y += 18 }
    if (!rows.length) { txt('Nothing in this period.', L + 4, y, 9, false, C.muted); y += 14 }
    y += 8
  }
  const shareRows = (g: [string, { n: number; p: number }][]) => g.map(([k, x]) => [k, x.n, m0(x.p), pct(x.p, total), x.n ? m0(x.p / x.n) : '—'])
  const shareCols = (first: string) => [{ h: first, w: 3 }, { h: 'Policies', w: 1, r: true }, { h: 'Premium', w: 1.4, r: true }, { h: 'Share', w: 1, r: true }, { h: 'Avg premium', w: 1.3, r: true }]

  /* ---------- sales & production ---------- */
  if (want.has('summary')) {
    h2('Summary', `Written business in the period, from the policies AgencyZoom shows as sold${period.folioKey ? ' in this folio' : ''}.`)
    const customers = new Set(sales.map((s) => s.customerId || s.name)).size
    kpis([['Premium written', m0(total)], ['Policies', String(sales.length)], ['Customers', String(customers)], ['Avg premium', sales.length ? m0(total / sales.length) : '—']])
  }
  if (want.has('producers')) { h2('Written by producer'); const g = group((s) => s.producer); table(shareCols('Producer'), shareRows(g), ['Total', sales.length, m0(total), '100%', sales.length ? m0(total / sales.length) : '—']) }
  if (want.has('lines')) { h2('Written by line'); table(shareCols('Line'), shareRows(group((s) => s.policyType)), ['Total', sales.length, m0(total), '100%', '']) }
  if (want.has('carriers')) { h2('Written by carrier'); table(shareCols('Carrier'), shareRows(group((s) => s.carrier || s.source)), ['Total', sales.length, m0(total), '100%', '']) }

  const fs = want.has('leadSources') || want.has('leadSpend') ? await loadForesight().catch(() => null) : null
  const spendIn = (from: string, to: string) => {
    const m = new Map<string, number>()
    for (const r of fs?.spend || []) {
      const a = r.period_start > from ? r.period_start : from, b = r.period_end < to ? r.period_end : to
      if (b < a) continue
      m.set(r.source, (m.get(r.source) || 0) + r.amount * (daysIn(a, b) / Math.max(1, daysIn(r.period_start, r.period_end))))
    }
    return m
  }
  if (want.has('leadSources')) {
    h2('Sold by lead source & return on spend', 'Lead source is the one AgencyZoom has on each sold policy. Spend is the lead spend recorded on Declara Foresight for the same days. Premium per $1 = sold premium ÷ spend.')
    const spend = spendIn(period.from, period.to)
    // lead sources: the folio's sales carry them; for other dates, the sold policies Foresight reads (daily_sales)
    const src = period.folioKey ? sales.map((s) => ({ k: String(s.leadSource || '').trim(), p: Number(s.premium) || 0 }))
      : (fs?.sales || []).filter((x) => x.sale_date >= period.from && x.sale_date <= period.to).map((x) => ({ k: x.lead_source || '', p: x.premium }))
    const gm = new Map<string, { n: number; p: number }>()
    for (const x of src) { const k = x.k || 'No lead source'; const o = gm.get(k) || { n: 0, p: 0 }; o.n++; o.p += x.p; gm.set(k, o) }
    const g = [...gm.entries()].sort((a, b) => (a[0] === 'No lead source' ? 1 : b[0] === 'No lead source' ? -1 : b[1].p - a[1].p))
    const norm = (s: string) => s.trim().toLowerCase()
    const rows = g.map(([k, x]) => { const sp = [...spend.entries()].find(([n]) => norm(n) === norm(k))?.[1] || 0; return [k, x.n, m0(x.p), sp ? m0(sp) : '—', sp ? '$' + (x.p / sp).toFixed(2) : '—', sp && x.n ? m0(sp / x.n) : '—'] })
    table([{ h: 'Lead source', w: 3 }, { h: 'Policies', w: 1, r: true }, { h: 'Premium', w: 1.3, r: true }, { h: 'Spend', w: 1.2, r: true }, { h: 'Per $1', w: 1, r: true }, { h: 'Cost / policy', w: 1.2, r: true }], rows)
  }
  if (want.has('sdr')) {
    h2('SDR transfers to sold', 'Only SDR transfers count — not a producer’s other sales. Sold rate = SDR transfers sold ÷ SDR transfers.')
    const tr: Json[] = (sdrData(D).transfers || []).filter((t: Json) => { const d = String(t.dateTime || '').slice(0, 10); return d >= period.from && d <= period.to })
    const by = (key: (t: Json) => string) => { const m = new Map<string, { t: number; q: number; s: number; p: number }>(); for (const t of tr) { const k = key(t) || 'Unassigned'; const x = m.get(k) || { t: 0, q: 0, s: 0, p: 0 }; x.t++; if (t.azQualifies) x.q++; if (t.bound) { x.s++; x.p += Number(t.boundPremium) || 0 } m.set(k, x) } return [...m.entries()].sort((a, b) => b[1].s / (b[1].t || 1) - a[1].s / (a[1].t || 1)) }
    const cols = (f: string) => [{ h: f, w: 3 }, { h: 'Transfers', w: 1.1, r: true }, { h: 'Quoted', w: 1, r: true }, { h: 'Sold', w: 1, r: true }, { h: 'Sold rate', w: 1.1, r: true }, { h: 'Sold premium', w: 1.4, r: true }]
    const rows = (g: ReturnType<typeof by>) => g.map(([k, x]) => [k, x.t, x.q, x.s, pct(x.s, x.t), m0(x.p)])
    txt('By producer — SDR transfers received', L, y, 10, true, C.ink); y += 14; table(cols('Producer'), rows(by((t) => t.producer)))
    txt('By SDR — transfers sent', L, y, 10, true, C.ink); y += 14; table(cols('SDR'), rows(by((t) => t.sdr)))
  }
  if (want.has('opportunities')) {
    o.onProgress('Checking the book for accounts at risk…')
    h2('Top 10 opportunities (as of today)', 'Commercial accounts at risk of being lost come first (service work); the biggest open commercial quotes in the AgencyZoom pipeline make up the ten (producer work).')
    const [a, p] = await Promise.all([getAccounts(), getBookPolicies()])
    const risks = atRisk(a, p, today).filter((r) => /commercial/.test(r.account.book))
    const q = commercialQuotes(D, today)
    const rows = [...risks.slice(0, 10).map((r) => ['At risk · service', r.account.name, `${r.policy.product || ''} — ${r.issue}`, r.premium ? m0(r.premium) : '—', r.account.producer || 'Service']),
      ...q.top.map((l: Json) => ['Quote · producer', l.name, l.lines || '', m0(l.quotedPremium), l.producer || ''])].slice(0, 10)
    table([{ h: 'Type', w: 1.4 }, { h: 'Client', w: 2 }, { h: 'What', w: 3.8 }, { h: 'Premium', w: 1, r: true }, { h: 'Who works it', w: 1.4 }], rows)
  }

  /* ---------- for the accountant ---------- */
  const pays = paydaysIn(period.from, period.to)
  let payrolls: { pay: string; lines: PayLine[] }[] = []
  if (want.has('payroll') || want.has('commissions') || want.has('sdrBonus')) {
    const [fl, periods, staffR] = await Promise.all([getFolios(), loadSdrPeriods(), supabase.from('hr_staff').select('*').then((r) => { if (r.error) throw r.error; return r.data as Staff[] })])
    for (const [i, pay] of pays.entries()) {
      o.onProgress(`Adding up payroll ${i + 1} of ${pays.length} (${us(pay)})…`)
      const r = await loadPayday(pay, fl, periods, staffR, today)
      payrolls.push({ pay, lines: r.lines.who })
    }
    payrolls = payrolls.filter((p) => p.lines.length)
  }
  const col = (k: keyof PayLine) => payrolls.reduce((t, p) => t + p.lines.reduce((u, l) => u + (Number(l[k]) || 0), 0), 0)
  if (want.has('payroll')) {
    h2('Payroll register', `${pays.length} payday${pays.length === 1 ? '' : 's'} in the period, worked out the way Office Payroll does: hours × rate, 1/24 of salaries, producers’ commission and SDR bonuses on the 21st, and agency bonuses. Compare with your payroll provider’s reports (listed under Payroll files).`)
    kpis([['Total payroll', m0(col('total'))], ['Hourly pay', m0(col('pay'))], ['Salaries', m0(col('salary'))], ['Commission + bonuses', m0(col('comm') + col('bonus') + col('cash'))]])
    const per = new Map<string, PayLine>()
    for (const p of payrolls) for (const l of p.lines) { const x = per.get(l.name) || { ...l, hours: 0, pay: 0, salary: 0, comm: 0, bonus: 0, cash: 0, total: 0 }; x.hours += l.hours; x.pay += l.pay; x.salary += l.salary; x.comm += l.comm; x.bonus += l.bonus; x.cash += l.cash; x.total += l.total; per.set(l.name, x) }
    txt('By person, for the whole period', L, y, 10, true); y += 14
    const pc = [{ h: 'Name', w: 2.4 }, { h: 'Hours', w: 0.9, r: true }, { h: 'Hourly pay', w: 1.2, r: true }, { h: 'Salary', w: 1.2, r: true }, { h: 'Commission', w: 1.2, r: true }, { h: 'SDR bonus', w: 1.1, r: true }, { h: 'Agency bonus', w: 1.4, r: true }, { h: 'Total', w: 1.2, r: true }]
    table(pc, [...per.values()].sort((a, b) => b.total - a.total).map((l) => [l.name, l.hours.toFixed(1), m2(l.pay), m2(l.salary), m2(l.comm), m2(l.bonus), m2(l.cash), m2(l.total)]),
      ['Total', col('hours').toFixed(1), m2(col('pay')), m2(col('salary')), m2(col('comm')), m2(col('bonus')), m2(col('cash')), m2(col('total'))])
    txt('By payday', L, y, 10, true); y += 14
    table([{ h: 'Payday', w: 1.4 }, { h: 'People', w: 0.9, r: true }, { h: 'Hourly pay', w: 1.3, r: true }, { h: 'Salary', w: 1.3, r: true }, { h: 'Commission', w: 1.3, r: true }, { h: 'Bonuses', w: 1.3, r: true }, { h: 'Total', w: 1.3, r: true }],
      payrolls.map((p) => { const s = (k: keyof PayLine) => p.lines.reduce((t, l) => t + (Number(l[k]) || 0), 0); return [us(p.pay), p.lines.length, m2(s('pay')), m2(s('salary')), m2(s('comm')), m2(s('bonus') + s('cash')), m2(s('total'))] }))
  }
  if (want.has('commissions')) {
    h2('Commissions paid to producers', 'Paid on the 21st for the folio that closed the month before.')
    const rows = payrolls.flatMap((p) => p.lines.filter((l) => l.comm).map((l) => [us(p.pay), l.name, m2(l.comm)]))
    table([{ h: 'Payday', w: 1.4 }, { h: 'Producer', w: 3 }, { h: 'Commission', w: 1.4, r: true }], rows, ['Total', '', m2(col('comm'))])
  }
  if (want.has('sdrBonus')) {
    h2('SDR bonuses paid', 'Paid on the 21st for the previous month’s transfers.')
    const rows = payrolls.flatMap((p) => p.lines.filter((l) => l.bonus).map((l) => [us(p.pay), l.name, m2(l.bonus)]))
    table([{ h: 'Payday', w: 1.4 }, { h: 'SDR', w: 3 }, { h: 'Bonus', w: 1.4, r: true }], rows, ['Total', '', m2(col('bonus'))])
  }
  if (want.has('vendors')) {
    o.onProgress('Adding up vendor spend…')
    h2('Vendors & software spend', 'Estimated from the vendor register for the period: each active vendor’s cost turned into a monthly amount, times the months in the period. Check against the statements.')
    const vs = await getVendors().catch(() => [])
    const months = daysIn(period.from, period.to) / 30.4375
    const live = vs.filter((v) => v.active || (v.renews_on && v.renews_on >= period.from))
    const rows = live.map((v) => [v.name, KIND_LABEL[v.kind], v.cost != null ? m2(v.cost) + ' ' + v.billing.replace('_', '-') : '—', m2(perMonth(v)), m0(perMonth(v) * months)])
    table([{ h: 'Vendor', w: 2.6 }, { h: 'Type', w: 1.3 }, { h: 'Cost', w: 1.8, r: true }, { h: 'Per month', w: 1.2, r: true }, { h: 'In period', w: 1.2, r: true }], rows,
      ['Total', '', '', m2(live.reduce((t, v) => t + perMonth(v), 0)), m0(live.reduce((t, v) => t + perMonth(v), 0) * months)])
  }
  if (want.has('leadSpend')) {
    h2('Lead spend by source', 'The lead spend recorded on Declara Foresight, counted for the days of each record that fall in the period.')
    const spend = spendIn(period.from, period.to)
    table([{ h: 'Source', w: 3 }, { h: 'Spend in period', w: 1.5, r: true }], [...spend.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, m2(v)]), ['Total', m2([...spend.values()].reduce((t, v) => t + v, 0))])
  }
  if (want.has('payrollFiles')) {
    h2('Payroll files on file', 'The payroll provider’s reports and signed copies uploaded to each payday on Office Payroll.')
    const { data } = await supabase.from('documents').select('file_name, storage_path, created_at').eq('category', 'payroll')
    const rows = (data || []).map((d: Json) => ({ pay: (String(d.storage_path).match(/\/payroll\/(\d{4}-\d{2}-\d{2})\//) || [])[1] || '', f: d.file_name, at: String(d.created_at || '').slice(0, 10) })).filter((r) => r.pay >= period.from && r.pay <= period.to).sort((a, b) => a.pay.localeCompare(b.pay))
    table([{ h: 'Payday', w: 1.3 }, { h: 'File', w: 4 }, { h: 'Uploaded', w: 1.3 }], rows.map((r) => [us(r.pay), r.f, r.at ? us(r.at) : '']))
    // only paydays Declara worked out payroll for (when the register is in this PDF); otherwise every past payday
    const due = payrolls.length ? payrolls.map((p) => p.pay) : pays.filter((p) => p <= today)
    const missing = due.filter((p) => !rows.some((r) => r.pay === p))
    if (missing.length) note(`No payroll file uploaded for: ${missing.map(us).join(', ')}.`)
  }

  /* ---------- people & compliance ---------- */
  if (want.has('people') || want.has('compliance')) {
    const people = await getPeople()
    if (want.has('people')) {
      h2('Headcount & employee retention', 'Retention rate = people employed on the first day of the period who were still employed on the last day. Turnover = departures ÷ average headcount.')
      const { data: full } = await supabase.from('hr_staff').select('name, role, hired_on, left_on, leave_reason, active')
      const staff = (full || []) as { name: string; role: string | null; hired_on: string | null; left_on: string | null; leave_reason: string | null; active: boolean }[]
      const on = (d: string) => staff.filter((s) => (!s.hired_on || s.hired_on <= d) && (!s.left_on || s.left_on >= d) && (s.active || s.left_on))
      const atStart = on(period.from), atEnd = on(period.to < today ? period.to : today)
      const stayed = atStart.filter((s) => !s.left_on || s.left_on > (period.to < today ? period.to : today))
      const hires = staff.filter((s) => s.hired_on && s.hired_on >= period.from && s.hired_on <= period.to)
      const gone = staff.filter((s) => s.left_on && s.left_on >= period.from && s.left_on <= period.to)
      const avg = (atStart.length + atEnd.length) / 2
      kpis([['Retention rate', pct(stayed.length, atStart.length), `${stayed.length} of ${atStart.length} stayed`], ['Turnover', pct(gone.length, avg), `${gone.length} left`], ['Hires', String(hires.length)], ['Headcount now', String(atEnd.length), `${atStart.length} at the start`]])
      if (hires.length) { txt('Hired', L, y, 10, true); y += 14; table([{ h: 'Name', w: 2.5 }, { h: 'Role', w: 2 }, { h: 'Started', w: 1.3 }], hires.map((s) => [s.name, s.role || '', s.hired_on ? us(s.hired_on) : ''])) }
      if (gone.length) { txt('Left', L, y, 10, true); y += 14; table([{ h: 'Name', w: 2.2 }, { h: 'Role', w: 1.6 }, { h: 'Last day', w: 1.2 }, { h: 'Reason', w: 2.6 }], gone.map((s) => [s.name, s.role || '', s.left_on ? us(s.left_on) : '', s.leave_reason || ''])) }
      if (!hires.length && !gone.length) note('No hires or departures in the period.')
    }
    if (want.has('compliance')) {
      o.onProgress('Checking compliance files…')
      const [files, marks] = await Promise.all([getFiles().catch(() => []), getMarks().catch(() => [])])
      const gaps = riskGaps(files, people, today, marks)
      h2('Compliance & risk gaps (as of today)', 'Required records that are missing, expired or about to expire, from HR › Employee files and Agency legal & tax. Items the accountant keeps, or that don’t apply, are left out.')
      kpis([['Files on file', String(files.length)], ['Risk gaps', String(gaps.length)], ['Expired', String(gaps.filter((g) => g.status.state === 'expired').length)], ['Expiring in 60 days', String(gaps.filter((g) => g.status.state === 'soon').length)]])
      table([{ h: 'Who', w: 1.8 }, { h: 'Record', w: 4 }, { h: 'Status', w: 1.8 }], gaps.slice(0, 60).map((g) => [g.who, g.type.label, g.status.text]))
      if (gaps.length > 60) note(`…and ${gaps.length - 60} more on HR › Employee files.`)
    }
  }

  footer()
  const name = `${o.agency.replace(/[^a-z0-9]+/gi, '-')}-reports-${period.from}-to-${period.to}.pdf`.replace(/^-+/, '')
  pdf.save(name)
}
