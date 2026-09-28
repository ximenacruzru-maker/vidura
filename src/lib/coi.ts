// Certificates of liability insurance (the ACORD 25 layout) from Agency Resources. The agency's own details (the
// producer block) and the insurance companies used before are kept per agency in public.coi_profile; a certificate
// is laid out here as a printable page, one letter-size sheet per certificate.
import { supabase } from './supabase'

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

/* ---------- the printed certificate ---------- */
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!))
const lines = (s: string) => esc(s).split(/\r?\n/).filter((l) => l.trim()).join('<br>')
const mdy = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? `${m[2]}/${m[3]}/${m[1]}` : '' }
const box = (on: boolean, label: string) => `<span class="ck">${on ? '&#9746;' : '&#9744;'} ${label}</span>`
const amt = (v: string) => (v.trim() ? '$ ' + esc(v.trim().replace(/^\$\s*/, '')) : '$')
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
