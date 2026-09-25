// Data for the Performance screens, assembled the way public/perf/loader.js and engine.js assemble it:
// the admin-only `lg:` reference rows, the live book tables reshaped into the original book structures,
// then the live AgencyZoom sync tables folded over the saved report history.
import { supabase } from '../supabase'
import { getBookPolicies, type Account } from '../books'
import { commRecalc } from './commission'

export type Json = Record<string, any>

export interface Folio {
  label: string
  start: string
  end: string
  inProgress?: boolean
  official: { pcPremium: number; pcPolicies: number; pcItems: number; pcSales: number; [k: string]: number }
  sales?: Json[]
  byProducer?: Record<string, number>
  sampleTotal?: number
}

export interface FolioRow { client: string; carrier: string; line: string; premium: number; producer: string; when: string; confirmed: boolean; customerId?: string | null; excludedReason?: string }

export interface PerfData {
  DATA: { commercial: Json[]; farmers: Json[] }
  CB_BINDERS: Json[]
  RB: Json[]
  /** book_accounts id behind each legacy client, so a row can open the account in Books. */
  accountOf: Record<string, string>
  FARMERS_DECS: Json
  RETAIL_DOCS: Json
  RB_LINES: Record<string, string>
  CHART: Record<string, string>
  BOOK_TAB: Record<string, string>
  BOOK_NAME: Record<string, string>
  GOALS: { premium?: number | null; policies?: number | null; [k: string]: any }
  PERIODS: Record<string, { label: string; days: number }>
  EXEC_PROD_WINDOWS: [string, string][]
  WB_DATA: { folio: Record<string, Folio>; commissionsByFolio?: Record<string, Record<string, Json>>; [k: string]: any }
  WB_EXTRA: { daily: Record<string, Json>; quotes?: Json; [k: string]: any }
  AZ_REPORTS: Record<string, Json>
  REPORT_DEFAULT_FOLIO: string
  COMM_SEED: Json
  COMM_RESULTS: Record<string, { plan: Json; results: Record<string, Json> }>
  LIVE_FOLIO_ROWS: Record<string, FolioRow[]>
  METRIC_DEFS: Record<string, [string, string][]>
  DASH_DEF_KEY: Record<string, string>
  THEMES: Record<string, { name: string; vars: Record<string, string>; dark?: boolean; season?: { from: string; to: string } }>
  FONTS: Record<string, { serif: string; sans: string }>
  S: Json
}

const REF_KEYS = ['FARMERS_DECS', 'RETAIL_DOCS', 'RB_LINES', 'CHART', 'BOOK_TAB', 'BOOK_NAME', 'GOALS', 'PERIODS', 'EXEC_PROD_WINDOWS',
  'WB_DATA', 'WB_EXTRA', 'AZ_REPORTS', 'COMM_SEED', 'COMM_RESULTS', 'LIVE_FOLIO_ROWS', 'METRIC_DEFS', 'DASH_DEF_KEY', 'THEMES', 'FONTS', 'S']
/** Saved copies of the books, used only when the live book tables can't be read (same fallback as loader.js). */
const BOOK_SNAPSHOT_KEYS = ['DATA', 'CB_BINDERS', 'RB']

async function refs(keys: string[]) {
  const { data, error } = await supabase.from('reference_data').select('key,data').in('key', keys.map((k) => 'lg:' + k))
  if (error) throw error
  const out: Json = {}
  ;(data || []).forEach((r: any) => { out[r.key.slice(3)] = r.data })
  return out
}

/** loader.js: the live book tables, reshaped into DATA / CB_BINDERS / RB. */
async function books(D: Json) {
  const accountOf: Record<string, string> = {}
  try {
    const [accts, pols] = await Promise.all([pageAll('book_accounts', 'id') as Promise<Account[]>, getBookPolicies()])
    if (!accts.length) return accountOf
    const by: Record<string, typeof pols> = {}
    pols.forEach((p) => { (by[p.account_id] = by[p.account_id] || []).push(p) })
    const farmers: Json[] = [], commercial: Json[] = [], cb: Json[] = [], rb: Json[] = []
    const r2 = (n: number) => Math.round(n * 100) / 100
    accts.forEach((a) => {
      const ps = by[a.id] || []
      if (a.book === 'farmers') {
        const list = ps.map((p) => ({ ...p.data }))
        const id = a.id.replace(/^f-/, '')
        accountOf['Farmers|' + id] = a.id
        farmers.push({ id, name: a.name, ...(a.dba ? { dba: a.dba } : {}), ...a.data,
          policies: list, totalPremium: r2(list.reduce((t, p) => t + (Number(p.annualPremium) || 0), 0)), policyCount: list.length })
      } else if (a.book === 'commercial') {
        const locs = (a.data.locations || []).map((l: Json) => ({ ...l, policies: ps.filter((p) => p.data.locationId === l.id).map((p) => {
          const d = { ...p.data }; delete d.locationId; delete d.locationName; delete d.locationAddress; return d }) }))
        const id = a.id.replace(/^c-/, '')
        accountOf['Commercial|' + id] = a.id
        commercial.push({ id, name: a.name, dba: a.dba, contact: a.contact, phone: a.phone, locations: locs })
      } else if (a.book === 'brokered_commercial') {
        const id = a.id.replace(/^bc-/, '')
        accountOf['Commercial|' + id] = a.id
        cb.push({ id, name: a.name, dba: a.dba, contact: a.contact, phone: a.phone, address: a.address, producer: a.producer, ...a.data })
      }
    })
    pols.forEach((p) => {
      if (p.book !== 'brokered_personal') return
      rb.push({ ...p.data })
      const key = p.data.clientKey || rbKey(p.data.insured)
      if (!accountOf['Retail|' + key]) accountOf['Retail|' + key] = p.account_id
    })
    farmers.sort((x, y) => y.totalPremium - x.totalPremium)
    D.DATA = { commercial, farmers }
    D.CB_BINDERS = cb
    D.RB = rb
  } catch (e) { console.warn('Book tables unavailable, using the saved copy', e) }
  return accountOf
}

export const rbKey = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

/** engine.js azRestore: an AgencyZoom CSV imported in this browser adds its clients to the Farmers book. */
function azRestore(D: PerfData) {
  try {
    const saved = JSON.parse(localStorage.getItem('vidura_az_import_v1') || 'null')
    if (saved && saved.clients) saved.clients.forEach((c: Json) => D.DATA.farmers.push(c))
  } catch { /* nothing imported */ }
}

export async function loadPerfData(): Promise<PerfData> {
  const D: Json = await refs(REF_KEYS)
  const accountOf = await books(D)
  if (!D.DATA) Object.assign(D, await refs(BOOK_SNAPSHOT_KEYS))
  D.DATA = D.DATA || { commercial: [], farmers: [] }
  D.CB_BINDERS = D.CB_BINDERS || []
  D.RB = D.RB || []
  D.accountOf = accountOf
  D.REPORT_DEFAULT_FOLIO = '2026-08-20'
  D.LIVE_FOLIO_ROWS = D.LIVE_FOLIO_ROWS || {}
  D.WB_DATA.commissionsByFolio = D.WB_DATA.commissionsByFolio || {}
  const P = D as PerfData
  azRestore(P)
  await supaSyncLoad(P)
  commRecalc(P)
  return P
}

/* ---------- live AgencyZoom sync (engine.js supaSyncLoad) ---------- */
const LIVE_FROM_FOLIO = '2026-08-20' // folios from here on are rebuilt from live rows
const HISTORY_CUTOFF = '2026-09-17' // days on/before this come from the reconciled export
const AZ_FAMILY_RX = /farmers|foremost/i
const classifySource = (carrier: string) => (AZ_FAMILY_RX.test(carrier || '') ? 'Farmers' : 'Brokered')
const isoAddDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export const isoToMdy = (iso: string) => (iso ? iso.slice(5, 7) + '/' + iso.slice(8, 10) + '/' + iso.slice(0, 4) : '')
const mdyToIso = (s: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || '')); return m ? m[3] + '-' + m[1] + '-' + m[2] : String(s || '').slice(0, 10) }
const shortRange = (a: string, b: string) => { const f = (x: string) => new Date(x + 'T12:00:00Z').toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); return f(a) + ' – ' + f(b) }
export const wbFolioKeys = (D: PerfData) => Object.keys(D.WB_DATA.folio).sort().reverse()

function groupRows(rows: FolioRow[], key: keyof FolioRow) {
  const m: Record<string, { label: string; value: number; n: number }> = {}
  rows.forEach((r) => { const l = String(r[key] || '(none)'); const o = (m[l] = m[l] || { label: l, value: 0, n: 0 }); o.value += Number(r.premium) || 0; o.n++ })
  return Object.values(m).map((o) => ({ label: o.label, value: Math.round(o.value * 100) / 100, n: o.n })).sort((a, b) => b.value - a.value)
}
function detailRows(rows: FolioRow[], key: keyof FolioRow) {
  const m: Record<string, { total: number; policies: number; rows: FolioRow[] }> = {}
  rows.forEach((r) => { const l = String(r[key] || '(none)'); const o = (m[l] = m[l] || { total: 0, policies: 0, rows: [] }); o.total += Number(r.premium) || 0; o.policies++; o.rows.push(r) })
  Object.values(m).forEach((o) => { o.total = Math.round(o.total * 100) / 100; o.rows.sort((a, b) => mdyToIso(b.when).localeCompare(mdyToIso(a.when))) })
  return m
}

function applyLiveFolios(D: PerfData, folioRows: Json[], sales: Json[], quotes: Json[]) {
  const keys = folioRows.map((f) => String(f.folio_key)).sort()
  const todayIso = new Date().toISOString().slice(0, 10)
  keys.forEach((k, i) => {
    const dbf = folioRows.find((f) => String(f.folio_key) === k)!
    const next = keys[i + 1]
    const inProgress = !!dbf.in_progress
    const end = next ? isoAddDays(next, -1) : isoAddDays(k, 29)
    let f = D.WB_DATA.folio[k]
    if (!f) f = D.WB_DATA.folio[k] = { label: '', start: k, end, inProgress, official: { pcPremium: 0, pcPolicies: 0, pcItems: 0, pcSales: 0, lhAppts: 0, lhPolicies: 0, lhPremium: 0 }, sampleTotal: 0, byProducer: {}, sales: [] }
    f.start = k; f.end = end; f.inProgress = inProgress
    f.label = inProgress ? shortRange(k, end) + ', ' + end.slice(0, 4) + ' (in progress)' : (dbf.period || f.label)
    if (k < LIVE_FROM_FOLIO) return

    // rows: reconciled export up to the cutoff, then synced policies after it
    const rep = D.AZ_REPORTS[k]
    const hist: FolioRow[] = rep ? ([] as Json[]).concat(...Object.values(rep.producerDetail || {}).map((p: any) => p.rows || []))
      .filter((x) => mdyToIso(x.when) <= HISTORY_CUTOFF)
      .map((x) => ({ client: x.client, carrier: x.carrier, line: x.line, premium: Number(x.premium) || 0, producer: x.producer, when: x.when, confirmed: true })) : []
    const synced: FolioRow[] = sales.filter((r) => r.az_ref && r.sale_date > HISTORY_CUTOFF && r.sale_date >= k && r.sale_date <= end)
      .map((r) => ({ client: r.client_name, carrier: r.carrier || '', line: r.policy_type || '', premium: Number(r.premium) || 0,
        producer: r.producer, when: isoToMdy(r.sale_date), confirmed: true, customerId: r.customer_id || null }))
    const rows = hist.concat(synced)
    D.LIVE_FOLIO_ROWS[k] = rows

    const total = rows.reduce((s, r) => s + r.premium, 0)
    const ff = rows.filter((r) => AZ_FAMILY_RX.test(r.carrier)).reduce((s, r) => s + r.premium, 0)
    const customers = new Set(rows.map((r) => r.customerId || r.client)).size
    const byProd: Record<string, number> = {}
    rows.forEach((r) => { byProd[r.producer] = (byProd[r.producer] || 0) + r.premium })
    f.byProducer = byProd
    f.official = { lhAppts: 0, lhPolicies: 0, lhPremium: 0, ...f.official, pcPremium: Math.round(total * 100) / 100, pcPolicies: rows.length, pcItems: rows.length, pcSales: customers }
    f.sampleTotal = f.official.pcPremium
    f.sales = rows.slice().sort((a, b) => mdyToIso(b.when).localeCompare(mdyToIso(a.when))).map((r) => ({
      carrier: r.carrier, confirmed: true, customerId: r.customerId || null, id: null, items: 1, leadSource: '', name: r.client,
      policyType: r.line, premium: r.premium, producer: r.producer, soldDate: r.when, source: classifySource(r.carrier) }))

    // reports view for this folio
    const prev = D.AZ_REPORTS[keys[i - 1]] || {}
    const hadReport = !!D.AZ_REPORTS[k]
    const r2: Json = (D.AZ_REPORTS[k] = { ...(D.AZ_REPORTS[k] || {}) })
    const openQ = quotes.filter((q) => q.quote_day && q.quote_day >= k && q.quote_day <= end)
    const qPrem = openQ.reduce((s, q) => s + (Number(q.quoted_premium) || 0), 0)
    const salesCount = customers
    r2.generatedAt = isoToMdy(todayIso); r2.source = 'AgencyZoom (live sync)'
    r2.period = f.label; r2.periodLabel = 'Folio'; r2.filters = { folio: f.label, producer: 'All', product: 'All' }
    r2.byProducer = groupRows(rows, 'producer'); r2.byLine = groupRows(rows, 'line'); r2.byCarrier = groupRows(rows, 'carrier')
    r2.byLeadSource = r2.byLeadSource || []; r2.renewals = r2.renewals || []
    r2.producerDetail = detailRows(rows, 'producer'); r2.carrierDetail = detailRows(rows, 'carrier')
    const m: Json = (r2.metrics = { ...(r2.metrics || {}) })
    m.writtenPremium = { label: 'Written premium', value: Math.round(total * 100) / 100, goal: null, pct: null, money: true, sub: rows.length + ' policies · Farmers/Foremost ' + Math.round(ff).toLocaleString('en-US') }
    if (!hadReport || !m.revenue) m.revenue = { label: 'Revenue / commission', value: 0, goal: null, pct: null, money: true, sub: 'see Commissions' }
    m.policiesSold = { label: 'Policies sold', value: rows.length, goal: null, pct: null, sub: salesCount + ' customers' }
    m.newCustomers = { label: 'Customers written', value: customers, goal: null, pct: null, sub: 'distinct customers with a sale this folio' }
    m.quotes = { label: 'Quotes', value: openQ.length, goal: null, pct: null, sub: 'quoted leads with a premium · ' + Math.round(qPrem).toLocaleString('en-US') + ' quoted' }
    m.quoteToSale = { label: 'Quote to sale %', value: openQ.length ? Math.round(salesCount / openQ.length * 1000) / 10 : 0, goal: null, pct: null, suffix: '%', sub: 'directional' }
    m.policiesPerCustomer = { label: 'Policies per customer', value: customers ? Math.round(rows.length / customers * 100) / 100 : 0, goal: null, pct: null, decimals: 2, sub: 'cross-sell effectiveness' }
    ;['appointmentsSet', 'appointmentsHeld', 'showRate', 'closeRate'].forEach((x) => { if (!m[x]) m[x] = { label: x, noData: true, why: 'Not tracked in AgencyZoom' } })
    r2.notes = ['Live: reconciled AgencyZoom export through ' + isoToMdy(HISTORY_CUTOFF) + ', then every policy the AgencyZoom sync has pulled since.']
    const bm = (r2.byMonth || prev.byMonth || []).filter((x: Json) => x.key !== k)
    bm.push({ label: shortRange(k, end), year: Number(end.slice(0, 4)), premium: Math.round(total * 100) / 100, policies: rows.length, key: k })
    r2.byMonth = bm
  })
}

/** Every row of a table, 1000 at a time (optionally in database order, as loader.js reads the books). */
async function pageAll(table: string, order?: string) {
  let out: Json[] = []
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select('*')
    if (order) q = q.order(order)
    const { data, error } = await q.range(from, from + 999)
    if (error) throw error
    out = out.concat(data || [])
    if (!data || data.length < 1000) break
  }
  return out
}

/** Folds the AgencyZoom sync tables into the saved history. If the sales or quote tables can't be read,
 *  the saved copy stays in place, exactly as the original screens behave. */
async function supaSyncLoad(D: PerfData) {
  try {
    const [salesRaw, quotes, folios] = await Promise.all([
      pageAll('daily_sales'), pageAll('quote_leads'),
      pageAll('commission_folios').catch((e) => { console.error(e); return [] as Json[] }),
    ])
    // Synced sales come from AgencyZoom policy records (az_ref "pol-<id>"); rows from the earlier
    // lead-based sync are superseded by those. Rows with no az_ref are the reconciled history.
    const sales = salesRaw.filter((r) => !r.az_ref || String(r.az_ref).indexOf('pol-') === 0)
    const daily: Record<string, Json> = {}
    sales.forEach((r) => {
      const day = r.sale_date; if (!day) return
      const d = (daily[day] = daily[day] || { total: 0, byProducer: {}, sales: [] })
      const prem = Number(r.premium || 0)
      d.total += prem; d.byProducer[r.producer] = (d.byProducer[r.producer] || 0) + prem
      d.sales.push({ name: r.client_name, producer: r.producer, premium: prem, source: r.source || classifySource(r.carrier), carrier: r.carrier,
        policyType: r.policy_type, id: r.az_ref || null, confirmed: !!r.confirmed, customerId: r.customer_id || null })
    })
    const pipeline: Record<string, Json> = {}
    quotes.forEach((r) => {
      const day = r.quote_day; if (!day) return
      const p = (pipeline[day] = pipeline[day] || { count: 0, premium: 0, byProducer: {}, leads: [] })
      p.count += 1; p.premium += Number(r.quoted_premium || 0); p.byProducer[r.producer] = (p.byProducer[r.producer] || 0) + 1
      p.leads.push({ leadId: r.lead_id || r.az_ref, name: r.name, producer: r.producer, leadSource: r.lead_source, quotedPremium: Number(r.quoted_premium || 0), quoteDay: r.quote_day })
    })
    D.WB_EXTRA.daily = daily
    D.WB_EXTRA.quotes = { ...(D.WB_EXTRA.quotes || {}), byDay: pipeline, pulledAt: isoToMdy(new Date().toISOString().slice(0, 10)) }
    if (folios.length) applyLiveFolios(D, folios, sales, quotes)
    const newest = wbFolioKeys(D)[0]
    if (newest && D.AZ_REPORTS[newest]) D.REPORT_DEFAULT_FOLIO = newest
  } catch (err) {
    console.error('Live Supabase data load failed:', err)
  }
}

/** Saves the agency's goals to reference_data (lg:GOALS), which the original screens read on load. */
export async function saveGoals(goals: PerfData['GOALS']) {
  const { data, error } = await supabase.from('reference_data')
    .update({ data: goals, updated_at: new Date().toISOString() }).eq('key', 'lg:GOALS').select('key')
  if (error) throw error
  if (!data || !data.length) throw new Error('your account is not allowed to change the agency goals')
}
