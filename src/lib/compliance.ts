// Compliance files: what a California insurance agency keeps for an audit — the business's legal, licensing, employer
// and tax records, and each employee's file — with how often each is due, so HR can see the risk gaps (missing,
// expired or about to expire) and close them. A checklist of what is commonly required, not legal advice: the agency's
// accountant or attorney has the last word for its own situation.
import { supabase } from './supabase'
import { loadScript } from './perf/commissionFiles'

export type Scope = 'person' | 'agency'
/** once: one copy on file · yearly / quarterly: one per period (the last completed ones are checked) ·
 *  expires: must be current (has an expiry date) · period: any number, by date range (timesheets) · any: optional */
export type Freq = 'once' | 'yearly' | 'quarterly' | 'expires' | 'period' | 'any'
/** who an employee document is required for */
export type Who = 'all' | 'hourly' | 'commission' | 'licensed' | 'leaver' | 'none'
export interface DocType { key: string; label: string; short?: string; scope: Scope; group: string; freq: Freq; required: boolean | Who; why: string; severity?: 1 | 2 | 3 }

export const AGENCY_GROUPS = ['Business registration', 'Insurance licensing & regulation', 'Agency insurance', 'Employer requirements', 'Taxes', 'Contracts & property', 'Audits & other'] as const
export const PERSON_GROUPS = ['Hiring & tax forms', 'Pay & time', 'Policies & training', 'Licensing', 'Performance & separation'] as const

export const TYPES: DocType[] = [
  /* ---------- the agency ---------- */
  { key: 'articles', label: 'Articles of Incorporation / Organization', scope: 'agency', group: 'Business registration', freq: 'once', required: true, severity: 2, why: 'Filed with the California Secretary of State when the business was formed.' },
  { key: 'sos_soi', label: 'Statement of Information (Secretary of State)', short: 'SOS Statement of Info', scope: 'agency', group: 'Business registration', freq: 'expires', required: true, severity: 2, why: 'Corporations file every year, LLCs every two years; late filing brings penalties and suspension.' },
  { key: 'ein', label: 'IRS EIN confirmation letter (CP 575 / 147C)', short: 'EIN letter', scope: 'agency', group: 'Business registration', freq: 'once', required: true, severity: 2, why: 'Proves the federal employer ID used on every tax and payroll filing.' },
  { key: 'business_license', label: 'City business license / business tax certificate', short: 'Business license', scope: 'agency', group: 'Business registration', freq: 'expires', required: true, severity: 3, why: 'Required by the city or county where the office is; renews every year.' },
  { key: 'dba', label: 'Fictitious Business Name (DBA) statement', short: 'DBA', scope: 'agency', group: 'Business registration', freq: 'expires', required: false, why: 'Needed if the agency operates under a name other than its legal name; renews every 5 years with the county.' },
  { key: 'bylaws', label: 'Bylaws / operating agreement and minutes', scope: 'agency', group: 'Business registration', freq: 'any', required: false, why: 'The governing documents of the business and its owner decisions.' },

  { key: 'agency_license', label: 'CA Department of Insurance agency (business entity) license', short: 'Agency license', scope: 'agency', group: 'Insurance licensing & regulation', freq: 'expires', required: true, severity: 3, why: 'The agency must hold a current DOI license; renews every 2 years. Also tracked under Licenses.' },
  { key: 'eo', label: 'Errors & omissions (E&O) policy', short: 'E&O policy', scope: 'agency', group: 'Agency insurance', freq: 'expires', required: true, severity: 3, why: 'Professional liability coverage the carrier agreement requires. Also tracked under Licenses.' },
  { key: 'appointment', label: 'Carrier agency agreement / appointments (Farmers and others)', short: 'Carrier agreements', scope: 'agency', group: 'Insurance licensing & regulation', freq: 'any', required: true, severity: 2, why: 'The contracts that let the agency write for each carrier.' },
  { key: 'trust_account', label: 'Premium trust account statements (fiduciary funds)', short: 'Premium trust stmts', scope: 'agency', group: 'Insurance licensing & regulation', freq: 'period', required: true, severity: 3, why: 'Premiums collected are fiduciary funds under the Insurance Code (§1733–1734); keep the account records for a DOI examination.' },
  { key: 'privacy', label: 'Privacy notice & information-security policy', short: 'Privacy / security policy', scope: 'agency', group: 'Insurance licensing & regulation', freq: 'once', required: true, severity: 2, why: 'How customer information is collected, shared and protected (Insurance Information and Privacy Protection Act).' },
  { key: 'aml', label: 'Anti-money laundering program', short: 'AML program', scope: 'agency', group: 'Insurance licensing & regulation', freq: 'once', required: false, why: 'Needed when the agency sells life insurance or annuities.' },
  { key: 'surety', label: 'Surety bond', scope: 'agency', group: 'Agency insurance', freq: 'expires', required: false, why: 'If a carrier or license type requires one.' },
  { key: 'doi', label: 'DOI examination / complaint correspondence', scope: 'agency', group: 'Insurance licensing & regulation', freq: 'any', required: false, why: 'Anything to or from the Department of Insurance.' },

  { key: 'edd', label: 'EDD employer registration (payroll tax account number)', short: 'EDD registration', scope: 'agency', group: 'Employer requirements', freq: 'once', required: true, severity: 2, why: 'Registration with the Employment Development Department to report wages and pay payroll taxes.' },
  { key: 'agency_wc', label: 'Agency workers’ compensation policy', short: 'Agency workers’ comp', scope: 'agency', group: 'Agency insurance', freq: 'expires', required: true, severity: 3, why: 'Every California employer must carry workers’ comp (Labor Code §3700); going without it is a crime.' },
  { key: 'iipp', label: 'Injury & Illness Prevention Program (IIPP)', short: 'IIPP', scope: 'agency', group: 'Employer requirements', freq: 'once', required: true, severity: 2, why: 'A written safety program every California employer must have (Cal/OSHA, Title 8 §3203).' },
  { key: 'wvpp', label: 'Workplace Violence Prevention Plan', short: 'Violence prevention plan', scope: 'agency', group: 'Employer requirements', freq: 'once', required: true, severity: 2, why: 'Required of most California employers since July 1, 2024 (Labor Code §6401.9), with training and an incident log.' },
  { key: 'harassment_policy', label: 'Written harassment, discrimination & retaliation policy', short: 'Harassment policy', scope: 'agency', group: 'Employer requirements', freq: 'once', required: true, severity: 2, why: 'California employers must have and hand out a written policy (Gov. Code §12950).' },
  { key: 'handbook', label: 'Employee handbook (current version)', short: 'Handbook', scope: 'agency', group: 'Employer requirements', freq: 'once', required: true, severity: 1, why: 'Pay, leave, sick-time and conduct policies employees sign for.' },
  { key: 'posters', label: 'Labor law posters (federal + California, current year)', short: 'Labor law posters', scope: 'agency', group: 'Employer requirements', freq: 'yearly', required: true, severity: 1, why: 'Required workplace postings; a photo of the current posters on the wall is good proof.' },
  { key: 'calsavers', label: 'CalSavers registration or retirement-plan exemption', short: 'CalSavers', scope: 'agency', group: 'Employer requirements', freq: 'once', required: true, severity: 1, why: 'California employers with employees must offer a retirement plan or register for CalSavers.' },

  { key: 'tax_federal', label: 'Federal income tax return (1120 / 1120-S / 1065 / Schedule C)', short: 'Federal tax return', scope: 'agency', group: 'Taxes', freq: 'yearly', required: true, severity: 2, why: 'The business’s yearly federal return.' },
  { key: 'tax_state', label: 'California tax return (FTB 100 / 100S / 565 / 568)', short: 'CA tax return', scope: 'agency', group: 'Taxes', freq: 'yearly', required: true, severity: 2, why: 'The business’s yearly Franchise Tax Board return.' },
  { key: 'f941', label: 'Form 941 — quarterly federal payroll tax return', short: 'Form 941', scope: 'agency', group: 'Taxes', freq: 'quarterly', required: true, severity: 2, why: 'Filed every quarter with the IRS for withheld income tax, Social Security and Medicare.' },
  { key: 'de9', label: 'DE 9 / DE 9C — quarterly California payroll report', short: 'DE 9 / DE 9C', scope: 'agency', group: 'Taxes', freq: 'quarterly', required: true, severity: 2, why: 'Filed every quarter with the EDD.' },
  { key: 'f940', label: 'Form 940 — yearly federal unemployment (FUTA) return', short: 'Form 940', scope: 'agency', group: 'Taxes', freq: 'yearly', required: true, severity: 1, why: 'Filed every year with the IRS.' },
  { key: 'w2w3', label: 'W-2s and W-3 transmittal', short: 'W-2 / W-3', scope: 'agency', group: 'Taxes', freq: 'yearly', required: true, severity: 2, why: 'Every employee’s yearly wage statement, filed by January 31.' },
  { key: 'f1099', label: '1099-NEC / 1096 for contractors', short: '1099s', scope: 'agency', group: 'Taxes', freq: 'yearly', required: false, why: 'For anyone paid $600+ as a contractor, filed by January 31.' },
  { key: 'property_tax', label: 'Business property statement (571-L)', short: '571-L', scope: 'agency', group: 'Taxes', freq: 'yearly', required: false, why: 'County assessor filing when office equipment and furniture are worth $100,000 or more, or when the assessor asks.' },
  { key: 'tax_notice', label: 'IRS / FTB / EDD notices and payment records', short: 'Tax notices', scope: 'agency', group: 'Taxes', freq: 'any', required: false, why: 'Letters from tax agencies and proof of payment.' },

  { key: 'lease', label: 'Office lease', scope: 'agency', group: 'Contracts & property', freq: 'expires', required: false, why: 'The office rental agreement.' },
  { key: 'office_insurance', label: 'Office general liability / BOP policy', short: 'Office liability policy', scope: 'agency', group: 'Agency insurance', freq: 'expires', required: true, severity: 2, why: 'Covers the office premises (often required by the lease).' },
  { key: 'cyber', label: 'Cyber liability policy', scope: 'agency', group: 'Agency insurance', freq: 'expires', required: false, why: 'Covers a data breach of customer information.' },
  { key: 'epli', label: 'Employment practices liability (EPLI)', short: 'EPLI', scope: 'agency', group: 'Agency insurance', freq: 'expires', required: false, why: 'Covers claims by employees (harassment, wrongful termination, wage claims).' },
  { key: 'crime', label: 'Crime / fidelity bond (employee dishonesty)', short: 'Crime / fidelity', scope: 'agency', group: 'Agency insurance', freq: 'expires', required: false, why: 'Protects the premium trust account and agency funds from theft.' },
  { key: 'agency_auto', label: 'Commercial auto / hired & non-owned auto', short: 'Agency auto', scope: 'agency', group: 'Agency insurance', freq: 'expires', required: false, why: 'If staff drive for the agency, in their own cars or agency vehicles.' },
  { key: 'agency_umbrella', label: 'Agency umbrella policy', short: 'Agency umbrella', scope: 'agency', group: 'Agency insurance', freq: 'expires', required: false, why: '' },
  { key: 'comp_plans', label: 'Compensation plans and commission schedules (agency-wide)', short: 'Comp plans', scope: 'agency', group: 'Employer requirements', freq: 'once', required: true, severity: 2, why: 'The current pay and commission structure for every role, as set in Commission setup; keep each version.' },
  { key: 'vendor', label: 'Vendor & software contracts (AgencyZoom, raters, phones)', short: 'Vendor contracts', scope: 'agency', group: 'Contracts & property', freq: 'any', required: false, why: 'The agreements the agency has signed with its vendors, including how they protect customer data.' },
  { key: 'bank', label: 'Bank statements (operating account)', scope: 'agency', group: 'Contracts & property', freq: 'period', required: false, why: 'Kept with the tax records.' },
  { key: 'audit', label: 'Audit responses & correspondence', scope: 'agency', group: 'Audits & other', freq: 'any', required: false, why: 'Anything sent or received in an audit (carrier, DOI, EDD, IRS, workers’ comp premium audit).' },
  { key: 'agency_other', label: 'Other legal document', scope: 'agency', group: 'Audits & other', freq: 'any', required: false, why: '' },

  /* ---------- each employee ---------- */
  { key: 'w4', label: 'Form W-4 (federal withholding)', short: 'W-4', scope: 'person', group: 'Hiring & tax forms', freq: 'once', required: 'all', severity: 2, why: 'Filled out by every employee at hire.' },
  { key: 'de4', label: 'DE 4 (California withholding)', short: 'DE 4', scope: 'person', group: 'Hiring & tax forms', freq: 'once', required: 'all', severity: 1, why: 'California’s withholding certificate.' },
  { key: 'i9', label: 'Form I-9 and ID copies (employment eligibility)', short: 'I-9', scope: 'person', group: 'Hiring & tax forms', freq: 'once', required: 'all', severity: 3, why: 'Required for every employee within 3 days of starting; kept 3 years after hire or 1 year after they leave, whichever is later.' },
  { key: 'offer', label: 'Offer letter / employment agreement', short: 'Offer letter', scope: 'person', group: 'Hiring & tax forms', freq: 'once', required: 'all', severity: 1, why: 'Position, pay and start date in writing.' },
  { key: 'newhire_notices', label: 'New-hire notices acknowledgment (workers’ comp pamphlet, DE 2515, DE 2511, CRD harassment, sick leave)', short: 'New-hire notices', scope: 'person', group: 'Hiring & tax forms', freq: 'once', required: 'all', severity: 1, why: 'California requires these pamphlets and notices at hire; a signed acknowledgment proves they were given.' },
  { key: 'direct_deposit', label: 'Direct deposit authorization', short: 'Direct deposit', scope: 'person', group: 'Hiring & tax forms', freq: 'once', required: false, why: '' },
  { key: 'emergency', label: 'Emergency contact form', scope: 'person', group: 'Hiring & tax forms', freq: 'once', required: false, why: '' },
  { key: 'background', label: 'Background check consent & results', scope: 'person', group: 'Hiring & tax forms', freq: 'once', required: false, why: 'Fair Chance Act rules apply; consent must be kept.' },

  { key: 'wage_notice', label: 'Wage theft prevention notice (Labor Code §2810.5)', short: 'Wage notice', scope: 'person', group: 'Pay & time', freq: 'once', required: 'hourly', severity: 2, why: 'Given to every non-exempt (hourly) employee at hire and whenever pay terms change.' },
  { key: 'comp_plan', label: 'Signed compensation plan (pay rate, bonus and commission terms)', short: 'Comp plan', scope: 'person', group: 'Pay & time', freq: 'once', required: 'all', severity: 2, why: 'Each person’s current pay terms in writing, signed — and every change after. Keep the old versions.' },
  { key: 'commission_agreement', label: 'Written commission agreement (Labor Code §2751)', short: 'Commission agreement', scope: 'person', group: 'Pay & time', freq: 'once', required: 'commission', severity: 3, why: 'California requires a signed written agreement for anyone paid commission, saying how it is earned and paid.' },
  { key: 'timesheet', label: 'Timesheet', short: 'Timesheets', scope: 'person', group: 'Pay & time', freq: 'period', required: 'hourly', severity: 2, why: 'Hourly employees’ time records, kept at least 3 years (4 for the IRS). Clock-in punches are also under Timesheets.' },
  { key: 'paystub', label: 'Pay stub / payroll record', short: 'Pay stubs', scope: 'person', group: 'Pay & time', freq: 'period', required: false, why: 'Itemized wage statements, kept at least 3 years.' },

  { key: 'handbook_ack', label: 'Handbook acknowledgment (signed)', short: 'Handbook ack.', scope: 'person', group: 'Policies & training', freq: 'once', required: 'all', severity: 1, why: 'Shows the employee received the policies.' },
  { key: 'harassment_training', label: 'Harassment prevention training certificate', short: 'Harassment training', scope: 'person', group: 'Policies & training', freq: 'expires', required: 'all', severity: 2, why: 'California (SB 1343): 1 hour for employees, 2 for supervisors, within 6 months of hire and every 2 years. Set the expiry 2 years after the training date.' },
  { key: 'confidentiality', label: 'Confidentiality / customer-data agreement', short: 'Confidentiality', scope: 'person', group: 'Policies & training', freq: 'once', required: false, why: 'Employees handle customers’ private information.' },
  { key: 'person_training', label: 'Other training certificate (AML, compliance, safety)', short: 'Other training', scope: 'person', group: 'Policies & training', freq: 'any', required: false, why: '' },

  { key: 'license_copy', label: 'Insurance license copy', short: 'License copy', scope: 'person', group: 'Licensing', freq: 'expires', required: 'licensed', severity: 2, why: 'Anyone who quotes or sells must be licensed. Also tracked under Licenses.' },
  { key: 'ce', label: 'Continuing education certificates', short: 'CE', scope: 'person', group: 'Licensing', freq: 'any', required: false, why: '' },

  { key: 'review', label: 'Performance review', scope: 'person', group: 'Performance & separation', freq: 'any', required: false, why: '' },
  { key: 'discipline', label: 'Write-up / warning', scope: 'person', group: 'Performance & separation', freq: 'any', required: false, why: '' },
  { key: 'leave', label: 'Leave / disability filing', scope: 'person', group: 'Performance & separation', freq: 'any', required: false, why: '' },
  { key: 'separation', label: 'Separation records (final paycheck, DE 2320 notice)', short: 'Separation', scope: 'person', group: 'Performance & separation', freq: 'once', required: 'leaver', severity: 2, why: 'Final pay is due on the last day (or within 72 hours after a resignation without notice), with the EDD “For Your Benefit” notice (DE 2320).' },
  { key: 'person_other', label: 'Other employee document', scope: 'person', group: 'Performance & separation', freq: 'any', required: false, why: '' },
]
export const typeOf = (k: string) => TYPES.find((t) => t.key === k)

export interface CFile { id: string; scope: Scope; staff_name: string | null; doc_type: string; title: string | null; period_from: string | null; period_to: string | null; expires_on: string | null; file_name: string; mime: string | null; size_bytes: number | null; storage_path: string; note: string | null; vendor_id?: string | null; uploaded_by: string | null; created_at: string }
export interface Mark { scope: Scope; staff_name: string; doc_type: string; mark: 'accountant' | 'na'; note: string | null; marked_by: string | null; marked_at: string }
export const MARK_LABEL = { accountant: 'Kept by our accountant / payroll provider', na: 'Doesn’t apply to us' }
export interface Person { name: string; role: string | null; hourly: boolean; active: boolean; hired_on: string | null; left_on: string | null }

export async function getFiles(): Promise<CFile[]> {
  const { data, error } = await supabase.from('compliance_files').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return (data || []) as CFile[]
}
export async function getMarks(): Promise<Mark[]> {
  const { data, error } = await supabase.from('compliance_marks').select('*')
  if (error) throw error
  return (data || []) as Mark[]
}
export async function setMark(scope: Scope, staff: string | null, doc_type: string, mark: Mark['mark'] | null, note?: string) {
  const key = { scope, staff_name: staff || '', doc_type }
  const { error } = mark
    ? await supabase.from('compliance_marks').upsert({ ...key, mark, note: note || null }, { onConflict: 'agency_id,scope,staff_name,doc_type' })
    : await supabase.from('compliance_marks').delete().match(key)
  if (error) throw error
}
export async function getPeople(): Promise<Person[]> {
  const { data, error } = await supabase.from('hr_staff').select('name, role, hourly, active, hired_on, left_on').order('name')
  if (error) throw error
  return (data || []) as Person[]
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'file'
export async function uploadFile(agencyId: string, f: File, meta: { scope: Scope; staff_name?: string | null; doc_type: string; period_from?: string | null; period_to?: string | null; expires_on?: string | null; note?: string | null; vendor_id?: string | null }) {
  const ext = (f.name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || 'pdf'
  const path = `${agencyId}/hr/${meta.scope}/${slug(meta.staff_name || 'agency')}/${meta.doc_type}/${crypto.randomUUID()}.${ext}`
  const up = await supabase.storage.from('documents').upload(path, f, { upsert: false, contentType: f.type || 'application/octet-stream' })
  if (up.error) throw up.error
  const { error } = await supabase.from('compliance_files').insert({
    scope: meta.scope, staff_name: meta.scope === 'person' ? meta.staff_name : null, doc_type: meta.doc_type, title: typeOf(meta.doc_type)?.label || meta.doc_type,
    period_from: meta.period_from || null, period_to: meta.period_to || null, expires_on: meta.expires_on || null, note: meta.note || null,
    file_name: f.name, mime: f.type || null, size_bytes: f.size, storage_path: path, vendor_id: meta.vendor_id || null,
  })
  if (error) { await supabase.storage.from('documents').remove([path]); throw error }
}
export async function deleteFile(f: CFile) {
  const { error } = await supabase.from('compliance_files').delete().eq('id', f.id)
  if (error) throw error
  await supabase.storage.from('documents').remove([f.storage_path])
}
export async function openFile(f: CFile, download = false) {
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(f.storage_path, 120, download ? { download: f.file_name } : undefined)
  if (error || !data) { alert('Could not open that file: ' + (error?.message || 'unknown error')); return }
  window.open(data.signedUrl, '_blank', 'noopener')
}

/* ---------- what's due, and the gaps ---------- */
const pad = (n: number) => String(n).padStart(2, '0')
/** the last completed calendar year, and the last four completed quarters */
export function duePeriods(today: string) {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)), q = Math.ceil(m / 3)
  const quarters: { label: string; from: string; to: string }[] = []
  for (let i = 1; i <= 4; i++) {
    let qq = q - i, yy = y
    while (qq < 1) { qq += 4; yy-- }
    const sm = (qq - 1) * 3 + 1, em = sm + 2
    quarters.push({ label: `Q${qq} ${yy}`, from: `${yy}-${pad(sm)}-01`, to: `${yy}-${pad(em)}-${pad(new Date(Date.UTC(yy, em, 0)).getUTCDate())}` })
  }
  return { year: y - 1, quarters: quarters.reverse() }
}
const covers = (f: CFile, from: string, to: string) => !!f.period_from && !!f.period_to && f.period_from <= from && f.period_to >= to

export interface Status { state: 'ok' | 'missing' | 'expired' | 'soon' | 'na' | 'optional' | 'marked'; text: string; files: CFile[]; missing?: string[]; mark?: Mark }
const SOON = 60
export function statusOf(t: DocType, files: CFile[], today: string, person?: Person, marks: Mark[] = []): Status {
  const s = rawStatus(t, files, today, person)
  const m = marks.find((x) => x.doc_type === t.key && x.scope === t.scope && x.staff_name === (t.scope === 'person' ? person?.name : ''))
  // a mark only covers a gap: a file on file still shows as on file
  return m && (s.state === 'missing' || s.state === 'expired' || s.state === 'soon') ? { ...s, state: 'marked', text: MARK_LABEL[m.mark], mark: m } : s
}
function rawStatus(t: DocType, files: CFile[], today: string, person?: Person): Status {
  const mine = files.filter((f) => f.doc_type === t.key && (t.scope === 'agency' ? f.scope === 'agency' : f.scope === 'person' && f.staff_name === person?.name))
  const need = t.scope === 'agency' ? t.required === true : requiredFor(t, person!)
  if (t.scope === 'person' && t.required !== false && !need) return { state: 'na', text: 'Not needed', files: mine }
  if (!need) return { state: mine.length ? 'ok' : 'optional', text: mine.length ? `${mine.length} on file` : 'Optional', files: mine }
  if (t.freq === 'expires') {
    const latest = mine.filter((f) => f.expires_on).sort((a, b) => (a.expires_on! < b.expires_on! ? 1 : -1))[0]
    if (!mine.length) return { state: 'missing', text: 'Missing', files: mine }
    if (!latest) return { state: 'ok', text: 'On file (no expiry date set)', files: mine }
    const days = Math.round((Date.parse(latest.expires_on!) - Date.parse(today)) / 86400000)
    if (days < 0) return { state: 'expired', text: `Expired ${latest.expires_on}`, files: mine }
    if (days <= SOON) return { state: 'soon', text: `Expires in ${days} days`, files: mine }
    return { state: 'ok', text: `Current to ${latest.expires_on}`, files: mine }
  }
  if (t.freq === 'yearly') {
    const { year } = duePeriods(today)
    const has = mine.some((f) => covers(f, `${year}-01-01`, `${year}-12-31`) || (f.period_from || '').startsWith(String(year)))
    return has ? { state: 'ok', text: `${year} on file`, files: mine } : { state: 'missing', text: `${year} missing`, files: mine, missing: [String(year)] }
  }
  if (t.freq === 'quarterly') {
    const gone = duePeriods(today).quarters.filter((q) => !mine.some((f) => covers(f, q.from, q.to))).map((q) => q.label)
    return gone.length ? { state: 'missing', text: `Missing ${gone.join(', ')}`, files: mine, missing: gone } : { state: 'ok', text: 'Last 4 quarters on file', files: mine }
  }
  if (t.freq === 'period') {
    if (!mine.length) return { state: 'missing', text: 'None on file', files: mine }
    const last = mine.map((f) => f.period_to || f.created_at.slice(0, 10)).sort().reverse()[0]
    return { state: 'ok', text: `${mine.length} on file · latest through ${last}`, files: mine }
  }
  return mine.length ? { state: 'ok', text: `${mine.length} on file`, files: mine } : { state: 'missing', text: 'Missing', files: mine }
}
const COMMISSION_ROLE = /producer|sdr|sales|agent|owner/i
const LICENSED_ROLE = /producer|agent|csr|service|account manager|owner|sales/i
export function requiredFor(t: DocType, p: Person) {
  switch (t.required) {
    case 'all': return true
    case 'hourly': return !!p.hourly
    case 'commission': return COMMISSION_ROLE.test(p.role || '') && !/owner/i.test(p.role || '')
    case 'licensed': return LICENSED_ROLE.test(p.role || '') && !/sdr|va|virtual/i.test(p.role || '')
    case 'leaver': return !p.active
    default: return false
  }
}

export interface Gap { who: string; type: DocType; status: Status; severity: number }
/** Everything required that is missing, expired or expiring soon — the risk gaps, most serious first. */
export function riskGaps(files: CFile[], people: Person[], today: string, marks: Mark[] = []): Gap[] {
  const out: Gap[] = []
  for (const t of TYPES.filter((x) => x.scope === 'agency' && x.required === true)) {
    const s = statusOf(t, files, today, undefined, marks)
    if (s.state === 'missing' || s.state === 'expired' || s.state === 'soon') out.push({ who: 'Agency', type: t, status: s, severity: (t.severity || 1) + (s.state === 'expired' ? 2 : s.state === 'soon' ? -1 : 0) })
  }
  for (const p of people) for (const t of TYPES.filter((x) => x.scope === 'person' && x.required !== false)) {
    // former staff: their records must still be kept, but only the ones that matter at an audit
    if (!p.active && !['i9', 'w4', 'separation', 'commission_agreement', 'wage_notice'].includes(t.key)) continue
    const s = statusOf(t, files, today, p, marks)
    if (s.state === 'missing' || s.state === 'expired' || s.state === 'soon') out.push({ who: p.name, type: t, status: s, severity: (t.severity || 1) + (s.state === 'expired' ? 2 : s.state === 'soon' ? -1 : 0) })
  }
  return out.sort((a, b) => b.severity - a.severity || a.who.localeCompare(b.who))
}

/* ---------- the audit packet: every file in folders, with an index ---------- */
export async function auditPacket(files: CFile[], agencyName: string, onProgress: (done: number, total: number) => void) {
  const w = window as any
  if (!w.JSZip) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js')
  const zip = new w.JSZip()
  const root = zip.folder(`${agencyName.replace(/[\\/:*?"<>|]+/g, '')} compliance files`)
  const rows = [['Scope', 'Employee', 'Group', 'Document', 'Period from', 'Period to', 'Expires', 'File', 'Uploaded', 'Uploaded by', 'Note']]
  const signed = new Map<string, string>()
  for (let i = 0; i < files.length; i += 100) {
    const { data } = await supabase.storage.from('documents').createSignedUrls(files.slice(i, i + 100).map((f) => f.storage_path), 600)
    ;(data || []).forEach((d: any) => d.signedUrl && signed.set(d.path, d.signedUrl))
  }
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim()
  const used = new Set<string>()
  let done = 0
  for (const f of files) {
    const t = typeOf(f.doc_type)
    const dir = f.scope === 'agency' ? `Agency legal & tax/${clean(t?.group || 'Other')}/${clean(t?.short || t?.label || f.doc_type)}` : `Employee files/${clean(f.staff_name || 'Unknown')}/${clean(t?.short || t?.label || f.doc_type)}`
    let name = `${dir}/${[f.period_from, f.period_to].filter(Boolean).join(' to ') || f.created_at.slice(0, 10)} - ${clean(f.file_name)}`
    while (used.has(name)) name = name.replace(/(\.[a-z0-9]+)?$/i, (m) => ' (2)' + m)
    used.add(name)
    const url = signed.get(f.storage_path)
    if (url) { const r = await fetch(url); if (r.ok) root.file(name, await r.blob()) }
    rows.push([f.scope === 'agency' ? 'Agency' : 'Employee', f.staff_name || '', t?.group || '', t?.label || f.doc_type, f.period_from || '', f.period_to || '', f.expires_on || '', name, f.created_at.slice(0, 10), f.uploaded_by || '', f.note || ''])
    onProgress(++done, files.length)
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  root.file('INDEX.csv', '﻿' + csv)
  const blob = await zip.generateAsync({ type: 'blob' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `compliance-files-${new Date().toISOString().slice(0, 10)}.zip`; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}
