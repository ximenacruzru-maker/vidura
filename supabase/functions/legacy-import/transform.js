// Turns the legacy dashboard's data constants into database rows.
// Plain JS so it runs unchanged in Deno (edge function) and Node (local test).

export function iso(d) {
  if (!d || typeof d !== 'string') return null
  let m = d.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` }
  return null
}
const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v))
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
function strip(o, keys) { const r = {}; for (const k of Object.keys(o || {})) if (!keys.includes(k)) r[k] = o[k]; return r }
function mimeOf(uri) { const m = /^data:([^;,]+)/.exec(uri || ''); return m ? m[1] : 'application/pdf' }
function ext(file, mime) { const m = /\.([a-z0-9]{2,4})$/i.exec(file || ''); return m ? m[1].toLowerCase() : (mime.includes('jpeg') ? 'jpg' : mime.split('/')[1] || 'bin') }

export function transform(L) {
  const accounts = [], policies = [], documents = []
  const docIds = new Set()
  function doc(d) {
    if (!d.uri || docIds.has(d.id)) return null
    docIds.add(d.id)
    const mime = mimeOf(d.uri)
    const file = d.file_name || d.title + '.' + ext('', mime)
    const row = {
      id: d.id, category: d.category, account_id: d.account_id || null, policy_number: d.policy_number || null,
      title: d.title, file_name: file, mime,
      storage_path: `${d.admin_only ? 'admin/' : ''}${d.category}/${slug(d.id)}.${ext(file, mime)}`,
      size_bytes: Math.floor((d.uri.length - d.uri.indexOf(',') - 1) * 3 / 4), admin_only: !!d.admin_only, uri: d.uri,
    }
    documents.push(row)
    return row.id
  }

  // ---------- Farmers commercial book ----------
  const polAccount = {}
  for (const c of L.DATA.farmers || []) {
    const id = 'f-' + c.id
    accounts.push({ id, book: 'farmers', name: c.name, dba: c.dba || null, contact: null, phone: null,
      address: [c.city, c.zip].filter(Boolean).join(' ') || null, producer: null,
      data: strip(c, ['policies', 'id', 'name', 'dba']) })
    for (const p of c.policies || []) {
      polAccount[p.id] = id
      policies.push({ id: 'f-' + p.id, account_id: id, book: 'farmers', policy_number: p.policyNumberFormatted || p.policyNumber || null,
        insured: p.namedInsured || p.insured || c.name, carrier: p.carrier || 'Farmers', product: p.productType || null,
        effective: iso(p.inception), expiration: iso(p.renewal), premium: num(p.annualPremium), status: p.status || 'In Force',
        location: p.premises && typeof p.premises === 'string' ? p.premises : null, data: strip(p, ['decFile']) })
      if (p.decFile && (p.decFile.dataUrl || p.decFile.url)) doc({ id: 'dec-' + p.id, category: 'dec', account_id: id,
        policy_number: p.policyNumberFormatted || p.policyNumber, title: 'Declarations — ' + (p.productType || 'policy') + ' ' + (p.policyNumber || ''),
        file_name: p.decFile.fileName, uri: p.decFile.dataUrl || p.decFile.url })
    }
  }
  for (const [k, v] of Object.entries(L.FARMERS_DECS || {})) {
    const list = Array.isArray(v) ? v : [v]
    const pol = policies.find((p) => p.id === 'f-' + k)
    list.forEach((f, i) => {
      const wc = /wc/i.test(f.label || '') || /WC-Info/i.test(f.fileName || '')
      doc({ id: 'fdec-' + k + (i ? '-' + i : ''), category: wc ? 'wc' : 'dec', account_id: polAccount[k] || null,
        policy_number: pol ? pol.policy_number : k.split('-').pop(),
        title: (wc ? 'WC information page' : 'Declarations') + ' — ' + (pol ? pol.insured : k), file_name: f.fileName, uri: f.url })
    })
  }

  // ---------- Commercial book (owner accounts with locations) ----------
  for (const c of L.DATA.commercial || []) {
    const id = 'c-' + c.id
    accounts.push({ id, book: 'commercial', name: c.name, dba: c.dba || null, contact: c.contact || null, phone: c.phone || null,
      address: null, producer: null, data: { locations: (c.locations || []).map((l) => strip(l, ['policies'])) } })
    for (const l of c.locations || []) for (const p of l.policies || []) {
      policies.push({ id: 'c-' + p.id, account_id: id, book: 'commercial', policy_number: p.policyNumber || null,
        insured: l.name, carrier: p.carrier || null, product: p.kind || p.coverageType || null,
        effective: iso(p.effective), expiration: iso(p.expiration), premium: num(p.annualPremium), status: p.paymentStatus || null,
        location: l.name + (l.address ? ' · ' + l.address : ''), data: { ...p, locationId: l.id, locationName: l.name, locationAddress: l.address } })
    }
  }

  // ---------- Brokered commercial (binders) ----------
  for (const b of L.CB_BINDERS || []) {
    const id = 'bc-' + b.id
    accounts.push({ id, book: 'brokered_commercial', name: b.name, dba: b.dba || null, contact: b.contact || null, phone: b.phone || null,
      address: b.address || null, producer: b.producer || null, data: strip(b, ['doc', 'docs', 'id', 'name', 'dba', 'contact', 'phone', 'address', 'producer']) })
    policies.push({ id: 'bc-' + b.id + '-main', account_id: id, book: 'brokered_commercial', policy_number: b.policy || null, insured: b.name,
      carrier: b.carrier || null, product: b.kind || null, effective: iso(b.start), expiration: iso(b.renewal), premium: num(b.premium),
      status: 'Bound', location: b.address || null,
      data: { broker: b.broker, naic: b.naic, best: b.best, issued: b.issued, brokerFee: b.brokerFee, tax: b.tax, policyFee: b.policyFee,
        stamping: b.stamping, total: b.total, commission: b.commission, mep: b.mep, deposit: b.deposit, auditable: b.auditable, subjectTo: b.subjectTo } })
    ;(b.other || []).forEach((o, i) => policies.push({ id: 'bc-' + b.id + '-o' + i, account_id: id, book: 'brokered_commercial',
      policy_number: o.policy || null, insured: o.named || b.name, carrier: o.carrier || null, product: o.kind || null,
      effective: iso(o.start), expiration: iso(o.renewal), premium: num(o.premium), status: 'In Force', location: o.address || null, data: o }))
    if (b.wc && b.wc.wcPolicy) policies.push({ id: 'bc-' + b.id + '-wc', account_id: id, book: 'brokered_commercial', policy_number: b.wc.wcPolicy,
      insured: b.name, carrier: b.wc.wcCarrier || null, product: 'Workers Compensation', effective: iso(b.wc.wcStart), expiration: iso(b.wc.wcEnd),
      premium: null, status: 'In Force', location: null, data: { note: b.wcNote || null } })
    if (b.doc) doc({ id: 'binder-' + b.id, category: 'binder', account_id: id, policy_number: b.policy, title: 'Binder — ' + b.name + ' ' + (b.policy || ''), file_name: b.file, uri: b.doc })
    ;(b.docs || []).forEach((d, i) => doc({ id: 'bdoc-' + b.id + '-' + (d.id || i), category: /wc/i.test(d.label || '') ? 'wc' : 'other', account_id: id,
      policy_number: null, title: d.label || d.file, file_name: d.file, uri: d.uri }))
  }

  // ---------- Brokered personal lines (Bamboo, Aegis …) ----------
  const rbAcct = {}
  for (const r of L.RB || []) {
    const key = 'bp-' + slug(r.clientKey || r.insured)
    if (!rbAcct[key]) {
      rbAcct[key] = true
      accounts.push({ id: key, book: 'brokered_personal', name: r.insured, dba: null, contact: null, phone: null,
        address: r.mailingAddress || r.riskAddress || null, producer: null, data: { account: r.account || null } })
    }
    policies.push({ id: r.id, account_id: key, book: 'brokered_personal', policy_number: r.policyNumber || null, insured: r.insured,
      carrier: r.carrier || r.broker || null, product: r.product || null, effective: iso(r.termFrom || r.effective),
      expiration: iso(r.termTo) || (iso(r.termFrom || r.effective) ? addYear(iso(r.termFrom || r.effective)) : null),
      premium: num(r.premium), status: r.status || null, location: r.riskAddress || null, data: r })
    const d = (L.RETAIL_DOCS || {})[r.id]
    if (d) doc({ id: 'rdec-' + r.id, category: 'dec', account_id: key, policy_number: r.policyNumber, title: 'Declarations — ' + r.insured + ' ' + (r.policyNumber || ''), file_name: d.fileName, uri: d.url })
  }

  // ---------- Resources & licenses ----------
  const resources = (L.RESOURCES || []).map((r) => {
    const id = doc({ id: 'res-' + r.id, category: 'resource', title: r.title, file_name: r.file, uri: r.uri })
    return { id: r.id, cat: r.cat, title: r.title, note: r.note, fillable: !!r.fillable, document_id: id }
  })
  const licenses = (L.LICENSES || []).map((l, i) => ({
    name: l.name, role: l.role || null, state: l.state || null, authority: l.authority || null, license_type: l.type || null, number: l.number || null,
    effective: iso(l.effective), expires: iso(l.expires), quals: l.quals || [], verify_url: l.verify || null,
    document_id: l.file ? doc({ id: 'lic-' + slug(l.name) + '-' + (l.number || i), category: 'license', title: 'License — ' + l.name, file_name: l.file.fileName, uri: l.file.dataUrl }) : null,
  }))

  // ---------- HR (admin only) ----------
  const hr_staff = (L.HR_STAFF || []).map((s) => ({ name: s.name, role: s.role || null, hourly: !!s.hourly, rate: num(s.rate), active: true }))
  const hr_punches = []
  for (const [name, list] of Object.entries(L.HR_PUNCHES || {})) for (const p of list)
    hr_punches.push({ name, work_date: p.date, start_time: p.start || null, end_time: p.end || null, breaks: p.breaks || [], edited: false })

  // ---------- Work queue & daily checklist (from the huddle sheet) ----------
  const H = L.HUD || {}
  const work_items = (H.aggAllRows || []).map((w) => ({ area: w.cat || 'General', name: w.name, kind: w.type || null, priority: w.pri || 'Normal',
    entered: iso(w.entered), due: iso(w.due), owner: w.who || null, status: w.st || 'Not started', note: w.note || null, source: 'Huddle sheet ' + (H.asOf || '') }))
  const checklist_items = (H.todo || []).map((t, i) => ({ area: t.cat || null, name: t.name, priority: t.pri || null, due_time: t.due || null, sort: i, active: true }))

  // ---------- Reference data ----------
  const reference = [
    { key: 'markets', data: L.MARKETS || [], admin_only: false },
    { key: 'farmers_bi', data: L.FARMERS_BI || {}, admin_only: false },
    { key: 'farmers_kb', data: L.FARMERS_KB || [], admin_only: false },
    { key: 'resources', data: resources, admin_only: false },
    { key: 'systems', data: L.SYSTEMS || [], admin_only: false },
    { key: 'protege', data: L.PROTEGE || {}, admin_only: false },
    { key: 'protege_training', data: L.PROTEGE_TRAINING || {}, admin_only: false },
  ]
  return { accounts, policies, documents, reference, licenses, hr_staff, hr_punches, work_items, checklist_items }
}
function addYear(d) { const [y, m, dd] = d.split('-'); return `${Number(y) + 1}-${m}-${dd}` }
