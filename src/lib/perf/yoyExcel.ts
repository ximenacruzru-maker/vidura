// The "This year vs last year" breakdown as a colour-coded Excel workbook: a summary sheet (totals, by producer, line
// and carrier, each year against the other with gains in green and drops in red) and one sheet of sold policies per
// year, each producer in their own colour, new customers in green and policies cancelled since in red.
import { excelLib, save } from './commissionFiles'
import type { Drill, Group, MonthRow, SoldPolicy, Sum } from './yoy'

const DARK = 'FF1F3D2E', WHITE = 'FFFFFFFF', MUTED = 'FF666666'
const GREEN = 'FF1F7A57', GREEN_BG = 'FFE3F4EC', RED = 'FFA83E4B', RED_BG = 'FFF9E3E6', TOTAL_BG = 'FFFBF1DD', BAND = 'FFF6F7F5'
/** One soft fill per producer, in the order they rank. */
const PRODUCER_FILLS = ['FFDCE6FF', 'FFFDE7C8', 'FFDDF3E4', 'FFF3DDF3', 'FFDDF1F5', 'FFFBE0D6', 'FFE8E4F8', 'FFEFF3D6', 'FFF5E1E9', 'FFE2ECE9']
const MONEY = '"$"#,##0', MONEY2 = '"$"#,##0.00'
const fill = (argb: string) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const azUrl = (cid: string) => `https://app.agencyzoom.com/customer/index?id=${encodeURIComponent(cid)}`

/** months: when given (the whole-year download), a month-by-month sheet is added after the summary. */
export async function downloadYoyExcel(d: Drill, year: number, lists: { now: SoldPolicy[] | null; prior: SoldPolicy[] }, who: string | null, months?: MonthRow[]) {
  const ExcelJS = await excelLib()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Declara'
  const colour = new Map(d.byProducer.map((g, i) => [g.key, PRODUCER_FILLS[i % PRODUCER_FILLS.length]]))
  summary(wb.addWorksheet('Summary', { views: [{ showGridLines: false }] }), d, year, who, colour)
  if (months) byMonth(wb.addWorksheet('By month', { views: [{ showGridLines: false }] }), months, year, who)
  if (lists.now) policies(wb, `${year} policies`, lists.now, colour)
  policies(wb, `${year - 1} policies`, lists.prior, colour)
  const buf = await wb.xlsx.writeBuffer()
  const slug = (s: string) => s.replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  save(`sold-policies-${slug(d.label)}${who ? '-' + slug(who) : ''}.xlsx`, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
}

function title(ws: any, text: string, sub: string, cols: number) {
  const last = String.fromCharCode(64 + cols)
  ws.mergeCells(`A1:${last}1`); ws.mergeCells(`A2:${last}2`)
  const a = ws.getCell('A1'); a.value = text; a.font = { bold: true, size: 14, color: { argb: WHITE } }; a.fill = fill(DARK); a.alignment = { vertical: 'middle', indent: 1 }
  ws.getRow(1).height = 26
  const b = ws.getCell('A2'); b.value = sub; b.font = { italic: true, size: 10, color: { argb: MUTED } }; b.alignment = { indent: 1 }
}

function header(row: any, labels: string[], rightFrom: number) {
  labels.forEach((t, i) => {
    const c = row.getCell(i + 1)
    c.value = t; c.font = { bold: true, color: { argb: WHITE } }; c.fill = fill(DARK)
    c.alignment = { horizontal: i >= rightFrom ? 'right' : 'left', vertical: 'middle' }
  })
  row.height = 20
}

/** Change from last year as a fraction (0.25 = +25%), or null when last year had nothing. */
const pct = (now: number, prior: number) => (prior ? (now - prior) / prior : null)
function changeCell(c: any, now: number, prior: number) {
  const p = pct(now, prior)
  if (p == null) { c.value = now ? 'new' : '—'; c.alignment = { horizontal: 'right' }; if (now) c.font = { bold: true, color: { argb: GREEN } }; return }
  c.value = p; c.numFmt = '+0.0%;-0.0%;0.0%'; c.alignment = { horizontal: 'right' }
  c.font = { bold: true, color: { argb: p >= 0 ? GREEN : RED } }; c.fill = fill(p >= 0 ? GREEN_BG : RED_BG)
}

function summary(ws: any, d: Drill, year: number, who: string | null, colour: Map<string, string>) {
  ws.columns = [{ width: 30 }, { width: 16 }, { width: 16 }, { width: 12 }, { width: 11 }, { width: 11 }]
  title(ws, `${d.label}: what was sold`, d.range + (who ? ' · ' + who : ''), 6)
  const N = d.now, P = d.prior
  let r = 4
  header(ws.getRow(r++), ['', String(year), String(year - 1), 'Change', '', ''], 1)
  const avg = (s: Sum) => (s.policies ? s.premium / s.policies : 0)
  const lines: [string, number | null, number, string][] = [
    ['Premium', N?.sum.premium ?? null, P.sum.premium, MONEY],
    ['Policies', N?.sum.policies ?? null, P.sum.policies, '#,##0'],
    ['Average premium', N ? avg(N.sum) : null, avg(P.sum), MONEY],
    ['Customers', N?.customers ?? null, P.customers, '#,##0'],
    ['New customers: premium', N?.fresh.premium ?? null, P.fresh.premium, MONEY],
    ['New customers: policies', N?.fresh.policies ?? null, P.fresh.policies, '#,##0'],
    ['Added to existing: premium', N?.added.premium ?? null, P.added.premium, MONEY],
    ['Added to existing: policies', N?.added.policies ?? null, P.added.policies, '#,##0'],
    ['Cancelled since: premium', N?.cancelled.premium ?? null, P.cancelled.premium, MONEY],
    ['Cancelled since: policies', N?.cancelled.policies ?? null, P.cancelled.policies, '#,##0'],
  ]
  lines.forEach(([label, now, prior, fmt], i) => {
    const row = ws.getRow(r++)
    row.getCell(1).value = label; row.getCell(1).font = { bold: true }
    const a = row.getCell(2), b = row.getCell(3)
    a.value = now ?? '—'; b.value = prior; a.numFmt = b.numFmt = fmt; a.alignment = b.alignment = { horizontal: 'right' }
    // more cancelled is worse, so its change is left uncoloured rather than shown as a gain
    if (now != null && !label.startsWith('Cancelled')) changeCell(row.getCell(4), now, prior)
    if (i % 2 === 1) for (const c of [1, 2, 3]) row.getCell(c).fill = fill(BAND)
  })
  r = group(ws, r + 1, 'By producer', d.byProducer, year, !!N, colour)
  r = group(ws, r + 1, 'By line', d.byType, year, !!N)
  r = group(ws, r + 1, 'By carrier', d.byCarrier, year, !!N)
  // the key to the colours used on the policy sheets
  const k = ws.getRow(r + 1); k.getCell(1).value = 'Colour key'; k.getCell(1).font = { bold: true }
  const key: [string, string, string][] = [['New customer (first policy with the agency)', GREEN_BG, GREEN], ['Cancelled since', RED_BG, RED], ['Gain on last year', GREEN_BG, GREEN], ['Drop from last year', RED_BG, RED]]
  key.forEach(([t, bg, fg], i) => { const c = ws.getRow(r + 2 + i).getCell(1); c.value = t; c.fill = fill(bg); c.font = { color: { argb: fg } } })
  ws.getRow(r + 2 + key.length).getCell(1).value = 'Each producer keeps the same colour on the policy sheets as in the table above.'
  ws.getRow(r + 2 + key.length).getCell(1).font = { italic: true, size: 9, color: { argb: MUTED } }
}

function group(ws: any, r: number, name: string, rows: Group[], year: number, hasNow: boolean, colour?: Map<string, string>) {
  header(ws.getRow(r++), [name, `${year} premium`, `${year - 1} premium`, 'Change', `${year} pol.`, `${year - 1} pol.`], 1)
  const first = r
  for (const g of rows) {
    const row = ws.getRow(r++)
    row.getCell(1).value = g.key
    if (colour?.has(g.key)) row.getCell(1).fill = fill(colour.get(g.key)!)
    row.getCell(2).value = hasNow ? g.now.premium : '—'; row.getCell(3).value = g.prior.premium
    row.getCell(5).value = hasNow ? g.now.policies : '—'; row.getCell(6).value = g.prior.policies
    for (const c of [2, 3]) { row.getCell(c).numFmt = MONEY; row.getCell(c).alignment = { horizontal: 'right' } }
    for (const c of [5, 6]) row.getCell(c).alignment = { horizontal: 'right' }
    if (hasNow) changeCell(row.getCell(4), g.now.premium, g.prior.premium)
  }
  const t = ws.getRow(r++), L = first, R = r - 2
  t.getCell(1).value = 'Total'
  for (const [c, col] of [[2, 'B'], [3, 'C'], [5, 'E'], [6, 'F']] as [number, string][]) {
    if (hasNow || c === 3 || c === 6) t.getCell(c).value = rows.length ? { formula: `SUM(${col}${L}:${col}${R})` } : 0
    t.getCell(c).alignment = { horizontal: 'right' }
    if (c < 4) t.getCell(c).numFmt = MONEY
  }
  for (let c = 1; c <= 6; c++) { t.getCell(c).font = { bold: true }; t.getCell(c).fill = fill(TOTAL_BG) }
  return r
}

function policies(wb: any, name: string, list: SoldPolicy[], colour: Map<string, string>) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = [{ width: 12 }, { width: 34 }, { width: 18 }, { width: 24 }, { width: 22 }, { width: 20 }, { width: 13 }, { width: 14 }, { width: 11 }]
  header(ws.getRow(1), ['Sold', 'Customer', 'Policy #', 'Line', 'Carrier', 'Producer', 'Premium', 'Customer', 'Status'], 6)
  list.forEach((x, i) => {
    const row = ws.getRow(i + 2)
    row.getCell(1).value = new Date(x.day + 'T12:00:00Z'); row.getCell(1).numFmt = 'mmm d, yyyy'
    const cust = row.getCell(2)
    cust.value = x.cid ? { text: x.customer || 'Customer ' + x.cid, hyperlink: azUrl(x.cid) } : x.customer || ''
    if (x.cid) cust.font = { color: { argb: 'FF1F4FB8' }, underline: true }
    row.getCell(3).value = x.number || ''
    row.getCell(4).value = x.type || ''
    row.getCell(5).value = x.carrier || ''
    const p = row.getCell(6); p.value = x.producer; if (colour.has(x.producer)) p.fill = fill(colour.get(x.producer)!)
    row.getCell(7).value = x.premium; row.getCell(7).numFmt = MONEY2
    const n = row.getCell(8); n.value = x.isNew ? 'New' : 'Existing'
    if (x.isNew) { n.fill = fill(GREEN_BG); n.font = { bold: true, color: { argb: GREEN } } }
    const s = row.getCell(9); s.value = x.cancelled ? 'Cancelled' : 'Active'
    if (x.cancelled) {
      s.fill = fill(RED_BG); s.font = { bold: true, color: { argb: RED } }
      for (const c of [1, 3, 4, 5, 7]) row.getCell(c).font = { color: { argb: RED } }
    } else if (i % 2 === 1) for (const c of [1, 3, 4, 5, 7]) row.getCell(c).fill = fill(BAND)
    for (const c of [7, 8, 9]) row.getCell(c).alignment = { horizontal: c === 7 ? 'right' : 'center' }
  })
  const t = ws.getRow(list.length + 3)
  t.getCell(1).value = 'Total'
  t.getCell(2).value = `${list.length} ${list.length === 1 ? 'policy' : 'policies'}`
  t.getCell(7).value = list.length ? { formula: `SUM(G2:G${list.length + 1})` } : 0; t.getCell(7).numFmt = MONEY2
  t.getCell(8).value = { formula: `COUNTIF(H2:H${Math.max(2, list.length + 1)},"New")&" new"` }
  t.getCell(9).value = { formula: `COUNTIF(I2:I${Math.max(2, list.length + 1)},"Cancelled")&" cancelled"` }
  for (let c = 1; c <= 9; c++) { t.getCell(c).font = { bold: true }; t.getCell(c).fill = fill(TOTAL_BG); if (c >= 7) t.getCell(c).alignment = { horizontal: c === 7 ? 'right' : 'center' } }
  if (list.length) ws.autoFilter = { from: 'A1', to: `I${list.length + 1}` }
}

function byMonth(ws: any, months: MonthRow[], year: number, who: string | null) {
  ws.columns = [{ width: 18 }, { width: 15 }, { width: 15 }, { width: 12 }, { width: 11 }, { width: 11 }, { width: 12 }]
  title(ws, `Month by month: ${year} against ${year - 1}`, 'The current month is compared with last year to the same day' + (who ? ' · ' + who : ''), 7)
  header(ws.getRow(4), ['Month', `${year} premium`, `${year - 1} premium`, 'Change', `${year} pol.`, `${year - 1} pol.`, 'Pol. change'], 1)
  let r = 5
  for (const m of months) {
    const row = ws.getRow(r++), prior = m.priorToDate ?? m.prior
    row.getCell(1).value = m.label + (m.partial ? ' (to date)' : '')
    row.getCell(2).value = m.now ? m.now.premium : '—'; row.getCell(3).value = prior.premium
    row.getCell(5).value = m.now ? m.now.policies : '—'; row.getCell(6).value = prior.policies
    for (const c of [2, 3]) { row.getCell(c).numFmt = MONEY; row.getCell(c).alignment = { horizontal: 'right' } }
    for (const c of [5, 6]) row.getCell(c).alignment = { horizontal: 'right' }
    if (m.now) { changeCell(row.getCell(4), m.now.premium, prior.premium); changeCell(row.getCell(7), m.now.policies, prior.policies) }
    else for (let c = 1; c <= 7; c++) row.getCell(c).font = { color: { argb: MUTED } }
  }
  const t = ws.getRow(r)
  t.getCell(1).value = 'Year so far'
  for (const [c, col] of [[2, 'B'], [3, 'C'], [5, 'E'], [6, 'F']] as [number, string][]) {
    t.getCell(c).value = { formula: `SUM(${col}5:${col}${r - 1})` }; t.getCell(c).alignment = { horizontal: 'right' }
    if (c < 4) t.getCell(c).numFmt = MONEY
  }
  for (let c = 1; c <= 7; c++) { t.getCell(c).font = { bold: true }; t.getCell(c).fill = fill(TOTAL_BG) }
  const n = ws.getRow(r + 1).getCell(1)
  n.value = `Last year's column counts its full months, and the current month only to the same day; months still ahead show last year in full.`
  n.font = { italic: true, size: 9, color: { argb: MUTED } }
}
