// Certificates of liability insurance (the ACORD 25 layout) from Agency Resources. The agency's own details (the
// producer block) and the insurance companies used before are kept per agency in public.coi_profile; a certificate
// is laid out here as a printable page, one letter-size sheet per certificate.
import { supabase } from './supabase'
import { getAccounts, getBookPolicies, getDocs, type BookPolicy, type Doc } from './books'
import { loadScript } from './perf/commissionFiles'

export interface Producer { name: string; address: string; contact: string; phone: string; fax: string; email: string; rep: string }
export interface Insurer { name: string; naic: string }
export type LineKey = 'gl' | 'auto' | 'umb' | 'wc'

interface Base { on: boolean; ins: number; policy: string; eff: string; exp: string; addl: boolean; subr: boolean }
export interface Gl extends Base { form: 'occur' | 'claims'; aggPer: 'policy' | 'project' | 'loc'; each: string; rented: string; med: string; personal: string; agg: string; products: string }
export interface Auto extends Base { any: boolean; owned: boolean; scheduled: boolean; hired: boolean; nonowned: boolean; csl: string; biPerson: string; biAccident: string; pd: string }
export interface Umb extends Base { kind: 'umbrella' | 'excess'; form: 'occur' | 'claims'; ded: boolean; retention: string; each: string; agg: string }
export interface Wc extends Base { excluded: '' | 'Y' | 'N'; statute: boolean; accident: string; disease: string; employee: string }

export interface Cert {
  date: string
  insuredName: string; insuredAddress: string
  insurers: Insurer[]
  gl: Gl; auto: Auto; umb: Umb; wc: Wc
  holderName: string; holderAddress: string
  ops: string; opsEdited: boolean
  number: string; revision: string
}

export const EMPTY_PRODUCER: Producer = { name: '', address: '', contact: '', phone: '', fax: '', email: '', rep: '' }
export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']
export const LINES: { key: LineKey; label: string }[] = [
  { key: 'gl', label: 'General Liability' }, { key: 'auto', label: 'Commercial Auto' },
  { key: 'umb', label: 'Umbrella' }, { key: 'wc', label: 'Workers Compensation' },
]

const base = (): Base => ({ on: false, ins: 0, policy: '', eff: '', exp: '', addl: true, subr: false })
export function newCert(today: string): Cert {
  return {
    date: today, insuredName: '', insuredAddress: '', insurers: [{ name: '', naic: '' }],
    // the limits most certificates carry (the original screens' defaults), changed per policy as needed
    gl: { ...base(), form: 'occur', aggPer: 'policy', each: '1,000,000', rented: '100,000', med: '5,000', personal: '1,000,000', agg: '2,000,000', products: '2,000,000' },
    auto: { ...base(), any: false, owned: false, scheduled: false, hired: true, nonowned: true, csl: '1,000,000', biPerson: '', biAccident: '', pd: '' },
    umb: { ...base(), kind: 'umbrella', form: 'occur', ded: false, retention: '', each: '1,000,000', agg: '1,000,000' },
    wc: { ...base(), addl: false, excluded: 'N', statute: true, accident: '1,000,000', disease: '1,000,000', employee: '1,000,000' },
    holderName: '', holderAddress: '', ops: '', opsEdited: false, number: '', revision: '',
  }
}

/** The name a line goes by in the description (an excess policy is called that rather than umbrella). */
export const lineName = (c: Cert, k: LineKey) => (k === 'umb' && c.umb.kind === 'excess' ? 'Excess Liability' : LINES.find((l) => l.key === k)!.label)

/** The standard description: the certificate holder is an additional insured on the policies selected for it. */
export function standardOps(c: Cert) {
  const names = LINES.filter((l) => c[l.key].on && c[l.key].addl).map((l) => lineName(c, l.key))
  if (!names.length) return ''
  const list = names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
  return `${c.holderName.trim() || 'The certificate holder'} is an additional insured on the ${list} ${names.length === 1 ? 'policy' : 'policies'}.`
}

/** A year after an effective date (policies usually run a year). */
export function plusYear(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${+m[1] + 1}-${m[2]}-${m[3]}` : ''
}

/* ---------- the agency's saved details ---------- */
export async function getCoiProfile(): Promise<{ producer: Producer; insurers: Insurer[] }> {
  const { data, error } = await supabase.from('coi_profile').select('producer, insurers').maybeSingle()
  if (error) throw error
  return { producer: { ...EMPTY_PRODUCER, ...(data?.producer || {}) }, insurers: (data?.insurers as Insurer[]) || [] }
}

export async function saveCoiProfile(agencyId: string, patch: { producer?: Producer; insurers?: Insurer[] }) {
  const { error } = await supabase.from('coi_profile').upsert({ agency_id: agencyId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'agency_id' })
  if (error) throw error
}

/** Adds the certificate's insurance companies to the ones remembered (a newer NAIC number replaces an older one). */
export function mergeInsurers(known: Insurer[], used: Insurer[]) {
  const out = known.slice()
  for (const u of used) {
    const name = u.name.trim(); if (!name) continue
    const i = out.findIndex((k) => k.name.trim().toLowerCase() === name.toLowerCase())
    if (i < 0) out.push({ name, naic: u.naic.trim() }); else if (u.naic.trim()) out[i] = { name, naic: u.naic.trim() }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** What stops a certificate being issued, if anything. */
export function coiProblems(p: Producer, c: Cert) {
  const out: string[] = []
  if (!p.name.trim()) out.push('your agency’s name')
  if (!c.insuredName.trim()) out.push('the insured’s name')
  const on = LINES.filter((l) => c[l.key].on)
  if (!on.length) out.push('at least one policy (General Liability, Commercial Auto, Umbrella or Workers Compensation)')
  for (const l of on) {
    const x = c[l.key]
    if (!c.insurers[x.ins]?.name.trim()) out.push(`the insurance company for ${lineName(c, l.key)}`)
    if (!x.policy.trim()) out.push(`the ${lineName(c, l.key)} policy number`)
    if (!x.eff || !x.exp) out.push(`the ${lineName(c, l.key)} policy dates`)
  }
  if (!c.holderName.trim()) out.push('the certificate holder')
  return out
}

/* ---------- filling a certificate from the broker book ---------- */
// A client (or, for an owner with several stores, one location) in the Brokered Commercial book, with its policies.
export interface CoiClient { key: string; accountId: string; label: string; sub: string; insuredName: string; address: string; policies: BookPolicy[]; search: string }

export async function getCoiClients(): Promise<CoiClient[]> {
  const [accounts, policies] = await Promise.all([getAccounts('brokered_commercial'), getBookPolicies('brokered_commercial')])
  const out: CoiClient[] = []
  for (const a of accounts) {
    const mine = policies.filter((p) => p.account_id === a.id)
    const locs: { id: string; name: string; address: string }[] = Array.isArray(a.data?.locations) ? a.data.locations : []
    const base = a.dba && a.dba !== a.name ? `${a.name} DBA ${a.dba}` : a.name
    if (locs.length) {
      // an owner account: each location is insured under its own policies
      for (const l of locs) {
        const ps = mine.filter((p) => p.data?.locationId === l.id)
        out.push({ key: a.id + ':' + l.id, accountId: a.id, label: l.name, sub: `${a.dba || a.name} · ${l.address}`, insuredName: `${a.name} DBA ${l.name}`, address: splitAddress(l.address), policies: ps,
          search: [a.name, a.dba, l.name, l.address, ...ps.map((p) => p.policy_number)].join(' ').toLowerCase() })
      }
    } else if (Array.isArray(a.data?.sites) && a.data.sites.length > 1) {
      // a client with several sites, each under its own policies (named in the site's list); policies no site names
      // (workers comp, usually) cover them all
      const sites: { label: string; address: string; policies?: string[] }[] = a.data.sites
      const named = (st: (typeof sites)[number], p: BookPolicy) => !!p.policy_number && (st.policies || []).some((t) => t.includes(p.policy_number!))
      for (const st of sites) {
        const ps = mine.filter((p) => named(st, p) || !sites.some((o) => named(o, p)))
        out.push({ key: a.id + ':' + st.label, accountId: a.id, label: `${a.dba || a.name} — ${st.label}`, sub: st.address, insuredName: base, address: splitAddress(st.address || a.address || ''), policies: ps,
          search: [a.name, a.dba, st.label, st.address, ...ps.map((p) => p.policy_number)].join(' ').toLowerCase() })
      }
    } else {
      out.push({ key: a.id, accountId: a.id, label: a.dba || a.name, sub: [a.dba && a.dba !== a.name ? a.name : '', a.address].filter(Boolean).join(' · '), insuredName: base, address: splitAddress(a.address || ''), policies: mine,
        search: [a.name, a.dba, a.address, ...mine.map((p) => p.policy_number)].join(' ').toLowerCase() })
    }
  }
  return out.sort((x, y) => x.label.localeCompare(y.label))
}

/** "1896 Senter Road, San Jose, CA 95112" → street on one line, city/state/ZIP on the next. */
function splitAddress(s: string) {
  const i = s.indexOf(', ')
  return i > 0 ? s.slice(0, i) + '\n' + s.slice(i + 2) : s
}

/** The company that writes the policy: "Farmers Insurance (Mid-Century Insurance Company)" → "Mid-Century Insurance Company". */
export function writingCompany(carrier: string) {
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(carrier.trim())
  return m && /insurance|exchange|company|assurance|indemnity|casualty|surety/i.test(m[2]) ? m[2].trim() : carrier.trim()
}

/** Which certificate line a book policy is, if any (property-only and professional policies aren't on an ACORD 25). */
export function policyLine(p: BookPolicy): LineKey | null {
  const t = `${p.product || ''} ${p.data?.kind || ''} ${p.data?.coverageType || ''}`.toLowerCase()
  if (/work\w* comp/.test(t)) return 'wc'
  if (/umbrella|excess/.test(t)) return 'umb'
  if (/auto/.test(t)) return 'auto'
  if (/professional|e&o|errors/.test(t)) return null
  if (/general liability|casualty|businessowners|\bbop\b|package|liability/.test(t)) return 'gl'
  return null
}

/**
 * Fills the insured, insurance companies and policies from a broker-book client. For each line the policy in force
 * on the certificate date is used (the latest one if none is); limits keep their standard values, since the book
 * doesn't hold them. Returns the certificate and what was filled and left out, to show the person.
 */
export function fillFromClient(c: Cert, client: CoiClient, known: Insurer[]) {
  const today = c.date
  const next = newCert(today)
  next.holderName = c.holderName; next.holderAddress = c.holderAddress
  next.insuredName = client.insuredName; next.insuredAddress = client.address
  next.insurers = []
  const used: string[] = [], skipped: string[] = [], expired: string[] = []
  const insurerFor = (p: BookPolicy) => {
    const name = writingCompany(p.carrier || '')
    let i = next.insurers.findIndex((r) => r.name.toLowerCase() === name.toLowerCase())
    if (i < 0 && next.insurers.length < LETTERS.length) {
      const naic = String(p.data?.naic || known.find((k) => k.name.toLowerCase() === name.toLowerCase())?.naic || '')
      next.insurers.push({ name, naic }); i = next.insurers.length - 1
    }
    return Math.max(0, i)
  }
  for (const l of LINES) {
    const ps = client.policies.filter((p) => policyLine(p) === l.key)
    if (!ps.length) continue
    // prefer a policy dedicated to the line (a GL policy over a package that includes GL), then one in force, then the latest
    const inForce = (p: BookPolicy) => (!p.effective || p.effective <= today) && (!p.expiration || p.expiration >= today)
    const exact = (p: BookPolicy) => new RegExp(l.label, 'i').test(`${p.product} ${p.data?.kind || ''}`)
    const best = ps.slice().sort((a, b) => Number(inForce(b)) - Number(inForce(a)) || Number(exact(b)) - Number(exact(a)) || String(b.effective).localeCompare(String(a.effective)))[0]
    const x = next[l.key] as Base
    x.on = true; x.ins = insurerFor(best); x.policy = best.policy_number || ''; x.eff = best.effective || ''; x.exp = best.expiration || ''
    // the named insured as the liability policy prints it, when the book holds it
    if (l.key === 'gl' && best.data?.named) next.insuredName = String(best.data.named)
    used.push(`${l.label}: ${writingCompany(best.carrier || '')} ${best.policy_number || ''}`)
    if (!inForce(best)) expired.push(`${l.label} ${best.policy_number || ''} (${best.expiration ? 'expired ' + best.expiration : 'not yet in force'})`)
  }
  for (const p of client.policies) if (!policyLine(p)) skipped.push(`${p.product || 'Policy'} ${p.policy_number || ''}`.trim())
  if (!next.insurers.length) next.insurers = [{ name: '', naic: '' }]
  return { cert: next, used, skipped, expired }
}

/* ---------- reading the dec sheets and binders on file ---------- */
// A client's declarations pages and binders sit in Documents. For each policy on the certificate with one on file,
// its text is read (pdf.js, as for carrier statements) and the limits are picked out by the standard labels
// ("Each Occurrence", "General Aggregate", "Bodily Injury by Accident"…). Only what is found replaces the standard
// limits; the person is shown which figures came from which file so they can check them.

/** The document on file for a policy: filed under its number, or naming it in the title or file name. */
export function docFor(p: BookPolicy, docs: Doc[]) {
  const norm = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const pn = norm(p.policy_number || '')
  if (pn.length < 5) return null
  const pdfs = docs.filter((d) => d.uploaded && /pdf/i.test(d.mime || d.file_name))
  return pdfs.find((d) => norm(d.policy_number || '') === pn) || pdfs.find((d) => norm(d.title + ' ' + d.file_name).includes(pn)) || null
}

/** A PDF's text, one line per printed row (so a label and its amount stay together). */
export async function pdfRows(data: ArrayBuffer) {
  const w = window as any
  if (!w.pdfjsLib) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js')
  w.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  const doc = await w.pdfjsLib.getDocument({ data }).promise
  const rows: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const items = (await (await doc.getPage(i)).getTextContent()).items.filter((x: any) => x.str?.trim())
    const byY = new Map<number, { x: number; s: string }[]>()
    for (const it of items) {
      const y = Math.round(it.transform[5] / 3) * 3
      const k = [...byY.keys()].find((v) => Math.abs(v - y) <= 3) ?? y
      byY.set(k, [...(byY.get(k) || []), { x: it.transform[4], s: it.str }])
    }
    ;[...byY.entries()].sort((a, b) => b[0] - a[0]).forEach(([, r]) => rows.push(r.sort((a, b) => a.x - b.x).map((t) => t.s.trim()).join(' ')))
  }
  return rows
}

const AMT = String.raw`\$?\s?(\d{1,3}(?:,\d{3})+|\d{4,})(?:\.00)?`
/** The amount printed with a label: on the same row after it (a few words between at most), or on the next row. */
function amountAfter(rows: string[], label: RegExp, after?: RegExp) {
  for (let i = 0; i < rows.length; i++) {
    const m = label.exec(rows[i]); if (!m) continue
    const rest = rows[i].slice(m.index + m[0].length)
    if (/^[^\d$]{0,40}?\b(excluded|not covered)\b/i.test(rest)) return 'Excluded'
    const same = new RegExp('^[^\\d$]{0,40}?' + AMT + (after ? '[^\\d]{0,30}?' + after.source : ''), 'i').exec(rest)
    if (same) return same[1]
    const next = rows[i + 1] && new RegExp('^[^\\d$]{0,20}?' + AMT, 'i').exec(rows[i + 1])
    if (next && !after && !/[a-z]{4,}.*[a-z]{4,}/i.test(rest)) return next[1]
  }
  return ''
}
/** An amount printed before its label ("$1,000,000 each employee"), as workers comp dec pages often do. */
function amountBefore(rows: string[], label: RegExp) {
  for (const r of rows) { const m = new RegExp(AMT + '\\s*(?:-|–)?\\s*' + label.source, 'i').exec(r); if (m) return m[1] }
  return ''
}

export interface DecRead { line: LineKey; policy: string; file: string; found: [string, string][]; addl: string; waiver: boolean; problem?: string }

/** Picks out one policy's limits from its dec sheet or binder text. */
export function readLimits(line: LineKey, rows: string[]) {
  const text = rows.join('\n')
  const f: Record<string, string> = {}
  const put = (k: string, v: string) => { if (v) f[k] = v }
  if (line === 'gl') {
    put('each', amountAfter(rows, /each occurrence(?: limit)?|liability and medical expenses/i))
    put('rented', amountAfter(rows, /damage to (?:premises )?rented(?: to you)?(?: premises)?|premises rented to you|fire (?:legal|damage)(?: liability| limit)?/i))
    put('med', amountAfter(rows, /(?<!and )medical expenses?(?: limit)?|med\.? exp/i))
    put('personal', amountAfter(rows, /personal (?:and|&) advertising injury(?: limit)?|personal (?:and|&) adv\.?(?: injury)?/i))
    put('agg', amountAfter(rows, /general aggregate(?: limit)?(?: \(other than products[\w\s/-]*\))?/i))
    put('products', amountAfter(rows, /products[\s/-]*(?:and\s*)?completed operations(?: aggregate)?(?: limit)?|products[\s/-]*comp(?:leted)?[\s/-]*op(?:eration)?s?\.?(?: agg\.?| aggregate)?/i))
  } else if (line === 'wc') {
    put('accident', amountAfter(rows, /(?:bodily injury by )?accident/i, /each accident/i) || amountBefore(rows, /each accident/i) || amountAfter(rows, /bodily injury by accident/i))
    put('employee', amountBefore(rows, /each employee/i) || amountAfter(rows, /disease[^\n]{0,20}each employee|each employee/i))
    put('disease', amountBefore(rows, /policy limit/i) || amountAfter(rows, /disease[^\n]{0,20}policy limit|policy limit/i))
  } else if (line === 'auto') {
    put('csl', amountAfter(rows, /combined single limit|\bcsl\b/i))
    put('biPerson', amountAfter(rows, /bodily injury[^\n]{0,10}(?:each|per) person/i))
    put('biAccident', amountAfter(rows, /bodily injury[^\n]{0,10}(?:each|per) accident/i))
    put('pd', amountAfter(rows, /property damage[^\n]{0,10}(?:each|per) accident|property damage/i))
  } else {
    put('each', amountAfter(rows, /each occurrence(?: limit)?/i))
    put('agg', amountAfter(rows, /aggregate(?: limit)?/i))
    put('retention', amountAfter(rows, /self[- ]insured retention|retention/i))
  }
  if (line === 'gl' || line === 'umb') {
    if (/claims[- ]made/i.test(text) && !/occurrence basis|per occurrence basis/i.test(text)) f.form = 'claims'
  }
  if (line === 'gl') { if (/per project/i.test(text)) f.aggPer = 'project'; else if (/per location/i.test(text)) f.aggPer = 'loc' }
  // the endorsements that make someone an additional insured, or waive subrogation, as named on the page
  const ai = [...new Set([...text.matchAll(/(?:CG|BP|IL|CA)\s?\d{2}\s?\d{2}[^\n;]{0,60}?additional insured[^\n;]{0,50}|additional insured[^\n;]{0,70}/gi)].map((m) => m[0].replace(/\s+/g, ' ').trim()))]
  const waiver = /waiver of (?:our right to recover|transfer of rights|subrogation)/i.test(text)
  return { found: f, addl: ai.slice(0, 2).join('; '), waiver }
}

const LABELS: Record<string, string> = {
  each: 'Each occurrence', rented: 'Damage to rented premises', med: 'Med exp', personal: 'Personal & adv injury', agg: 'Aggregate', products: 'Products-comp/op agg',
  accident: 'E.L. each accident', employee: 'E.L. disease - ea employee', disease: 'E.L. disease - policy limit', csl: 'Combined single limit',
  biPerson: 'BI per person', biAccident: 'BI per accident', pd: 'Property damage', retention: 'Retention', form: 'Coverage', aggPer: 'Aggregate applies per',
}

/**
 * Reads the dec sheets / binders on file for the policies a certificate was filled with, and returns the
 * certificate with the limits found, plus what was read from each file.
 */
export async function fillFromDecs(c: Cert, client: CoiClient) {
  let docs: Doc[] = []
  try { docs = await getDocs(client.accountId) } catch { return { cert: c, reads: [] as DecRead[] } }
  const next: Cert = JSON.parse(JSON.stringify(c))
  const reads: DecRead[] = []
  for (const l of LINES) {
    const x = next[l.key] as unknown as Base & Record<string, unknown>
    if (!x.on) continue
    const p = client.policies.find((q) => q.policy_number === x.policy)
    const d = p && docFor(p, docs)
    if (!p || !d) continue
    const r: DecRead = { line: l.key, policy: x.policy, file: d.title || d.file_name, found: [], addl: '', waiver: false }
    try {
      const { data, error } = await supabase.storage.from('documents').download(d.storage_path)
      if (error || !data) throw error || new Error('not found')
      const rows = await pdfRows(await data.arrayBuffer())
      if (!rows.join('').trim()) r.problem = 'no readable text (a scanned page) — enter the limits by hand'
      else {
        const got = readLimits(l.key, rows)
        for (const [k, v] of Object.entries(got.found)) {
          x[k] = v
          r.found.push([LABELS[k] || k, k === 'form' ? (v === 'claims' ? 'Claims-made' : 'Occurrence') : k === 'aggPer' ? v : v === 'Excluded' ? v : '$' + v])
        }
        r.addl = got.addl; r.waiver = got.waiver
        if (!r.found.length) r.problem = 'no limits found on it — enter them by hand'
      }
    } catch (e) { r.problem = 'could not be opened (' + ((e as Error)?.message || 'error') + ')' }
    reads.push(r)
  }
  return { cert: next, reads }
}

/* ---------- the printed certificate ---------- */
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!))
const lines = (s: string) => esc(s).split(/\r?\n/).filter((l) => l.trim()).join('<br>')
const mdy = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? `${m[2]}/${m[3]}/${m[1]}` : '' }
const box = (on: boolean, label: string) => `<span class="ck">${on ? '&#9746;' : '&#9744;'} ${label}</span>`
const amt = (v: string) => (!v.trim() ? '$' : /\d/.test(v) ? '$ ' + esc(v.trim().replace(/^\$\s*/, '')) : esc(v.trim()))
const limits = (rows: [string, string][]) => '<table class="lim">' + rows.map(([l, v]) => `<tr><td>${l}</td><td class="lv">${v}</td></tr>`).join('') + '</table>'

export function certificateHTML(p: Producer, c: Cert) {
  const L = (k: LineKey) => (c[k].on ? LETTERS[c[k].ins] : '')
  const yn = (k: LineKey, f: 'addl' | 'subr') => (c[k].on && c[k][f] ? 'Y' : '')
  const pol = (k: LineKey) => (c[k].on ? esc(c[k].policy) : '')
  const dt = (k: LineKey, f: 'eff' | 'exp') => (c[k].on ? mdy(c[k][f]) : '')
  const row = (k: LineKey, type: string, lim: string) =>
    `<tr class="cov"><td class="c">${L(k)}</td><td class="ty">${type}</td><td class="c">${yn(k, 'addl')}</td><td class="c">${yn(k, 'subr')}</td>` +
    `<td>${pol(k)}</td><td class="c">${dt(k, 'eff')}</td><td class="c">${dt(k, 'exp')}</td><td class="lm">${lim}</td></tr>`
  const g = c.gl, a = c.auto, u = c.umb, w = c.wc
  const glOn = g.on, auOn = a.on, umOn = u.on, wcOn = w.on
  const glType = `<b>COMMERCIAL GENERAL LIABILITY</b><div>${box(glOn && g.form === 'claims', 'CLAIMS-MADE')} ${box(glOn && g.form === 'occur', 'OCCUR')}</div>` +
    `<div class="sm">GEN'L AGGREGATE LIMIT APPLIES PER:</div><div>${box(glOn && g.aggPer === 'policy', 'POLICY')} ${box(glOn && g.aggPer === 'project', 'PRO-JECT')} ${box(glOn && g.aggPer === 'loc', 'LOC')}</div>`
  const glLim = limits([['EACH OCCURRENCE', glOn ? amt(g.each) : '$'], ['DAMAGE TO RENTED PREMISES (Ea occurrence)', glOn ? amt(g.rented) : '$'], ['MED EXP (Any one person)', glOn ? amt(g.med) : '$'],
    ['PERSONAL &amp; ADV INJURY', glOn ? amt(g.personal) : '$'], ['GENERAL AGGREGATE', glOn ? amt(g.agg) : '$'], ['PRODUCTS - COMP/OP AGG', glOn ? amt(g.products) : '$']])
  const auType = `<b>AUTOMOBILE LIABILITY</b><div>${box(auOn && a.any, 'ANY AUTO')}</div><div>${box(auOn && a.owned, 'OWNED AUTOS ONLY')} ${box(auOn && a.scheduled, 'SCHEDULED AUTOS')}</div>` +
    `<div>${box(auOn && a.hired, 'HIRED AUTOS ONLY')} ${box(auOn && a.nonowned, 'NON-OWNED AUTOS ONLY')}</div>`
  const auLim = limits([['COMBINED SINGLE LIMIT (Ea accident)', auOn ? amt(a.csl) : '$'], ['BODILY INJURY (Per person)', auOn ? amt(a.biPerson) : '$'],
    ['BODILY INJURY (Per accident)', auOn ? amt(a.biAccident) : '$'], ['PROPERTY DAMAGE (Per accident)', auOn ? amt(a.pd) : '$']])
  const umType = `<div>${box(umOn && u.kind === 'umbrella', '<b>UMBRELLA LIAB</b>')} ${box(umOn && u.form === 'occur', 'OCCUR')}</div><div>${box(umOn && u.kind === 'excess', '<b>EXCESS LIAB</b>')} ${box(umOn && u.form === 'claims', 'CLAIMS-MADE')}</div>` +
    `<div>${box(umOn && u.ded, 'DED')} ${box(umOn && !!u.retention.trim(), 'RETENTION ' + (umOn && u.retention.trim() ? amt(u.retention) : '$'))}</div>`
  const umLim = limits([['EACH OCCURRENCE', umOn ? amt(u.each) : '$'], ['AGGREGATE', umOn ? amt(u.agg) : '$']])
  const wcType = `<b>WORKERS COMPENSATION AND EMPLOYERS' LIABILITY</b><div class="sm">ANY PROPRIETOR/PARTNER/EXECUTIVE OFFICER/MEMBER EXCLUDED? (Mandatory in NH) <span class="yn">${wcOn ? w.excluded : ''}</span></div>` +
    `<div class="sm">If yes, describe under DESCRIPTION OF OPERATIONS below</div>`
  const wcLim = `<div>${box(wcOn && w.statute, 'PER STATUTE')} ${box(wcOn && !w.statute, 'OTHER')}</div>` +
    limits([['E.L. EACH ACCIDENT', wcOn ? amt(w.accident) : '$'], ['E.L. DISEASE - EA EMPLOYEE', wcOn ? amt(w.employee) : '$'], ['E.L. DISEASE - POLICY LIMIT', wcOn ? amt(w.disease) : '$']])
  const wcRow = `<tr class="cov"><td class="c">${L('wc')}</td><td class="ty">${wcType}</td><td class="c na">N/A</td><td class="c">${yn('wc', 'subr')}</td>` +
    `<td>${pol('wc')}</td><td class="c">${dt('wc', 'eff')}</td><td class="c">${dt('wc', 'exp')}</td><td class="lm">${wcLim}</td></tr>`
  const insurers = LETTERS.map((l, i) => `<tr><td>INSURER ${l} :</td><td>${esc(c.insurers[i]?.name)}</td><td class="naic">${esc(c.insurers[i]?.naic)}</td></tr>`).join('')

  return `<div class="coi">
  <table class="hd"><tr><td class="ttl">CERTIFICATE OF LIABILITY INSURANCE</td><td class="dt"><div class="sm">DATE (MM/DD/YYYY)</div>${mdy(c.date)}</td></tr></table>
  <div class="bx fine">THIS CERTIFICATE IS ISSUED AS A MATTER OF INFORMATION ONLY AND CONFERS NO RIGHTS UPON THE CERTIFICATE HOLDER. THIS CERTIFICATE DOES NOT AFFIRMATIVELY OR NEGATIVELY AMEND, EXTEND OR ALTER THE COVERAGE AFFORDED BY THE POLICIES BELOW. THIS CERTIFICATE OF INSURANCE DOES NOT CONSTITUTE A CONTRACT BETWEEN THE ISSUING INSURER(S), AUTHORIZED REPRESENTATIVE OR PRODUCER, AND THE CERTIFICATE HOLDER.</div>
  <div class="bx fine"><b>IMPORTANT:</b> If the certificate holder is an ADDITIONAL INSURED, the policy(ies) must have ADDITIONAL INSURED provisions or be endorsed. If SUBROGATION IS WAIVED, subject to the terms and conditions of the policy, certain policies may require an endorsement. A statement on this certificate does not confer rights to the certificate holder in lieu of such endorsement(s).</div>
  <table class="grid"><tr>
    <td class="half"><div class="sm">PRODUCER</div><div class="big">${esc(p.name)}</div><div>${lines(p.address)}</div></td>
    <td class="half"><table class="ct">
      <tr><td class="sm">CONTACT NAME:</td><td colspan="3">${esc(p.contact)}</td></tr>
      <tr><td class="sm">PHONE (A/C, No, Ext):</td><td>${esc(p.phone)}</td><td class="sm">FAX (A/C, No):</td><td>${esc(p.fax)}</td></tr>
      <tr><td class="sm">E-MAIL ADDRESS:</td><td colspan="3">${esc(p.email)}</td></tr>
    </table>
    <table class="ins"><tr><th colspan="2">INSURER(S) AFFORDING COVERAGE</th><th class="naic">NAIC #</th></tr>${insurers}</table></td>
  </tr><tr>
    <td class="half"><div class="sm">INSURED</div><div class="big">${esc(c.insuredName)}</div><div>${lines(c.insuredAddress)}</div></td><td class="half blank"></td>
  </tr></table>
  <table class="covh"><tr><td class="ttl2">COVERAGES</td><td>CERTIFICATE NUMBER: ${esc(c.number)}</td><td>REVISION NUMBER: ${esc(c.revision)}</td></tr></table>
  <div class="bx fine">THIS IS TO CERTIFY THAT THE POLICIES OF INSURANCE LISTED BELOW HAVE BEEN ISSUED TO THE INSURED NAMED ABOVE FOR THE POLICY PERIOD INDICATED. NOTWITHSTANDING ANY REQUIREMENT, TERM OR CONDITION OF ANY CONTRACT OR OTHER DOCUMENT WITH RESPECT TO WHICH THIS CERTIFICATE MAY BE ISSUED OR MAY PERTAIN, THE INSURANCE AFFORDED BY THE POLICIES DESCRIBED HEREIN IS SUBJECT TO ALL THE TERMS, EXCLUSIONS AND CONDITIONS OF SUCH POLICIES. LIMITS SHOWN MAY HAVE BEEN REDUCED BY PAID CLAIMS.</div>
  <table class="covs">
    <thead><tr><th class="c w4">INSR LTR</th><th class="w28">TYPE OF INSURANCE</th><th class="c w4">ADDL INSD</th><th class="c w4">SUBR WVD</th><th class="w14">POLICY NUMBER</th><th class="c w8">POLICY EFF (MM/DD/YYYY)</th><th class="c w8">POLICY EXP (MM/DD/YYYY)</th><th>LIMITS</th></tr></thead>
    <tbody>${row('gl', glType, glLim)}${row('auto', auType, auLim)}${row('umb', umType, umLim)}${wcRow}</tbody>
  </table>
  <div class="bx ops"><div class="sm">DESCRIPTION OF OPERATIONS / LOCATIONS / VEHICLES (ACORD 101, Additional Remarks Schedule, may be attached if more space is required)</div><div>${lines(c.ops)}</div></div>
  <table class="grid foot"><tr>
    <td class="half"><div class="sm">CERTIFICATE HOLDER</div><div class="big">${esc(c.holderName)}</div><div>${lines(c.holderAddress)}</div></td>
    <td class="half"><div class="sm">CANCELLATION</div><div class="fine">SHOULD ANY OF THE ABOVE DESCRIBED POLICIES BE CANCELLED BEFORE THE EXPIRATION DATE THEREOF, NOTICE WILL BE DELIVERED IN ACCORDANCE WITH THE POLICY PROVISIONS.</div>
      <div class="sm rep">AUTHORIZED REPRESENTATIVE</div><div class="sig">${esc(p.rep)}</div></td>
  </tr></table>
  <div class="form">ACORD 25 layout</div>
</div>`
}

export const CERT_CSS = `
@page { size: letter; margin: .4in; }
* { box-sizing: border-box; }
body { margin: 0; font: 9px/1.25 Arial, Helvetica, sans-serif; color: #000; background: #fff; }
.coi { width: 7.7in; margin: 0 auto; }
table { border-collapse: collapse; width: 100%; }
td, th { vertical-align: top; padding: 2px 4px; text-align: left; }
.hd td { border: 1.5px solid #000; }
.ttl { font-size: 17px; font-weight: bold; text-align: center; vertical-align: middle; padding: 8px; }
.dt { width: 1.3in; text-align: center; font-size: 11px; }
.bx { border: 1px solid #000; border-top: 0; padding: 3px 5px; }
.fine { font-size: 7.5px; line-height: 1.3; }
.sm { font-size: 7px; font-weight: bold; text-transform: uppercase; }
.big { font-weight: bold; font-size: 10.5px; }
.grid td.half { width: 50%; border: 1px solid #000; border-top: 0; padding: 4px 5px; min-height: .7in; height: .8in; }
.grid td.blank { border-left: 0; }
.ct td { border-bottom: 1px solid #000; padding: 2px 3px; }
.ins { margin-top: 2px; }
.ins th { font-size: 7px; border-bottom: 1px solid #000; }
.ins td { border-bottom: 1px solid #ccc; font-size: 8.5px; }
.ins td:first-child { font-size: 7px; font-weight: bold; white-space: nowrap; width: 58px; }
.naic { width: 52px; text-align: center; border-left: 1px solid #000; }
.covh td { border: 1px solid #000; border-top: 0; font-weight: bold; font-size: 8px; padding: 3px 5px; }
.ttl2 { font-size: 11px; }
.covs th { border: 1px solid #000; font-size: 6.5px; background: #eee; vertical-align: middle; }
.covs td { border: 1px solid #000; font-size: 8.5px; }
.covs .c { text-align: center; }
.covs .ty { font-size: 7px; }
.covs .ty b { font-size: 7.5px; }
.covs .na { font-size: 6.5px; color: #555; }
.w4 { width: 4%; } .w8 { width: 8%; } .w14 { width: 14%; } .w28 { width: 28%; }
.ck { white-space: nowrap; margin-right: 4px; font-size: 7px; }
.yn { border: 1px solid #000; padding: 0 4px; margin-left: 2px; font-size: 8px; }
.lm { padding: 0; }
.lim td { border: 0; border-bottom: 1px solid #000; font-size: 6.5px; padding: 1px 3px; }
.lim tr:last-child td { border-bottom: 0; }
.lim .lv { width: 44%; border-left: 1px solid #000; font-size: 8.5px; white-space: nowrap; }
.lm > div { padding: 1px 3px; border-bottom: 1px solid #000; }
.ops { min-height: 1.1in; font-size: 9px; }
.ops > div + div { margin-top: 3px; }
.foot td.half { height: 1.2in; }
.rep { margin-top: 12px; }
.sig { font-size: 11px; font-style: italic; margin-top: 4px; }
.form { font-size: 7px; margin-top: 3px; }
@media screen { body { padding: 16px; background: #f1f3f5; } .coi { background: #fff; padding: 12px; box-shadow: 0 1px 6px rgba(0,0,0,.15); } }
`

/** Prints the certificate from a hidden frame (Save as PDF from the print dialog), leaving the page as it is. */
export function printCertificate(p: Producer, c: Cert) {
  const fr = document.createElement('iframe')
  fr.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'
  document.body.appendChild(fr)
  const d = fr.contentDocument!
  const title = `COI · ${c.insuredName} · ${c.holderName}`.replace(/[\\/:*?"<>|]/g, ' ')
  d.open(); d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CERT_CSS}</style></head><body>${certificateHTML(p, c)}</body></html>`); d.close()
  setTimeout(() => { fr.contentWindow!.focus(); fr.contentWindow!.print(); setTimeout(() => fr.remove(), 1000) }, 80)
}
