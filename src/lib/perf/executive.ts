// Everything the Executive Dashboard computes, as plain functions over PerfData. Ported from engine.js
// (execRows, execMonths, bookMix, execProdRange, execProduction, execAttention, execExceptions and the
// body of renderExecutive) so the figures match the original screen exactly.
import { rbKey, wbFolioKeys, type Json, type PerfData } from './data'

export const money0 = (n: number) => '$' + Math.round(Number(n)).toLocaleString('en-US')

/** "MM/DD/YYYY" → local midnight, as the original screens read policy dates. */
export function pDate(s: string | null | undefined) {
  if (!s) return null
  const [m, d, y] = s.split('/').map(Number)
  return new Date(y, m - 1, d)
}
export const today = () => new Date()
export const today0 = () => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()) }
/** Whole calendar days until a policy date; 99999 when there is none. */
export function daysUntil(s: string | null | undefined) {
  const d = pDate(s)
  return d ? Math.round((d.getTime() - today0().getTime()) / 86400000) : 99999
}
export const bUS = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? m[2] + '/' + m[3] + '/' + m[1] : String(iso || '') }
export const rbLine = (D: PerfData, p: Json) => D.RB_LINES[p.product] || p.product
export const rbHasDoc = (D: PerfData, p: Json) => !!D.RETAIL_DOCS[p.id]

export type Book = 'Commercial' | 'Farmers' | 'Retail'
export interface Row {
  book: Book; label: string; client: string; clientId: string; kind: string; carrier: string; prem: number
  exp: string | null; eff: string | null; producer?: string | null; pid?: string; status?: string; doc?: boolean
}

export function execRows(D: PerfData): Row[] {
  const rows: Row[] = []
  ;(D.DATA.commercial || []).forEach((c) => c.locations.forEach((l: Json) => l.policies.forEach((p: Json) => rows.push({
    book: 'Commercial', label: l.name, client: c.name, clientId: c.id,
    kind: p.kind, carrier: p.carrier, prem: p.annualPremium || 0, exp: p.expiration || null, eff: p.effective || null }))))
  D.DATA.farmers.forEach((c) => c.policies.forEach((p: Json) => rows.push({
    book: 'Farmers', label: c.name, client: c.name, clientId: c.id,
    kind: p.productType, carrier: p.carrier || 'Farmers Insurance', prem: p.annualPremium || 0,
    exp: p.renewal || null, eff: p.inception || null, producer: p.producer || null, pid: p.id })))
  D.CB_BINDERS.forEach((c) => {
    rows.push({ book: 'Commercial', label: c.dba, client: c.name, clientId: c.id, kind: c.kind || 'Casualty', carrier: c.carrier, prem: c.total || 0,
      exp: bUS(c.renewal), eff: bUS(c.start), producer: c.producer || null })
    ;(c.other || []).forEach((o: Json) => rows.push({
      book: /farmers|truck insurance/i.test(o.carrier) ? 'Farmers' : 'Commercial',
      label: c.dba, client: c.name, clientId: c.id, kind: o.kind, carrier: o.carrier,
      prem: o.premium || 0, exp: bUS(o.renewal), eff: bUS(o.start), producer: c.producer || null }))
  })
  D.RB.forEach((p) => rows.push({
    book: 'Retail', label: p.insured, client: p.insured, clientId: p.clientKey || rbKey(p.insured),
    kind: rbLine(D, p), carrier: p.broker, prem: p.premium || 0, exp: p.termTo || null,
    eff: p.termFrom || null, status: p.status, doc: rbHasDoc(D, p) }))
  return rows
}

export interface Month {
  key: string; label: string; year: number; Commercial: number; Farmers: number; Retail: number
  cCommercial: number; cFarmers: number; cRetail: number; n: number; total: number; priced: number; pricedPrem: number; ready: number | null
}
/** Monthly renewal buckets from the month of `from` to the month of `to` (at most 24). Unlike execMonths,
 *  past months are allowed, so a custom range that has already started still charts. */
export function renewalMonths(rows: Row[], from: Date, to: Date): Month[] {
  const out: Month[] = []
  for (let dt = new Date(from.getFullYear(), from.getMonth(), 1); dt <= to && out.length < 24; dt = new Date(dt.getFullYear(), dt.getMonth() + 1, 1)) {
    out.push({ key: dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0'), label: dt.toLocaleString('en-US', { month: 'short' }), year: dt.getFullYear(),
      Commercial: 0, Farmers: 0, Retail: 0, cCommercial: 0, cFarmers: 0, cRetail: 0, n: 0, total: 0, priced: 0, pricedPrem: 0, ready: null })
  }
  const idx: Record<string, Month> = {}
  out.forEach((m) => { idx[m.key] = m })
  rows.forEach((r) => {
    const dt = pDate(r.exp); if (!dt) return
    const m = idx[dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0')]; if (!m) return
    m[r.book] += r.prem; m[('c' + r.book) as 'cCommercial']++; m.n++; m.total += r.prem
    if (r.prem > 0) { m.priced++; m.pricedPrem += r.prem }
  })
  out.forEach((m) => { m.ready = m.n ? (m.priced / m.n) * 100 : null })
  return out
}

/* Only the four lines the owner tracks; anything outside them is counted and reported under the bars. */
const BOOK_MIX_LINES: { label: string; test: (k: string) => boolean }[] = [
  { label: 'Personal Auto', test: (k) => /^AUTO MONOLINE$/i.test(k) },
  { label: 'Commercial Auto', test: (k) => /AUTO/i.test(k) && !/^AUTO MONOLINE$/i.test(k) },
  { label: 'General Liability', test: (k) => /GENERAL LIABILITY|\bGL\b/i.test(k) },
  { label: "Workers' Comp", test: (k) => /WORK\s?COMP|WORKERS?\s+COMPENSATION/i.test(k) },
]
export interface Bar { label: string; value: number; pct?: number; sub?: string; n?: number; go?: { book: Book; id: string } }
export function bookMix(rows: Row[]) {
  const out = BOOK_MIX_LINES.map((l) => ({ label: l.label, value: 0, n: 0, pct: 0 }))
  let other = 0, otherN = 0
  rows.forEach((r) => {
    const i = BOOK_MIX_LINES.findIndex((l) => l.test(r.kind || ''))
    if (i < 0) { other += r.prem || 0; otherN++; return }
    out[i].value += r.prem || 0; out[i].n++
  })
  const shown = out.reduce((s, l) => s + l.value, 0)
  out.forEach((l) => { l.pct = shown ? (l.value / shown) * 100 : 0 })
  return { lines: out.filter((l) => l.n > 0), empty: out.filter((l) => l.n === 0), other, otherN, shown }
}

/* ---------- production window ---------- */
export interface ProdRange { key?: string; start: string; end: string; label: string; folio?: string; folios?: string[] }
export function execProdRange(D: PerfData, k: string): ProdRange {
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const ks = wbFolioKeys(D)
  if (k === 'folio' || k === 'last') {
    const key = k === 'folio' ? ks[0] : ks[1]; const f = D.WB_DATA.folio[key]
    return { key, start: f.start, end: f.end, label: f.label.replace(' (in progress)', ''), folio: key }
  }
  if (k === 'all') {
    const first = D.WB_DATA.folio[ks[ks.length - 1]], last = D.WB_DATA.folio[ks[0]]
    return { start: first.start, end: last.end, label: 'All folios · ' + first.start + ' to ' + last.end, folios: ks }
  }
  const t = today0(); let s: Date
  if (k === 'wtd') { s = new Date(t); const dow = (t.getDay() + 6) % 7; s.setDate(t.getDate() - dow) }
  else if (k === 'mtd') s = new Date(t.getFullYear(), t.getMonth(), 1)
  else if (k === 'qtd') s = new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1)
  else s = new Date(t.getFullYear(), 0, 1)
  return { start: iso(s), end: iso(t), label: (D.EXEC_PROD_WINDOWS.find((w) => w[0] === k) || [])[1] + ' · ' + iso(s) + ' to ' + iso(t) }
}
export function execProduction(D: PerfData, k: string) {
  const r = execProdRange(D, k); const Dd = D.WB_EXTRA.daily || {}; const Q = (D.WB_EXTRA.quotes || { byDay: {} }).byDay || {}
  const days = Object.keys(Dd).filter((d) => d >= r.start && d <= r.end).sort()
  const sales: Json[] = []
  days.forEach((d) => (Dd[d].sales || []).forEach((x: Json) => sales.push({ date: d, ...x })))
  const prem = sales.reduce((a, x) => a + (x.premium || 0), 0)
  const cust = new Set(sales.map((x) => x.customerId || x.name)).size
  const byP: Record<string, { n: number; p: number }> = {}
  sales.forEach((x) => { byP[x.producer] = byP[x.producer] || { n: 0, p: 0 }; byP[x.producer].n++; byP[x.producer].p += x.premium || 0 })
  const qdays = Object.keys(Q).filter((d) => d >= r.start && d <= r.end)
  const quotes = qdays.reduce((a, d) => a + (Q[d].count || 0), 0), qprem = qdays.reduce((a, d) => a + (Q[d].premium || 0), 0)
  const folios = r.folios || (r.folio ? [r.folio] : [])
  const comm = folios.reduce((a, kk) => a + Object.values((D.WB_DATA.commissionsByFolio || {})[kk] || {}).reduce((x: number, v: Json) => x + (v.totalCommission || 0), 0), 0)
  const official = folios.reduce((a, kk) => a + (((D.WB_DATA.folio[kk] || {} as Json).official || {}).pcPremium || 0), 0)
  const byDay = days.map((d) => ({ label: d.slice(5), value: Dd[d].total || 0, text: money0(Dd[d].total || 0) + ' · ' + d }))
  return { r, sales, prem, cust, byP, quotes, qprem, comm, official, folios, byDay, days: days.length }
}
export const isFarmersCarrier = (c: string) => /farmers|foremost|bristol|toggle|kraft/i.test(c || '')

/* ---------- attention and exceptions ---------- */
export interface Attention { tone: 'bad' | 'warn' | 'info'; t: string; s: string; tag: string; tagBg: string; tagFg: string }
export function execAttention(o: { expired: Row[]; total: number; priced: number; undated: number; clients: number; mono: number }): Attention[] {
  const sum = (a: Row[]) => a.reduce((s, r) => s + (r.prem || 0), 0)
  const items: Attention[] = []
  if (o.expired.length) items.push({ tone: 'bad', t: o.expired.length + ' expired policies', s: money0(sum(o.expired)) + ' of premium past its expiration date', tag: 'Due today', tagBg: '#FDECEC', tagFg: '#B3261E' })
  const unpriced = o.total - o.priced
  if (unpriced) items.push({ tone: 'warn', t: unpriced + ' policies require pricing', s: 'No premium on file, so every total above is a floor', tag: 'Review', tagBg: '#FFF3DF', tagFg: '#8A5100' })
  if (o.undated) items.push({ tone: 'warn', t: o.undated + ' policies have no expiration date', s: 'They cannot appear in the renewal pipeline until a date is added', tag: 'Review', tagBg: '#FFF3DF', tagFg: '#8A5100' })
  if (o.mono) items.push({ tone: 'info', t: o.mono + ' of ' + o.clients + ' clients are monoline', s: 'Each one is a second-line conversation', tag: 'Monitor', tagBg: '#e8f1ff', tagFg: '#164fec' })
  return items.slice(0, 4)
}

export interface Exception { sev: 'critical' | 'serious' | 'warning'; what: string; why: string; amt: number | null; go?: { book: Book; id: string } }
export function execExceptions(D: PerfData, rows: Row[], expired: Row[], undated: number, priced: number, docs: number): Exception[] {
  const items: Exception[] = []
  const rbGo = (p: Json) => ({ book: 'Retail' as Book, id: p.clientKey || rbKey(p.insured) })
  expired.forEach((r) => items.push({ sev: 'critical', what: r.label + ' — ' + r.kind,
    why: 'Expired ' + r.exp + ' (' + Math.abs(daysUntil(r.exp)) + ' days ago) with no renewal recorded.', amt: r.prem, go: { book: r.book, id: r.clientId } }))
  D.RB.filter((p) => p.status === 'Canceled').forEach((p) => items.push({ sev: 'serious', what: p.insured + ' — ' + rbLine(D, p),
    why: 'Policy shows Canceled in the carrier list; confirm it was rewritten.', amt: p.premium || 0, go: rbGo(p) }))
  // A dec whose term ran out while the carrier list still shows the policy in force: the renewal dec never came in.
  const rbLapsed = (p: Json) => p.termTo && p.status === 'In Force' && daysUntil(p.termTo) < 0
  D.RB.filter(rbLapsed).forEach((p) => items.push({ sev: 'serious', what: p.insured + ' — renewal dec outstanding',
    why: 'Dec on file expired ' + p.termTo + ' (' + Math.abs(daysUntil(p.termTo)) + ' days ago) but the carrier list still shows the policy in force. Pull the renewal dec.',
    amt: p.premium || 0, go: rbGo(p) }))
  D.RB.filter((p) => p.termNote && !rbLapsed(p)).forEach((p) => items.push({ sev: 'warning', what: p.insured + ' — term mismatch',
    why: 'The attached declarations page covers a different term than the policy list shows.', amt: p.premium || 0, go: rbGo(p) }))
  D.RB.filter((p) => p.numberNote || p.nameNote).forEach((p) => items.push({ sev: 'warning', what: p.insured + ' — record mismatch',
    why: (p.numberNote ? 'Policy number' : 'Insured name') + ' on the document differs from the carrier list.', amt: p.premium || 0, go: rbGo(p) }))
  items.push({ sev: 'warning', what: undated + ' policies have no expiration date', why: 'They cannot appear in the renewal pipeline until a term date is on file.', amt: null })
  items.push({ sev: 'warning', what: rows.length - priced + ' policies have no premium', why: 'Book totals understate reality by this many policies.', amt: null })
  items.push({ sev: 'warning', what: rows.length - docs + ' policies have no document', why: 'No dec sheet or information page attached to verify terms against.', amt: null })
  const order = { critical: 0, serious: 1, warning: 2 }
  return items.sort((a, b) => order[a.sev] - order[b.sev] || (b.amt || 0) - (a.amt || 0))
}

/* ---------- the dashboard ---------- */
export interface Filters { period: string; book: string; line: string; customStart: string; customEnd: string; prod: string }
export interface Client { name: string; book: Book; id: string; n: number; p: number }
export interface Drill { title: string; sub: string; how: string; kind?: 'clients'; items: (Row | Client)[] }

const isoLocal = (s: string) => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const fmtDate = (s: string) => { const d = isoLocal(s); return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : s }

export function computeExecutive(D: PerfData, rows: Row[], f: Filters) {
  const isCustom = f.period === 'custom'
  const win = isCustom ? null : D.PERIODS[f.period].days
  const scoped = rows.filter((r) => (f.book === 'all' || r.book === f.book) && (f.line === 'all' || r.kind === f.line))
  const inWin = scoped.filter((r) => {
    if (isCustom) {
      if (!f.customStart && !f.customEnd) return true
      if (!r.exp) return false
      const d = pDate(r.exp); if (!d) return false
      if (f.customStart && d < isoLocal(f.customStart)!) return false
      if (f.customEnd && d > isoLocal(f.customEnd)!) return false
      return true
    }
    if (win! >= 99999) return true
    if (!r.exp) return false
    const d = daysUntil(r.exp); return d >= 0 && d <= win!
  })
  const sum = (a: Row[]) => a.reduce((s, r) => s + (r.prem || 0), 0)
  /* The renewals the selected period covers: dated policies in the window. Presets look forward from
     today; a custom range can include dates already past. */
  const renewing = inWin.filter((r) => pDate(r.exp) && (isCustom || daysUntil(r.exp) >= 0))
  const byDate = renewing.map((r) => pDate(r.exp)!.getTime())
  const t0 = today0()
  const chartFrom = isCustom ? isoLocal(f.customStart) || (byDate.length ? new Date(Math.min(...byDate)) : t0) : t0
  const chartTo = isCustom ? isoLocal(f.customEnd) || (byDate.length ? new Date(Math.max(...byDate)) : t0)
    : win! >= 99999 ? new Date(t0.getFullYear(), t0.getMonth() + 11, 1) : new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + win!)
  const months = renewalMonths(renewing, chartFrom, chartTo)
  const monthsCapped = new Date(chartTo.getFullYear(), chartTo.getMonth(), 1) > new Date(chartFrom.getFullYear(), chartFrom.getMonth() + 23, 1)
  const total = sum(scoped), winPrem = sum(renewing)
  const priced = scoped.filter((r) => r.prem > 0).length
  const dated = scoped.filter((r) => r.exp && pDate(r.exp)).length
  const undated = scoped.length - dated
  const expired = scoped.filter((r) => r.exp && daysUntil(r.exp) < 0)
  const docs = D.RB.filter((p) => rbHasDoc(D, p)).length + Object.keys(D.FARMERS_DECS).length

  const cmap: Record<string, Client> = {}
  scoped.forEach((r) => { const k = r.book + '|' + r.client; cmap[k] = cmap[k] || { name: r.client, book: r.book, id: r.clientId, n: 0, p: 0 }; cmap[k].n++; cmap[k].p += r.prem })
  const clients = Object.values(cmap)
  const ppc = clients.length ? scoped.length / clients.length : 0
  const mono = clients.filter((c) => c.n === 1)

  const carr: Record<string, number> = {}
  scoped.forEach((r) => { carr[r.carrier] = (carr[r.carrier] || 0) + r.prem })
  const carriers: Bar[] = Object.entries(carr).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, pct: total ? (v / total) * 100 : 0 }))
  const kindsAll = [...new Set(rows.map((r) => r.kind))].sort()
  const topClients: Bar[] = [...clients].sort((a, b) => b.p - a.p).slice(0, 8)
    .map((c) => ({ label: c.name, sub: c.book + ' · ' + c.n + ' ' + (c.n === 1 ? 'policy' : 'policies'), value: c.p, pct: total ? (c.p / total) * 100 : 0, go: { book: c.book, id: c.id } }))
  const monoTargets: Bar[] = [...mono].sort((a, b) => b.p - a.p).slice(0, 6)
    .map((c) => ({ label: c.name, sub: D.BOOK_NAME[c.book], value: c.p, go: { book: c.book, id: c.id } }))

  const daysSince = (d: string | null) => { const t = pDate(d); return t ? Math.floor((today().getTime() - t.getTime()) / 86400000) : null }
  const newBiz = scoped.filter((r) => { const a = daysSince(r.eff); return a !== null && a >= 0 && a <= 365 })
  const newBizPrem = newBiz.reduce((s, r) => s + (r.prem || 0), 0)
  const terminated = scoped.filter((r) => (r.status && /cancel|lapse|non-?renew|expired/i.test(r.status)) || (r.exp && daysUntil(r.exp) < 0))
  const inForce = scoped.length - terminated.length
  const retention = scoped.length ? (inForce / scoped.length) * 100 : 0
  const atRisk = sum(terminated)
  const opps = renewing.filter((r) => r.prem > 0)
    .sort((a, b) => b.prem - a.prem).slice(0, 5)
    .map((r) => {
      const c = clients.find((c) => c.name === r.client && c.book === r.book)
      return { name: r.client, book: r.book, id: r.clientId, when: r.exp!, prem: r.prem, play: c && c.n === 1 ? 'Add a second line' : 'Expand coverage' }
    })

  const PW = execProduction(D, f.prod)
  const cv = PW.quotes && PW.quotes >= PW.sales.length ? Math.round((PW.sales.length / PW.quotes) * 100) + '%' : null
  /* The values the Metric Components drawer shows as live (engine.js DASH_LAST for the executive module). */
  const liveKpis = ([
    { label: 'Written Premium', value: money0(total) }, { label: 'Retention %', value: retention.toFixed(1) + '%' },
    { label: 'Policies per Customer', value: ppc.toFixed(2) }, { label: 'Premium at risk', value: money0(atRisk) },
    { label: 'Net growth', value: money0(newBizPrem - atRisk) }, { label: 'Policies Sold', value: String(PW.sales.length) },
    { label: 'New Customers', value: String(PW.cust) }, { label: 'Revenue / Commission', value: PW.folios.length ? money0(PW.comm) : null },
    { label: 'Quotes', value: String(PW.quotes) }, { label: 'Quote to Sale %', value: cv },
    { label: 'Premium vs Goal %', value: D.GOALS.premium ? Math.round((total / D.GOALS.premium) * 100) + '%' : null },
  ] as { label: string; value: string | null }[]).filter((k) => k.value != null) as { label: string; value: string }[]

  const inForceRows = scoped.filter((r) => terminated.indexOf(r) === -1)
  const drills: Record<string, Drill> = {
    premium: { title: 'Written premium', sub: money0(total) + ' across ' + scoped.length + ' policies',
      how: 'Every policy in the current view. Policies with no premium on file count as zero.', items: [...scoped].sort((a, b) => b.prem - a.prem) },
    retention: { title: 'Retention rate', sub: inForce + ' of ' + scoped.length + ' policies in force (' + retention.toFixed(1) + '%)',
      how: 'The policies working against retention: expired, cancelled or lapsed.', items: [...terminated].sort((a, b) => b.prem - a.prem) },
    atrisk: { title: 'Premium at risk', sub: money0(atRisk) + ' across ' + terminated.length + ' policies',
      how: 'Premium on every policy past its expiration date or carrying a cancelled or lapsed status.', items: [...terminated].sort((a, b) => b.prem - a.prem) },
    ppc: { title: 'Policies per client', sub: ppc.toFixed(2) + ' across ' + clients.length + ' clients',
      how: 'Each client and how many policies they carry. Anyone at one is a cross-sell conversation.', kind: 'clients', items: [...clients].sort((a, b) => a.n - b.n || b.p - a.p) },
    growth: { title: 'Net growth', sub: money0(newBizPrem) + ' written in, ' + money0(atRisk) + ' lost',
      how: 'New business written in the last 12 months, followed by everything expired, cancelled or lapsed.',
      items: [...newBiz].sort((a, b) => b.prem - a.prem).concat([...terminated].sort((a, b) => b.prem - a.prem)) },
    inforce: { title: 'Policies in force', sub: inForce + ' policies', how: 'Everything in the view that is not expired, cancelled or lapsed.', items: [...inForceRows].sort((a, b) => b.prem - a.prem) },
    renewing: { title: 'Renewing this period', sub: money0(winPrem) + ' across ' + renewing.length + ' policies',
      how: 'Policies with a renewal date falling inside the selected period.', items: [...renewing].sort((a, b) => (pDate(a.exp)?.getTime() || 0) - (pDate(b.exp)?.getTime() || 0)) },
    clients: { title: 'Clients', sub: clients.length + ' clients, ' + mono.length + ' of them monoline', how: 'Every client in the view with their policy count and premium.',
      kind: 'clients', items: [...clients].sort((a, b) => b.p - a.p) },
    newbiz: { title: 'New business, last 12 months', sub: money0(newBizPrem) + ' across ' + newBiz.length + ' policies',
      how: 'Policies whose start date falls within the last 12 months.', items: [...newBiz].sort((a, b) => b.prem - a.prem) },
  }

  const periodLabel = isCustom
    ? (f.customStart || f.customEnd ? 'Custom range' + (f.customStart ? ' from ' + fmtDate(f.customStart) : '') + (f.customEnd ? ' through ' + fmtDate(f.customEnd) : '') : 'Custom range')
    : D.PERIODS[f.period].label

  return {
    scoped, inWin, renewing, winPrem, months, monthsCapped, total, priced, dated, undated, expired, docs, clients, ppc, mono, carriers, kindsAll, topClients, monoTargets,
    newBiz, newBizPrem, terminated, inForce, retention, atRisk, opps, drills, liveKpis, periodLabel, mix: bookMix(scoped),
    attention: execAttention({ expired, total: scoped.length, priced, undated, clients: clients.length, mono: mono.length }),
    exceptions: execExceptions(D, rows, rows.filter((r) => r.exp && daysUntil(r.exp) < 0), rows.filter((r) => !(r.exp && pDate(r.exp))).length, rows.filter((r) => r.prem > 0).length, docs),
  }
}
export type Executive = ReturnType<typeof computeExecutive>
