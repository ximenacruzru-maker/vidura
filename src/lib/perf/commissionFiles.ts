// The Commissions tab's files and statement checks, ported from engine.js: the plan in words (commPlanSummary),
// the payroll CSV, the Excel workbook with live formulas (commSheet), printable statements (commStatementHTML),
// and carrier-statement reconciliation (reconReadFile, reconParse, reconAggregate, reconMatch).
import { commFolioRows, reconNorm, reconRowId } from './commission'
import { wbFolioKeys, type Json, type PerfData } from './data'
import { wbFolioLabel } from './reports'

const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Tier buckets first, the default bucket next, flat-rate buckets last (the column order everywhere). */
export function commDisplayBuckets(plan: Json): Json[] {
  const b: Json[] = plan.buckets
  return b.filter((x) => x.rateType !== 'flat' && !x.isDefault).concat(b.filter((x) => x.rateType !== 'flat' && x.isDefault)).concat(b.filter((x) => x.rateType === 'flat'))
}

export function commPlanSummary(D: PerfData, plan: Json) {
  const M = D.COMM_METRICS || {}
  const $ = (n: number) => '$' + Math.round(n).toLocaleString('en-US'), pc = (n: number) => Math.round(n * 1e3) / 10 + '%'
  const qual = (plan.qualification.groups || []).map((g: Json[]) => g.map((c) =>
    (M[c.metric] || c.metric).replace(' (weighted)', '') + ' ' + (c.op || '>=') + ' ' + (c.metric === 'totalPremium' ? $(c.value) : c.value)).join(' AND ')).join(', OR ')
  const tiers = plan.tiers.slice().sort((a: Json, b: Json) => a.min - b.min).map((t: Json) => pc(t.rate) + ' at ' + $(t.min)).join(', ')
  const buckets = commDisplayBuckets(plan).map((b) => b.rateType === 'flat' ? pc(b.flatRate) + ' flat on ' + b.label
    : ((Number(b.multiplier) || 0) === 1 ? 'full tier rate on ' : (Number(b.multiplier) || 0) === 0.5 ? 'half tier rate on ' : pc(b.multiplier) + ' of tier on ') + b.label).join(', ')
  const bonuses = (plan.bonuses || []).map((b: Json) => '+' + pc(b.rate) + ' ' + b.label.toLowerCase() + ' over ' + $(b.threshold)).join(', ')
  return 'Per the ' + plan.name + ': qualify with ' + qual + '. Tier by ' + (M[plan.tierBasis] || plan.tierBasis).toLowerCase() + ' (' + tiers + '). ' +
    buckets.charAt(0).toUpperCase() + buckets.slice(1) + (bonuses ? ', ' + bonuses : '') + '.'
}

export function save(name: string, blob: Blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

/** Payroll CSV for a folio (engine.js downloadCommissionPayrollCSV). */
export function downloadCommissionCsv(D: PerfData, k: string, agencyShort: string) {
  const rows = Object.entries((D.WB_DATA.commissionsByFolio || {})[k] || {}).sort((a: any, b: any) => b[1].totalCommission - a[1].totalCommission) as [string, Json][]
  const q = (v: unknown) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
  const sum = (f: (x: Json) => number) => rows.reduce((t, [, x]) => t + f(x), 0)
  const body = rows.map(([p, x]) => [p, x.totalPremium.toFixed(2), x.lifePolicies, x.qualifies ? 'Yes' : 'No', (x.tierRate * 100).toFixed(0) + '%', x.farmersForemostPrem.toFixed(2),
    x.otherPrem.toFixed(2), x.brokerFeePrem.toFixed(2), x.commFarmersForemost.toFixed(2), x.commOther.toFixed(2), x.commBrokerFee.toFixed(2), x.acceleratorBonus.toFixed(2), x.totalCommission.toFixed(2)])
  const total = ['TOTAL', sum((x) => x.totalPremium).toFixed(2), sum((x) => x.lifePolicies), '', '', sum((x) => x.farmersForemostPrem).toFixed(2), sum((x) => x.otherPrem).toFixed(2),
    sum((x) => x.brokerFeePrem).toFixed(2), sum((x) => x.commFarmersForemost).toFixed(2), sum((x) => x.commOther).toFixed(2), sum((x) => x.commBrokerFee).toFixed(2),
    sum((x) => x.acceleratorBonus).toFixed(2), sum((x) => x.totalCommission).toFixed(2)]
  const csv = [['Producer', 'Total Premium', 'Life Policies', 'Qualifies?', 'Tier Rate', 'Farmers/Foremost Premium', 'Other Premium', 'Broker Fee Premium', 'Comm F/F', 'Comm Other',
    'Comm Broker Fee', 'Accelerator', 'Total Commission'], ...body, total].map((r) => r.map(q).join(',')).join('\r\n')
  save(agencyShort.replace(/[^A-Za-z0-9]+/g, '_') + '_Commissions_' + k + '.csv', new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
}

/* ---------- Excel (ExcelJS, loaded on demand as the original did) ---------- */
export function loadScript(src: string) {
  return new Promise<void>((ok, bad) => {
    if (document.querySelector('script[src="' + src + '"]')) { ok(); return }
    const s = document.createElement('script'); s.src = src; s.onload = () => ok(); s.onerror = () => bad(new Error('Could not load ' + src)); document.head.appendChild(s)
  })
}
export async function excelLib(): Promise<any> {
  const w = window as any
  if (!w.ExcelJS) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js')
  return w.ExcelJS
}
function commSumLabels(b: Json): string[] {
  const c: string[] = (b.carriers || []).filter((x: string, i: number, a: string[]) => !a.slice(0, i).some((y) => x.toLowerCase().indexOf(y.toLowerCase()) >= 0))
  return (b.lines || []).length || !c.length ? c.concat([b.label]) : c
}
function commRowLabel(plan: Json, r: Json) {
  const b = plan.buckets.find((x: Json) => x.key === r.bucket) || {}
  return (b.carriers || []).find((c: string) => String(r.carrier || '').toLowerCase().indexOf(c.toLowerCase()) >= 0) || b.label || r.carrier
}

/** One producer's sheet: the folio's sales, then the calculation as live Excel formulas over them. */
function commSheet(D: PerfData, wb: any, plan: Json, k: string, who: string, res: Json) {
  const DARK = 'FF1F3D2E', CREAM = 'FFFBF1DD', cur = k === wbFolioKeys(D)[0]
  const ws = wb.addWorksheet((who.split(' ')[0] + ' - ' + (cur ? 'Current' : 'Last') + ' Folio Commission').slice(0, 31))
  ws.columns = [{ width: 34 }, { width: 16 }, { width: 22 }, { width: 14 }, { width: 12 }, { width: 10 }]
  ws.mergeCells('A1:F2')
  const h = ws.getCell('A1')
  h.value = who.toUpperCase() + ' — COMMISSION'; h.font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } }; h.alignment = { horizontal: 'left', vertical: 'middle' }
  ;['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'A2', 'B2', 'C2', 'D2', 'E2', 'F2'].forEach((c) => { ws.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } } })
  ws.getRow(1).height = 21.75; ws.getRow(2).height = 21.75
  const f = D.WB_DATA.folio[k]
  ws.getCell('A4').value = 'Folio: ' + f.label.replace(' (in progress)', '') + (cur ? ' (Current Folio)' : ' (Last Folio)')
  ws.getCell('A4').font = { bold: true, size: 13, color: { argb: DARK } }
  ws.mergeCells('A6:F6')
  ws.getCell('A6').value = commPlanSummary(D, plan); ws.getCell('A6').font = { italic: true, size: 9, color: { argb: 'FF6B7268' } }
  ws.getCell('A6').alignment = { wrapText: true, vertical: 'top' }; ws.getRow(6).height = 39.75
  ws.getCell('A8').value = 'Sales Detail — This Folio'; ws.getCell('A8').font = { bold: true, size: 13, color: { argb: DARK } }
  ;['Customer', 'Carrier', 'Policy Type', 'Premium', 'Confirmed'].forEach((t, i) => {
    const c = ws.getCell(9, i + 1)
    c.value = t; c.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }
    c.alignment = { horizontal: 'center', wrapText: true }; c.border = { bottom: { style: 'thin' } }
  })
  const rows = res.rows.slice().sort((a: Json, b: Json) => (b.premium || 0) - (a.premium || 0)), first = 10, last = first + Math.max(rows.length, 1) - 1
  rows.forEach((r: Json, i: number) => {
    const n = first + i
    ;[r.client, commRowLabel(plan, r), r.line, Number(r.premium) || 0, r.confirmed === false ? 'No' : 'Yes'].forEach((v, j) => {
      const c = ws.getCell(n, j + 1)
      c.value = v; c.font = { size: 11 }
      if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F4F0' } }
      if (j === 3) c.numFmt = '"$"#,##0.00'
    })
    ws.getRow(n).height = 15.75
  })
  if (!rows.length) { ws.getCell(first, 1).value = 'No confirmed sales this folio'; ws.getCell(first, 4).value = 0; ws.getCell(first, 4).numFmt = '"$"#,##0.00' }
  const tot = last + 1
  ws.getCell(tot, 1).value = 'TOTAL'
  for (let j = 1; j <= 5; j++) { const c = ws.getCell(tot, j); c.font = { bold: true, size: 11 }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CREAM } } }
  ws.getCell(tot, 4).value = { formula: 'SUM(D10:D' + last + ')' }; ws.getCell(tot, 4).numFmt = '"$"#,##0.00'; ws.getRow(tot).height = 15.75
  const prem = 'D10:D' + last, car = 'B10:B' + last, line = 'C10:C' + last
  let g = tot + 3
  ws.getCell(g, 1).value = 'Commission Calculation'; ws.getCell(g, 1).font = { bold: true, size: 13, color: { argb: DARK } }; g++
  const ref: Record<string, string> = {}
  const label = (n: number, t: string, bold?: boolean) => { ws.getCell(n, 1).value = t; ws.getCell(n, 1).font = { bold: bold !== false, size: 11 } }
  const money = (n: number, v: string | number) => { const c = ws.getCell(n, 2); c.value = typeof v === 'string' ? { formula: v } : v; c.numFmt = '"$"#,##0.00'; c.font = { size: 11 } }
  const bks = commDisplayBuckets(plan)
  bks.forEach((b) => {
    const parts = [...new Set(commSumLabels(b))].map((l) => 'SUMIFS(' + prem + ',' + car + ',"' + l.replace(/"/g, '""') + '")')
    label(g, b.label + ' Premium'); money(g, parts.join('+')); ref['bucket:' + b.key] = 'B' + g; g++
  })
  {
    const parts = (plan.lifeRules || []).map((r: Json) => (Number(r.weight) || 1) === 1 ? 'COUNTIF(' + line + ',"*' + r.match + '*")' : (Number(r.weight) || 1) + '*COUNTIF(' + line + ',"*' + r.match + '*")')
    label(g, 'Life Policies'); ws.getCell(g, 2).value = parts.length ? { formula: parts.join('+') } : 0; ws.getCell(g, 2).font = { size: 11 }; ref.life = 'B' + g; g++
  }
  {
    label(g, 'TOTAL PREMIUM'); ws.getCell(g, 1).font = { bold: true, size: 11, color: { argb: DARK } }
    const c = ws.getCell(g, 2)
    c.value = { formula: bks.map((b) => ref['bucket:' + b.key]).join('+') }; c.numFmt = '"$"#,##0.00'; c.font = { bold: true, size: 13 }
    ;[1, 2].forEach((j) => { ws.getCell(g, j).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CREAM } } })
    ref.totalPremium = 'B' + g; ref.policies = 'COUNTA(A10:A' + last + ')'; g += 2
  }
  const m = (x: string) => ref[x] || '0'
  {
    const groups = (plan.qualification.groups || []).map((gr: Json[]) => { const t = gr.map((c) => m(c.metric) + (c.op || '>=') + (Number(c.value) || 0)); return t.length > 1 ? 'AND(' + t.join(',') + ')' : t[0] })
    const cond = groups.length > 1 ? 'OR(' + groups.join(',') + ')' : groups[0] || 'TRUE'
    label(g, 'Qualifies?'); ws.getCell(g, 2).value = { formula: 'IF(' + cond + ',"Yes","No")' }; ref.qual = 'B' + g; g++
  }
  {
    const t = plan.tiers.slice().sort((a: Json, b: Json) => b.min - a.min)
    let f2 = '0'
    for (let i = t.length - 1; i >= 0; i--) f2 = 'IF(' + m(plan.tierBasis || 'totalPremium') + '>=' + t[i].min + ',' + t[i].rate + ',' + f2 + ')'
    label(g, 'Tier Rate')
    const c = ws.getCell(g, 2); c.value = { formula: 'IF(' + ref.qual + '="No",0,' + f2 + ')' }; c.numFmt = '0%'; c.font = { size: 11 }; ref.tier = 'B' + g; g += 2
  }
  const parts: string[] = []
  bks.forEach((b) => {
    const how = b.rateType === 'flat' ? Math.round(b.flatRate * 1e3) / 10 + '% flat' : (Number(b.multiplier) || 0) === 1 ? 'full tier' : (Number(b.multiplier) || 0) === 0.5 ? 'half tier' : Math.round(b.multiplier * 100) + '% of tier'
    label(g, 'Commission — ' + b.label + ' (' + how + ')', false)
    const s = m('bucket:' + b.key)
    const f3 = b.rateType === 'flat' ? (b.requiresQualify ? 'IF(' + ref.qual + '="Yes",' + s + '*' + b.flatRate + ',0)' : s + '*' + b.flatRate)
      : Number(b.multiplier) === 1 ? s + '*' + ref.tier : s + '*(' + ref.tier + '*' + b.multiplier + ')'
    money(g, f3); parts.push('B' + g); g++
  })
  ;(plan.bonuses || []).forEach((bn: Json) => {
    label(g, bn.label + ' Bonus (+' + Math.round(bn.rate * 1e3) / 10 + '% over $' + Math.round(bn.threshold / 1e3) + 'K)', false)
    const basis = m(bn.basis || 'totalPremium'), cond = (bn.requiresQualify ? 'AND(' + ref.qual + '="Yes",' : 'AND(TRUE,') + basis + '>=' + bn.threshold + ')'
    money(g, 'IF(' + cond + ',' + basis + '*' + bn.rate + ',0)'); parts.push('B' + g); g++
  })
  g++
  label(g, 'TOTAL COMMISSION'); ws.getCell(g, 1).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
  const T = ws.getCell(g, 2)
  T.value = { formula: parts.join('+') + (res.splitShare && res.splitShare !== 1 ? '*' + res.splitShare : '') }; T.numFmt = '"$"#,##0.00'; T.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }
  ;[1, 2].forEach((j) => { ws.getCell(g, j).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } } })
  ws.getRow(g).height = 24
  const excluded = commFolioRows(D, k).filter((r) => r.confirmed === false && r.producer === who)
  if (excluded.length) {
    g += 2
    ws.getCell(g, 1).value = 'Excluded — not paid on carrier statement'; ws.getCell(g, 1).font = { bold: true, size: 11, color: { argb: 'FFB3261E' } }; g++
    excluded.forEach((r) => {
      ws.getCell(g, 1).value = r.client; ws.getCell(g, 2).value = r.carrier; ws.getCell(g, 3).value = r.line
      ws.getCell(g, 4).value = Number(r.premium) || 0; ws.getCell(g, 4).numFmt = '"$"#,##0.00'; ws.getCell(g, 5).value = 'No'
      ;[1, 2, 3, 4, 5].forEach((j) => { ws.getCell(g, j).font = { size: 10, color: { argb: 'FF8A1C24' } } }); g++
    })
  }
  g += 2
  ws.getCell(g, 1).value = 'Calculated under ' + plan.name + ' (v' + plan.version + ', effective ' + plan.effectiveFrom + '). Generated ' + new Date().toLocaleDateString('en-US') + ' by Declara Platform.'
  ws.getCell(g, 1).font = { italic: true, size: 9, color: { argb: 'FF6B7268' } }
}

/** The Excel workbook: one sheet per producer, or just the one asked for. */
export async function downloadCommissionExcel(D: PerfData, k: string, who?: string) {
  const r = D.COMM_RESULTS[k]
  if (!r) { alert('No sales detail for that folio.'); return }
  let X: any
  try { X = await excelLib() } catch { alert('The Excel writer could not be loaded (no internet?). Use the CSV export instead.'); return }
  const wb = new X.Workbook(); wb.creator = 'Declara Platform'
  const names = who ? [who] : Object.keys(r.results).sort((a, b) => r.results[b].total - r.results[a].total)
  names.forEach((n) => commSheet(D, wb, r.plan, k, n, r.results[n]))
  const buf = await wb.xlsx.writeBuffer()
  save((who ? who.replace(/\s+/g, '_') : 'All_Producers') + '_' + (k === wbFolioKeys(D)[0] ? 'Current' : 'Last') + '_Folio_Commission_' + k + '.xlsx',
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
}

/* ---------- printable statements ---------- */
const STATEMENT_CSS = `body{font-family:Inter,system-ui,sans-serif;margin:24px;--ink:#0B1B3F;--muted:#6B7280;color:var(--ink)}
.an-eye{font-size:10px;font-weight:900;letter-spacing:1.4px;color:#5976d5;margin:0}
.an-period{margin:0;color:#3d62d4;font-size:14px;font-weight:700}
.an-meta{text-align:right;font-size:11px;color:var(--muted);line-height:1.7}.an-meta b{color:var(--ink)}
.an-t{width:100%;border-collapse:collapse;font-size:11.5px}
.an-t th{text-align:left;background:#edf6ff;color:#4662cd;padding:7px 8px;font-size:10px;letter-spacing:.04em;text-transform:uppercase}
.an-t td{padding:7px 8px;border-bottom:1px solid #e2eaf5}.an-t .tr{text-align:right;font-variant-numeric:tabular-nums}.an-t td:first-child{font-weight:700}
.an-fn{font-size:11px;color:#6980c5;margin:8px 0 0;line-height:1.5}
.cst{color:var(--ink);font-size:12px;padding:0 0 20px}
.cst-h{display:flex;justify-content:space-between;gap:20px;padding-bottom:14px;border-bottom:3px solid #1F3D2E;margin-bottom:14px}
.cst h1{font-size:26px;margin:4px 0 2px;letter-spacing:-.8px}.cst h2{font-size:14px;margin:16px 0 6px}
.cst-plan{font-size:11px;font-style:italic;color:#6B7268;line-height:1.5;margin:0 0 6px}
.cst-tot td{font-weight:800;background:#FBF1DD}.cst-grand td{font-weight:900;font-size:14px;background:#1F3D2E;color:#fff}
.cst-calc td:first-child{width:70%}.cst-break{break-after:page;page-break-after:always}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}`

export function commStatementHTML(D: PerfData, k: string, who: string, agency: string) {
  const r = D.COMM_RESULTS[k], x = r.results[who], plan = r.plan, f = D.WB_DATA.folio[k]
  const m = (n: number) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const rows = x.rows.slice().sort((a: Json, b: Json) => (b.premium || 0) - (a.premium || 0))
  const bks = commDisplayBuckets(plan)
  const how = (b: Json) => b.rateType === 'flat' ? 100 * b.flatRate + '% flat' : Number(b.multiplier) === 1 ? 'full tier' : Number(b.multiplier) === 0.5 ? 'half tier' : 100 * b.multiplier + '% of tier'
  return '<div class="cst"><div class="cst-h"><div><p class="an-eye">' + esc(agency.toUpperCase()) + ' · COMMISSION STATEMENT</p><h1>' + esc(who) + '</h1><p class="an-period">' +
    esc(f.label.replace(' (in progress)', '')) + (k === wbFolioKeys(D)[0] ? ' · current folio (running)' : ' · closed folio') + '</p></div><div class="an-meta"><div>Plan <b>' + esc(plan.name) +
    '</b> v' + plan.version + '</div><div>Effective ' + esc(plan.effectiveFrom) + '</div><div>Generated ' + new Date().toLocaleDateString('en-US') + '</div></div></div><p class="cst-plan">' +
    esc(commPlanSummary(D, plan)) + '</p><h2>Sales detail — this folio</h2><table class="an-t"><thead><tr><th>Customer</th><th>Carrier</th><th>Policy type</th><th class="tr">Premium</th><th>Bucket</th></tr></thead><tbody>' +
    rows.map((s: Json) => '<tr><td>' + esc(s.client) + '</td><td>' + esc(s.carrier) + '</td><td>' + esc(s.line) + '</td><td class="tr">' + m(s.premium) + '</td><td>' + esc(s.bucketLabel) + '</td></tr>').join('') +
    '<tr class="cst-tot"><td>TOTAL</td><td></td><td></td><td class="tr">' + m(x.totalPremium) + '</td><td>' + x.policies + ' policies</td></tr></tbody></table><h2>Commission calculation</h2><table class="an-t cst-calc"><tbody>' +
    bks.map((b) => '<tr><td>' + esc(b.label) + ' premium</td><td class="tr">' + m(x.buckets[b.key].premium) + '</td></tr>').join('') +
    '<tr><td>Life policies (weighted)</td><td class="tr">' + x.life + '</td></tr><tr class="cst-tot"><td>TOTAL PREMIUM</td><td class="tr">' + m(x.totalPremium) +
    '</td></tr><tr><td>Qualifies?</td><td class="tr">' + (x.qualifies ? 'Yes' : 'No') + '</td></tr><tr><td>Tier rate</td><td class="tr">' + (100 * x.tierRate).toFixed(1) + '%</td></tr>' +
    bks.map((b) => '<tr><td>Commission — ' + esc(b.label) + ' (' + how(b) + ')</td><td class="tr">' + m(x.buckets[b.key].commission) + '</td></tr>').join('') +
    (plan.bonuses || []).map((b: Json) => '<tr><td>' + esc(b.label) + ' bonus (+' + 100 * b.rate + '% over $' + Math.round(b.threshold / 1e3) + 'K)</td><td class="tr">' + m(x.bonuses[b.key] || 0) + '</td></tr>').join('') +
    (x.splitShare && x.splitShare !== 1 ? '<tr><td>Split share</td><td class="tr">' + 100 * x.splitShare + '%</td></tr>' : '') +
    '<tr class="cst-grand"><td>TOTAL COMMISSION</td><td class="tr">' + m(x.total) + '</td></tr></tbody></table>' +
    ((plan.exceptions || []).length ? '<p class="an-fn">Exceptions: ' + plan.exceptions.map(esc).join(' · ') + '</p>' : '') + '</div>'
}

/** Prints the statements (one per producer, a page each) from a hidden frame, so the page itself stays as it is. */
export function printCommissionStatements(D: PerfData, k: string, agency: string, who?: string) {
  const r = D.COMM_RESULTS[k]
  if (!r) return
  const names = who ? [who] : Object.keys(r.results)
  const html = names.map((n) => commStatementHTML(D, k, n, agency)).join('<div class="cst-break"></div>')
  const fr = document.createElement('iframe')
  fr.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'
  document.body.appendChild(fr)
  const d = fr.contentDocument!
  d.open(); d.write('<!doctype html><html><head><meta charset="utf-8"><title>Commission statements · ' + esc(wbFolioLabel(D, k)) + '</title><style>' + STATEMENT_CSS + '</style></head><body>' + html + '</body></html>'); d.close()
  setTimeout(() => { fr.contentWindow!.focus(); fr.contentWindow!.print(); setTimeout(() => fr.remove(), 1000) }, 80)
}

/* ---------- carrier statement reconciliation ---------- */
async function pdfText(file: File) {
  const w = window as any
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js')
  w.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  const doc = await w.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise
  let text = ''
  for (let i = 1; i <= doc.numPages; i++) text += (await (await doc.getPage(i)).getTextContent()).items.map((x: Json) => x.str).join(' ') + '\n'
  return text
}
type Read = { kind: 'pdf'; lines: string[] } | { kind: 'table'; rows: unknown[][] }
export async function reconReadFile(file: File): Promise<Read> {
  const n = file.name.toLowerCase()
  if (/\.pdf$/.test(n)) return { kind: 'pdf', lines: (await pdfText(file)).split(/\n|(?<=\d)\s{2,}/).map((l) => l.trim()).filter(Boolean) }
  if (/\.xlsx$|\.xlsm$|\.xls$/.test(n)) {
    const wb = new (await excelLib()).Workbook()
    await wb.xlsx.load(await file.arrayBuffer())
    const rows: unknown[][] = []
    wb.worksheets.forEach((ws: any) => ws.eachRow((row: any) => rows.push(row.values.slice(1).map((v: any) => (v && v.result !== undefined ? v.result : v && v.text ? v.text : v)))))
    return { kind: 'table', rows }
  }
  return { kind: 'table', rows: (await file.text()).split(/\r?\n/).filter((l) => l.trim()).map((l) => {
    const out: string[] = []; let cur = '', q = false
    for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = '' } else cur += ch }
    out.push(cur); return out.map((x) => x.trim())
  }) }
}
export function reconParse(f: Read) {
  const out: Json[] = []
  const num = (v: unknown) => {
    if (!String(v == null ? '' : v).replace(/[$,\s]/g, '').match(/^\(?-?[\d.]+\)?$/)) return null
    const t = String(v).replace(/[$,\s]/g, '')
    return t.startsWith('(') ? -Number(t.replace(/[()]/g, '')) : Number(t)
  }
  if (f.kind === 'table') {
    const rows = f.rows
    if (!rows.length) return out
    let h = rows.findIndex((r) => r.some((c) => /policy|insured|premium|commission/i.test(String(c))))
    if (h < 0) h = 0
    const head = rows[h].map((c) => String(c || '').toLowerCase()), col = (re: RegExp) => head.findIndex((c) => re.test(c))
    const pol = col(/policy|pol\s*#|contract/), ins = col(/insured|customer|client|name/), prem = col(/premium|amount paid|gross/), comm = col(/commission|comm\b|net/)
    const st = col(/status|transaction|trans\s*type|type|reason|activity/), dt = col(/date|eff/)
    rows.slice(h + 1).forEach((r) => {
      if (!r.some((c) => c != null && String(c).trim())) return
      const x = { policy: pol >= 0 ? String(r[pol] || '') : '', insured: ins >= 0 ? String(r[ins] || '') : '', premium: prem >= 0 ? num(r[prem]) : null,
        commission: comm >= 0 ? num(r[comm]) : null, status: st >= 0 ? String(r[st] || '') : '', date: dt >= 0 ? String(r[dt] || '') : '', raw: r.join(' | ') }
      if (x.insured || x.policy) out.push(x)
    })
    return out
  }
  f.lines.forEach((l) => {
    const pol = (l.match(/\b[A-Z]?\d{6,12}[A-Z]?\b/) || [])[0]
    const amts = [...l.matchAll(/\(?-?\$?\s?[\d,]+\.\d{2}\)?/g)].map((m) => num(m[0])).filter((v) => v != null) as number[]
    if (!pol && amts.length < 1) return
    const st = (l.match(/cancel\w*|charge\s?back|reinstat\w*|new business|renewal|endorse\w*|flat cancel|rewrite|non-?renew\w*|return premium|reversal/i) || [''])[0]
    const ins = l.replace(/\(?-?\$?\s?[\d,]+\.\d{2}\)?/g, '').replace(/\b[A-Z]?\d{6,12}[A-Z]?\b/, '').replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, '')
      .replace(new RegExp(st || '§', 'i'), '').replace(/\s+/g, ' ').trim()
    out.push({ policy: pol || '', insured: ins, premium: amts.length ? amts[0] : null, commission: amts.length > 1 ? amts[amts.length - 1] : null, status: st,
      date: (l.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/) || [''])[0], raw: l })
  })
  return out
}
/** Statement lines folded to one entry per policy (or insured), netting cancellations and chargebacks. */
export function reconAggregate(rows: Json[]) {
  const by: Record<string, Json> = {}
  rows.forEach((r) => {
    const key = r.policy && r.policy.length >= 6 ? 'p:' + r.policy.toLowerCase() : 'n:' + reconNorm(r.insured)
    const a = (by[key] = by[key] || { policy: r.policy, insured: r.insured, premium: 0, commission: 0, hasPrem: false, hasComm: false, statuses: [], rows: 0, cancel: false })
    if (r.premium != null) { a.premium += r.premium; a.hasPrem = true }
    if (r.commission != null) { a.commission += r.commission; a.hasComm = true }
    if (r.status) a.statuses.push(r.status)
    a.rows++
    if (/cancel|charge\s?back|reversal|return premium|flat/i.test(r.status || '') || (r.commission != null && r.commission < 0) || (r.premium != null && r.premium < 0)) a.cancel = true
    if (!a.insured && r.insured) a.insured = r.insured
  })
  return Object.values(by).map((a) => ({
    policy: a.policy, insured: a.insured, premium: a.hasPrem ? a.premium : null, grossPremium: a.hasPrem ? Math.max(a.premium) : null, commission: a.hasComm ? a.commission : null,
    status: a.cancel ? (a.statuses.find((s: string) => /cancel|charge|reversal|return|flat/i.test(s)) || 'Cancelled') + (a.rows > 1 ? ' (net of ' + a.rows + ' rows)' : '') : a.statuses[0] || '',
    rows: a.rows, cancel: a.cancel, raw: '',
  }))
}
const tokens = (s: string) => new Set(reconNorm(s).split(' ').filter((t) => t.length > 1))
function sim(a: string, b: string) {
  const x = tokens(a), y = tokens(b)
  if (!x.size || !y.size) return 0
  let n = 0; x.forEach((t) => { if (y.has(t)) n++ })
  return n / Math.max(x.size, y.size)
}
function classify(s: Json) {
  const st = String(s.status || '').toLowerCase()
  const neg = (s.commission != null && s.commission <= 0.005 && s.rows > 1) || (s.premium != null && s.premium <= 0.005 && s.rows > 1) || (s.commission != null && s.commission < 0) || (s.premium != null && s.premium < 0)
  return s.cancel || /cancel|charge\s?back|reversal|return premium|flat/.test(st) || neg ? 'cancelled' : /non-?renew/.test(st) ? 'nonrenewal' : 'paid'
}
/** Every AgencyZoom sale of the folio against the statement: matched, flagged by the carrier, or missing. */
export function reconMatch(D: PerfData, k: string, stmt: Json[]) {
  const used = new Set<number>(), results: Json[] = []
  commFolioRows(D, k).forEach((r) => {
    let best: number | null = null, score = 0
    stmt.forEach((s, i) => {
      if (used.has(i)) return
      let sc = sim(r.client, s.insured)
      const p = s.premium != null && Math.abs(s.premium) > 0.005 ? Math.abs(s.premium) : null
      if (p != null && r.premium && Math.abs(p - r.premium) / Math.max(r.premium, 1) < 0.05) sc += 0.35
      if (sc > score) { score = sc; best = i }
    })
    const id = reconRowId(r)
    if (best != null && score >= 0.55) {
      used.add(best)
      const s = stmt[best], c = classify(s)
      results.push({ id, row: r, stmt: s, score, state: c === 'paid' ? 'matched' : c, suggest: c === 'paid' ? 'include' : 'exclude' })
    } else results.push({ id, row: r, stmt: null, score: 0, state: 'missing', suggest: 'review' })
  })
  return { results, extra: stmt.filter((_, i) => !used.has(i)) }
}
