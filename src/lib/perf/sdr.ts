// Reports › SDR Transfer: the SDR bonus figures and files, ported from engine.js (renderSdrBody, sdrDefaultMonth,
// sdrSheetRows, sdrAllRows, sdrActiveNames, sdrDownloadExcel/Csv and their all-SDR versions).
import { excelLib, save } from './commissionFiles'
import type { Json, PerfData } from './data'

export const SDR_ORDER = ['Jackeline', 'Rhon', 'Akash']
export const sdrData = (D: PerfData): Json => D.WB_EXTRA.sdr || { byMonth: {}, transfers: [] }

/** The pay period shown first: the latest month before the current one (bonuses are paid a month in arrears). */
export function sdrDefaultMonth(D: PerfData) {
  const ms = Object.keys(sdrData(D).byMonth || {}).sort(), t = new Date()
  const now = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0'), before = ms.filter((m) => m < now)
  return before.length ? before[before.length - 1] : ms[ms.length - 1]
}
export const sdrSheetRows = (D: PerfData, who: string, month: string): Json[] =>
  (sdrData(D).transfers || []).filter((t: Json) => t.sdr === who && t.month === month).slice().sort((a: Json, b: Json) => (a.dateTime < b.dateTime ? -1 : 1))
export const sdrActiveNames = (D: PerfData) => SDR_ORDER.filter((n) => (sdrData(D).activeSdrs || []).includes(n))
export function sdrAllRows(D: PerfData, month: string) {
  const out: Json[] = []
  sdrActiveNames(D).forEach((n) => sdrSheetRows(D, n, month).forEach((r) => out.push(r)))
  return out.sort((a, b) => (a.dateTime < b.dateTime ? -1 : 1))
}

const q = (v: unknown) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'
const stage = (r: Json) => (r.stage || '') + (r.status ? ' / ' + r.status : '')
const HEAD = ['Date', 'Client', 'Lead #', 'Producer', 'Lead source', 'Stage / status', 'Quotes', 'Quoted $', 'Qualified?', 'Qual. bonus', 'Bound?', 'Bound $', 'Bound bonus']
const csvRow = (r: Json, qb: number, bb: number) => [r.dateTime, r.client, r.leadId, r.producer, r.leadSource || '', stage(r),
  (r.quotes || []).map((x: Json) => x.product + ' $' + x.premium).join('; '), r.azQuotePremium || 0, r.azQualifies ? 'Yes' : 'No', r.azQualifies && !r.bound ? qb : 0,
  r.bound ? 'Yes' : 'No', r.boundPremium || 0, r.bound ? bb : 0]

export function sdrDownloadCsv(D: PerfData, who: string, month: string) {
  const meta = ((sdrData(D).byMonth || {})[month] || {}).meta || {}, qb = meta.qualifiedTransferBonus || 15, bb = meta.boundPolicyBonus || 35
  const lines = [HEAD.map(q).join(',')]
  sdrSheetRows(D, who, month).forEach((r) => lines.push(csvRow(r, qb, bb).map(q).join(',')))
  save(who + '_SDR_Commission_' + month + '.csv', new Blob([lines.join('\n')], { type: 'text/csv' }))
}
export function sdrDownloadCsvAll(D: PerfData, month: string) {
  const pm = (sdrData(D).byMonth || {})[month] || {}, meta = pm.meta || {}, qb = meta.qualifiedTransferBonus || 15, bb = meta.boundPolicyBonus || 35
  const lines = [['SDR', ...HEAD].map(q).join(',')]
  sdrAllRows(D, month).forEach((r) => lines.push([r.sdr, ...csvRow(r, qb, bb)].map(q).join(',')))
  sdrActiveNames(D).forEach((n) => lines.push(['', n + ' total bonus', '', '', '', '', '', '', '', '', '', '', '', (pm[n] || {}).totalBonus || 0].map(q).join(',')))
  save('All_SDRs_Commission_' + month + '.csv', new Blob([lines.join('\n')], { type: 'text/csv' }))
}

/** One SDR's sheet (all = false) or every active SDR on one sheet with an SDR column (all = true). */
export async function sdrDownloadExcel(D: PerfData, agency: string, month: string, who: string | null) {
  const sd = sdrData(D), pm = (sd.byMonth || {})[month] || {}, meta = pm.meta || {}
  const qb = meta.qualifiedTransferBonus || sd.qualifiedTransferBonus || 15, bb = meta.boundPolicyBonus || sd.boundPolicyBonus || 35
  let X: any
  try { X = await excelLib() } catch { alert(who ? 'The Excel writer could not be loaded (no internet?).' : 'The Excel writer could not be loaded (no internet?). Use the CSV export instead.'); return }
  const all = !who, o = all ? 1 : 0 // column offset for the SDR column
  const wb = new X.Workbook(); wb.creator = 'Declara Platform'
  const ws = wb.addWorksheet((all ? 'SDR Commission ' + (meta.periodLabel || month) : who + ' ' + (meta.periodLabel || month)).slice(0, 31))
  const DARK = 'FF1F3D2E', rows = all ? sdrAllRows(D, month) : sdrSheetRows(D, who!, month), last = all ? 'N' : 'M', nCols = 13 + o
  if (all) ws.columns = [{ width: 12 }, { width: 14 }, { width: 26 }, { width: 12 }, { width: 18 }, { width: 16 }, { width: 14 }, { width: 30 }, { width: 12 }, { width: 14 }, { width: 11 }, { width: 14 }, { width: 12 }, { width: 14 }]
  else ws.columns = [{ width: 12 }, { width: 26 }, { width: 12 }, { width: 18 }, { width: 16 }, { width: 14 }, { width: 30 }, { width: 12 }, { width: 14 }, { width: 11 }, { width: 14 }, { width: 12 }, { width: 14 }]
  ws.mergeCells('A1:' + last + '1')
  ws.getCell('A1').value = agency + ' · SDR Commission Sheet' + (all ? ' — All SDRs' : '')
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } }; ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }; ws.getRow(1).height = 24
  ws.mergeCells('A2:' + last + '2')
  ws.getCell('A2').value = (all ? 'Transfers logged ' : who + ' · transfers logged ') + (meta.periodLabel || month) + ' · paid ' + (meta.payDateLabel || '') + ' · Qualified Transfer $' + qb + ' · Bound Policy $' + bb
  ws.getCell('A2').font = { italic: true, size: 10 }
  ws.mergeCells('A3:' + last + '3')
  ws.getCell('A3').value = sd.rule || ''; ws.getCell('A3').alignment = { wrapText: true, vertical: 'top' }; ws.getCell('A3').font = { size: 9, color: { argb: 'FF555555' } }; ws.getRow(3).height = 44
  const head = ws.getRow(5)
  ;(all ? ['SDR'] : []).concat(['Date', 'Client', 'Lead #', 'Producer', 'Lead source', 'Stage / status', 'Quotes (product · premium)', 'Quoted $', 'Qualified?', 'Qual. bonus', 'Bound?', 'Bound $', 'Bound bonus']).forEach((t, i) => {
    const c = head.getCell(i + 1)
    c.value = t; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } }
    c.alignment = { horizontal: i >= 7 + o ? 'right' : 'left', vertical: 'middle', wrapText: true }
  })
  head.height = 20
  const L = (n: number) => String.fromCharCode(64 + n) // column letter
  rows.forEach((r, i) => {
    const row = ws.getRow(6 + i), n = 6 + i
    const quotes = (r.quotes || []).map((x: Json) => x.product + ' · $' + Number(x.premium || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })).join('; ')
    ;(all ? [r.sdr] : []).concat([r.dateTime, r.client, r.leadId, r.producer, r.leadSource || '', stage(r), quotes, Number(r.azQuotePremium || 0), r.azQualifies ? 'Yes' : 'No', null,
      r.bound ? 'Yes' : 'No', Number(r.boundPremium || 0), null]).forEach((v, j) => { row.getCell(j + 1).value = v })
    row.getCell(10 + o).value = { formula: 'IF(AND(' + L(9 + o) + n + '="Yes",' + L(11 + o) + n + '<>"Yes"),' + qb + ',0)' }
    row.getCell(13 + o).value = { formula: 'IF(' + L(11 + o) + n + '="Yes",' + bb + ',0)' }
    ;[8, 10, 12, 13].map((c) => c + o).forEach((c) => { row.getCell(c).numFmt = '"$"#,##0.00'; row.getCell(c).alignment = { horizontal: 'right' } })
    if (i % 2 === 1) for (let c = 1; c <= nCols; c++) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F4F0' } }
  })
  const p = 6 + Math.max(rows.length, 1) - 1, t = ws.getRow(p + 2)
  t.getCell(2 + o).value = 'TOTALS'
  t.getCell(3 + o).value = { formula: 'COUNTA(' + L(1 + o) + '6:' + L(1 + o) + p + ')' }
  t.getCell(8 + o).value = { formula: 'SUM(' + L(8 + o) + '6:' + L(8 + o) + p + ')' }
  t.getCell(9 + o).value = { formula: 'COUNTIF(' + L(9 + o) + '6:' + L(9 + o) + p + ',"Yes")' }
  t.getCell(10 + o).value = { formula: 'SUM(' + L(10 + o) + '6:' + L(10 + o) + p + ')' }
  t.getCell(11 + o).value = { formula: 'COUNTIF(' + L(11 + o) + '6:' + L(11 + o) + p + ',"Yes")' }
  t.getCell(12 + o).value = { formula: 'SUM(' + L(12 + o) + '6:' + L(12 + o) + p + ')' }
  t.getCell(13 + o).value = { formula: 'SUM(' + L(13 + o) + '6:' + L(13 + o) + p + ')' }
  for (let c = 1; c <= nCols; c++) {
    const x = t.getCell(c)
    x.font = { bold: true }; x.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBF1DD' } }
    if ([8, 10, 12, 13].map((v) => v + o).includes(c)) { x.numFmt = '"$"#,##0.00'; x.alignment = { horizontal: 'right' } }
  }
  const due = (row: any, label: string) => {
    row.getCell(2).value = label; row.getCell(2).font = { bold: true, size: 12 }
    row.getCell(3).value = { formula: L(10 + o) + (p + 2) + '+' + L(13 + o) + (p + 2) }; row.getCell(3).numFmt = '"$"#,##0.00'; row.getCell(3).font = { bold: true, size: 12, color: { argb: 'FF1F3D2E' } }
  }
  if (all) {
    let h = p + 4
    sdrActiveNames(D).forEach((n) => {
      const r = ws.getRow(h)
      r.getCell(2).value = n + ' total bonus'; r.getCell(2).font = { bold: true }
      r.getCell(3).value = Number((pm[n] || {}).totalBonus || 0); r.getCell(3).numFmt = '"$"#,##0.00'; r.getCell(3).font = { bold: true, color: { argb: 'FF1F3D2E' } }; h++
    })
    due(ws.getRow(h + 1), 'TOTAL BONUS DUE ALL SDRs ' + (meta.payDateLabel || '').toUpperCase())
    ws.getRow(h + 3).getCell(2).value = 'SDR signature: ____________________     Owner approval: ____________________     Date: ____________'
  } else {
    due(ws.getRow(p + 4), 'TOTAL BONUS DUE ' + (meta.payDateLabel || '').toUpperCase())
    ws.getRow(p + 5).getCell(2).value = 'Transfers logged: ' + rows.length + ' · Qualified: ' + rows.filter((r) => r.azQualifies).length + ' · Bound: ' + rows.filter((r) => r.bound).length +
      (meta.closed ? ' · period closed' : ' · period still open, running total')
    ws.getRow(p + 7).getCell(2).value = 'SDR signature: ____________________     Owner approval: ____________________     Date: ____________'
  }
  ws.views = [{ state: 'frozen', ySplit: 5 }]
  const buf = await wb.xlsx.writeBuffer()
  save(all ? 'All_SDRs_Commission_' + month + '.xlsx' : who + '_SDR_Commission_' + month + '.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
}
