// What the Reports screen computes, as plain functions over PerfData. Ported from engine.js (reportFolioKey,
// renderWrittenBody, wbFilteredSales, renderDailyBody, metricValue) so the figures match the original screen.
import { wbFolioKeys, type Json, type PerfData } from './data'
import { daysUntil, execProdRange, execRows, money0, today0 } from './executive'

const WB_COMMERCIAL_RX = /commercial|workers comp|\bbop\b|\bgl\b|builders risk|e&o|umbrella.*business/i
export const wbIsCommercial = (t: string | null | undefined) => !!t && WB_COMMERCIAL_RX.test(t)

/** The folio a report opens on: the chosen one when it has a report, otherwise the newest with one. */
export const reportFolioKey = (D: PerfData, chosen?: string | null) => (chosen && D.AZ_REPORTS[chosen] ? chosen : D.REPORT_DEFAULT_FOLIO)
export const wbFolioLabel = (D: PerfData, k: string) => (D.WB_DATA.folio[k] || { label: k }).label

export function metricValue(m: Json) {
  return m.value == null ? '—' : m.money ? money0(m.value) : m.decimals ? Number(m.value).toFixed(m.decimals) : String(m.value) + (m.suffix || '')
}

/** Reports › Written Business: the folio's sales, filtered by carrier and business type. */
export function computeWritten(D: PerfData, folio: string | null | undefined, carrier: string, biz: string, metric: string) {
  const key = folio && D.WB_DATA.folio[folio] ? folio : wbFolioKeys(D)[0]
  const f: Json = D.WB_DATA.folio[key] || { sales: [] }
  const carriers = [...new Set<string>((f.sales || []).map((s: Json) => s.source).filter(Boolean))].sort()
  const sales: Json[] = (f.sales || []).filter((s: Json) => {
    if (carrier !== 'all' && s.source !== carrier) return false
    const c = wbIsCommercial(s.policyType)
    return !(biz === 'commercial' && !c) && (biz !== 'personal' || !c)
  })
  const by: Record<string, { value: number; n: number }> = {}
  sales.forEach((s) => { const o = (by[s.producer] = by[s.producer] || { value: 0, n: 0 }); o.value += s.premium || 0; o.n += 1 })
  const bars = Object.entries(by).map(([label, o]) => ({ label, value: metric === 'premium' ? o.value : o.n, n: metric === 'premium' ? o.n : null }))
    .sort((a, b) => b.value - a.value)
  return {
    key, carriers, sales, bars,
    premium: sales.reduce((t, s) => t + (s.premium || 0), 0),
    rows: [...sales].sort((a, b) => String(b.soldDate || '').localeCompare(String(a.soldDate || ''))),
  }
}

/** Reports › Daily: one day's sales and quotes, and the quotes-per-day history. */
export function computeDaily(D: PerfData, chosen: string | null | undefined) {
  const q: Json = D.WB_EXTRA.quotes || { byDay: {} }
  const qd: Record<string, Json> = q.byDay || {}
  const days = [...new Set([...Object.keys(D.WB_EXTRA.daily), ...Object.keys(qd)])].sort().reverse()
  // The original screen sets its day to the newest synced sale when the live data loads, over any saved choice.
  const pick = chosen || D.REPORT_DEFAULT_DAY || (D.S || {}).repDay
  const day = pick && (D.WB_EXTRA.daily[pick] || qd[pick]) ? pick : days[0]
  const sold: Json = D.WB_EXTRA.daily[day] || { total: 0, byProducer: {}, sales: [] }
  const quoted: Json = qd[day] || { count: 0, premium: 0, byProducer: {}, leads: [] }
  return {
    q, qd, days, day, sold, quoted,
    quoteDays: Object.keys(qd).sort().reverse(),
    quoteBars: Object.entries(quoted.byProducer || {}).map(([label, n]) => ({ label, value: n as number, count: n as number, unit: n === 1 ? 'quote' : 'quotes' }))
      .sort((a, b) => b.value - a.value),
    saleBars: Object.entries(sold.byProducer || {}).map(([label, v]) => ({ label, value: v as number })).sort((a, b) => b.value - a.value),
  }
}

export function azSyncWhen(s: string) {
  const d = new Date(s)
  return isNaN(d.getTime()) ? String(s) : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/* ---------- Reports dashboard (engine.js DASH.reports, repProduction) ---------- */

export const repIsFarmers = (s: Json) => /farmers|foremost|bristol|toggle/i.test(s.carrier || s.source || '')

/** Written business in a window from the daily sales ledger, against the prior window of the same length. */
export function repProduction(D: PerfData, win: string, book: string, line: string, custom?: { from: string; to: string }) {
  const r = execProdRange(D, win, custom)
  const daily = D.WB_EXTRA.daily || {}, qd: Record<string, Json> = (D.WB_EXTRA.quotes || { byDay: {} }).byDay || {}
  const span = (a: string, b: string) => {
    const days = Object.keys(daily).filter((d) => d >= a && d <= b).sort(), sales: Json[] = []
    days.forEach((d) => (daily[d].sales || []).forEach((s: Json) => {
      if (book === 'Farmers' && !repIsFarmers(s)) return
      if ((book === 'Brokered' && repIsFarmers(s)) || (line !== 'all' && (s.policyType || '') !== line)) return
      sales.push({ date: d, ...s })
    }))
    const qdays = Object.keys(qd).filter((d) => d >= a && d <= b), byDay: Record<string, number> = {}
    sales.forEach((s) => { byDay[s.date] = (byDay[s.date] || 0) + (s.premium || 0) })
    return {
      start: a, end: b, sales, days, byDay,
      prem: sales.reduce((t, s) => t + (s.premium || 0), 0),
      cust: new Set(sales.map((s) => s.customerId || s.name)).size,
      quotes: line === 'all' ? qdays.reduce((t, d) => t + (qd[d].count || 0), 0) : 0,
      qprem: line === 'all' ? qdays.reduce((t, d) => t + (qd[d].premium || 0), 0) : 0,
    }
  }
  const cur = span(r.start, r.end)
  const s0 = new Date(r.start + 'T00:00:00'), e0 = new Date(r.end + 'T00:00:00')
  const len = Math.round((e0.getTime() - s0.getTime()) / 864e5) + 1
  let pa: string | undefined, pb: string | undefined, sameDays = false
  if (r.folio || win === 'folio' || win === 'last') {
    const ks = wbFolioKeys(D), nx = ks[ks.indexOf(r.key!) + 1]
    if (nx && ((pa = D.WB_DATA.folio[nx].start), (pb = D.WB_DATA.folio[nx].end), (D.WB_DATA.folio[r.key!] || ({} as Json)).inProgress)) {
      const el = Math.round((today0().getTime() - s0.getTime()) / 864e5), t = new Date(pa + 'T00:00:00')
      t.setDate(t.getDate() + el)
      if (t < new Date(pb + 'T00:00:00')) { pb = t.toISOString().slice(0, 10); sameDays = true }
    }
  }
  if (!pa) {
    const e = new Date(s0); e.setDate(e.getDate() - 1)
    const t = new Date(e); t.setDate(t.getDate() - len + 1)
    pa = t.toISOString().slice(0, 10); pb = e.toISOString().slice(0, 10)
  }
  const prev = span(pa, pb!)
  const byP: Record<string, number> = {}
  cur.sales.forEach((s) => { byP[s.producer] = (byP[s.producer] || 0) + (s.premium || 0) })
  const nW = Math.max(1, Math.ceil(len / 7))
  const weeks = (x: typeof cur, from: string) => {
    const w = Array(nW).fill(0), f = new Date(from + 'T00:00:00')
    Object.entries(x.byDay).forEach(([d, v]) => { w[Math.min(nW - 1, Math.floor((new Date(d + 'T00:00:00').getTime() - f.getTime()) / 864e5 / 7))] += v })
    return w as number[]
  }
  return { r, cur, prev, byP, weeks: weeks(cur, r.start), prevWeeks: weeks(prev, pa), prevLabel: pa + ' to ' + pb + (sameDays ? ' · same days elapsed' : ''), len, sameDays }
}

/** Where a card or attention item leads: a Reports tab, or another page of the app. */
export type Go = { tab: string } | { path: string }
export interface DashKpi { label: string; value: string | number; goal: string; delta: string; tone: string; icon: string; viz: Json; go: Go }
export interface DashAttn { title: string; sub: string; action: string; tone: string; go: Go }

export function computeReportsDash(D: PerfData, win: string, book: string, line: string, custom?: { from: string; to: string }) {
  const R: Json = D.AZ_REPORTS[D.REPORT_DEFAULT_FOLIO] || {}
  const lines = [...new Set<string>(([] as string[]).concat(...Object.values(D.WB_EXTRA.daily || {}).map((d: Json) => (d.sales || []).map((s: Json) => s.policyType))).filter(Boolean))].sort()
  const a = repProduction(D, win, book, line, custom), n = a.cur, o = a.prev
  const chg = (x: number, y: number) => (y ? ((x - y) / y) * 100 : null)
  const vs = (x: number, y: number, fmt?: (v: number) => string) => {
    const c = chg(x, y)
    return c == null ? 'no prior period' : (c >= 0 ? '+' : '') + c.toFixed(1) + '% vs prior' + (a.sameDays ? ' to date' : '') + ' (' + (fmt || String)(y) + ')'
  }
  const goal = D.GOALS.premium
  const conv = n.quotes && n.quotes >= n.sales.length ? (n.sales.length / n.quotes) * 100 : null
  const farm = n.sales.filter(repIsFarmers).reduce((t, s) => t + (s.premium || 0), 0)
  const share = n.prem ? (farm / n.prem) * 100 : 0
  const spark = n.days.slice(-14).map((d) => n.byDay[d] || 0)
  const rows = execRows(D)
  const unpriced = rows.filter((r) => !(r.prem > 0)).length, undated = rows.filter((r) => !r.exp).length
  const expired = rows.filter((r) => r.exp && (daysUntil(r.exp) as number) < 0).length
  let recon: Json = {}
  try { recon = JSON.parse(localStorage.getItem('declara_comm_recon_v1') || '{}') || {} } catch { recon = {} }
  const reconciled = Object.keys(recon || {}).length
  const ks = wbFolioKeys(D)
  const attention: DashAttn[] = []
  attention.push({ title: unpriced + undated + ' records need attention in the books', sub: unpriced + ' without premium · ' + undated + ' without an expiration date', action: 'Review', tone: 'risk', go: { path: '/' } })
  if (expired) attention.push({ title: expired + ' expired policies still on the books', sub: 'Past expiration with no renewal recorded', action: 'Review', tone: 'warn', go: { path: '/resources' } })
  attention.push({ title: 'Scorecard pulled ' + (R.generatedAt || ''), sub: (R.period || '') + ' · once-a-day pull of the previous day', action: 'Current', tone: 'good', go: { tab: 'scorecard' } })
  attention.push({ title: 'Commission statements · ' + wbFolioLabel(D, ks[1] || ks[0]), sub: (reconciled ? 'reconciled against the carrier statement' : 'not yet reconciled against eFolio') + ' · Excel and PDF ready',
    action: reconciled ? 'Complete' : 'Reconcile', tone: reconciled ? 'good' : 'warn', go: { tab: 'commissions' } })
  attention.push({ title: 'SDR transfer pay runs on the 21st', sub: 'Jackeline and Rhon commission sheets for the previous month', action: 'Open', tone: 'warn', go: { tab: 'sdr' } })
  const last = Object.keys(D.WB_EXTRA.daily || {}).sort().pop() || ''
  const md = (d: string) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—')
  const register: [string, string, string, string, string][] = [
    ['Executive Scorecard', 'AgencyZoom', 'Per folio', R.generatedAt || '', 'scorecard'],
    ['Daily Report', 'AgencyZoom sales ledger', 'Daily', md(last), 'daily'],
    ['Folio Report', 'AgencyZoom + Apex', 'Per folio', wbFolioLabel(D, ks[0]).replace(' (in progress)', ''), 'folio'],
    ['Producer Report', 'Declara', 'On demand', md(last), 'producer'],
    ['Commission Statements', 'Commission engine', 'Per folio close', wbFolioLabel(D, ks[1] || ks[0]), 'commissions'],
    ['SDR Transfer Pay', 'AgencyZoom tags + quotes', 'Monthly · 21st', (D.WB_EXTRA.sdr || {}).pulledAt || '', 'sdr'],
    ['Year-end Report', 'Declara', 'Quarterly / YTD', md(last), 'annual'],
  ]
  const kpis: DashKpi[] = [
    { label: 'Written premium', value: money0(n.prem), goal: a.r.label, delta: vs(n.prem, o.prem, money0), tone: (chg(n.prem, o.prem) as number) >= 0 ? 'up' : 'down', icon: 'money',
      viz: goal ? { type: 'ring', pct: (n.prem / goal) * 100, tone: n.prem >= goal ? 'good' : 'warn' } : { type: 'ring', pct: share, tone: 'good' }, go: { tab: 'scorecard' } },
    { label: 'Policies sold', value: n.sales.length, goal: n.cust + ' customers · ' + (n.cust ? (n.sales.length / n.cust).toFixed(2) : '—') + ' per customer', delta: vs(n.sales.length, o.sales.length),
      tone: (chg(n.sales.length, o.sales.length) as number) >= 0 ? 'up' : 'down', icon: 'doc', viz: { type: 'spark', values: spark }, go: { tab: 'daily' } },
    { label: 'Quotes', value: n.quotes || '—', goal: money0(n.qprem) + ' quoted' + (line !== 'all' ? ' · all lines' : ''), delta: conv != null ? conv.toFixed(0) + '% quote → sale' : 'quote log covers part of the window',
      tone: conv != null && conv >= 30 ? 'up' : 'warn', icon: 'flag', viz: { type: 'bar', pct: conv != null ? conv : 0, tone: conv != null && conv >= 30 ? 'good' : 'warn', label: conv != null ? conv.toFixed(0) + '% close' : '—' }, go: { tab: 'daily' } },
    { label: 'Farmers share', value: share.toFixed(0) + '%', goal: money0(farm) + ' of ' + money0(n.prem), delta: 'goal 70%+ Farmers / Foremost', tone: share >= 70 ? 'up' : 'warn', icon: 'pct',
      viz: { type: 'dots', n: Math.round(share / 20), of: 5, label: share >= 70 ? 'On track' : 'Below' }, go: { tab: 'written' } },
    { label: 'Data freshness', value: md(last), goal: 'last sale on the ledger', delta: 'scorecard ' + (R.generatedAt || ''), tone: 'up', icon: 'renew',
      viz: { type: 'ring', pct: Math.max(0, 100 - 10 * Math.round((today0().getTime() - new Date(last + 'T00:00:00').getTime()) / 864e5)), tone: 'good' }, go: { path: '/settings' } },
  ]
  return {
    lines, kpis, attention, register, a,
    chart: { title: 'Written by week', sub: a.r.label + ' vs prior period (' + a.prevLabel + ')', note: 'Current vs prior',
      series: a.weeks.map((v, i) => ({ label: 'W' + (i + 1), value: v, value2: a.prevWeeks[i] || 0, text: money0(v), text2: money0(a.prevWeeks[i] || 0) })) },
    mix: Object.entries(a.byP).sort((x, y) => y[1] - x[1]).map(([label, value]) => ({ label, value })),
  }
}
