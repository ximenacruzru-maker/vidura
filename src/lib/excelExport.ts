// Any table the app exports, as a colour-coded Excel workbook: a dark header row that stays put and filters, money,
// numbers and dates formatted as such, a totals row under money columns, each person (producer, owner, SDR, name) in
// their own colour, and status words coloured — Yes, Active, Paid in green; No, Cancelled, Overdue, High in red;
// Pending, Open, Medium in amber. Renewal "Days" are red within 30 days and amber within 60; a "Due" date already
// past is red.
// Rows are what a CSV would hold: the first row is the header; an empty row followed by a one-cell row starts a new
// section (that cell its title, the next row its header). If Excel can't be built, a plain CSV is saved instead.
import { todayPacific } from './format'
import { excelLib, save } from './perf/commissionFiles'

type Cell = string | number | null | undefined
const DARK = 'FF1F3D2E', WHITE = 'FFFFFFFF', BAND = 'FFF6F7F5', TOTAL_BG = 'FFFBF1DD'
const GREEN = 'FF1F7A57', GREEN_BG = 'FFE3F4EC', RED = 'FFA83E4B', RED_BG = 'FFF9E3E6', AMBER = 'FF9A6411', AMBER_BG = 'FFFDF1D8'
const PEOPLE_FILLS = ['FFDCE6FF', 'FFFDE7C8', 'FFDDF3E4', 'FFF3DDF3', 'FFDDF1F5', 'FFFBE0D6', 'FFE8E4F8', 'FFEFF3D6', 'FFF5E1E9', 'FFE2ECE9']
const GOOD = /^(yes|active|paid|done|completed?|sold|bound|approved|in ?force|qualifies|won|closed won)$/i
const BAD = /^(no|cancell?ed|overdue|dead|lost|expired|lapsed|declined|terminated|critical|high|urgent|failed|closed lost)$/i
const WARN = /^(open|pending|in progress|in process|not started|medium|quoted|waiting|due soon|partial)$/i
const MONEY_HEAD = /premium|commission|bonus|amount|\bpay\b|revenue|\bfee|\$|quoted\b|^total$/i
const PEOPLE_HEAD = /^(producer|owner|sdr|agent|assigned|name)$/i
const NUM = /^-?\d+(\.\d+)?$/
const fill = (argb: string) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })

/** Saves rows as a colour-coded .xlsx (the name's extension is replaced), or as a CSV if Excel isn't available. */
export async function downloadSheet(filename: string, rows: Cell[][], opts: { sheet?: string } = {}) {
  const base = filename.replace(/\.(csv|xlsx)$/i, '')
  try {
    const ExcelJS = await excelLib()
    const wb = new ExcelJS.Workbook(); wb.creator = 'Declara'
    build(wb.addWorksheet((opts.sheet || 'Export').slice(0, 31)), rows)
    const buf = await wb.xlsx.writeBuffer()
    save(base + '.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  } catch {
    const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
    save(base + '.csv', new Blob([rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' }))
  }
}

function build(ws: any, rows: Cell[][]) {
  const today = todayPacific()
  const width: number[] = []
  const people = new Map<string, string>()
  const personFill = (v: string) => { if (!people.has(v)) people.set(v, PEOPLE_FILLS[people.size % PEOPLE_FILLS.length]); return people.get(v)! }
  let head: string[] = [], first = 0, out = 1, band = 0, filtered = false
  const total = (from: number, to: number) => {
    const money = head.map((h, i) => (MONEY_HEAD.test(h) ? i : -1)).filter((i) => i >= 0)
    if (to < from || !money.length) return
    const t = ws.getRow(out++)
    t.getCell(1).value = 'Total'
    for (const i of money) {
      const col = colName(i + 1)
      t.getCell(i + 1).value = { formula: `SUM(${col}${from}:${col}${to})` }; t.getCell(i + 1).numFmt = '"$"#,##0.00'
    }
    for (let c = 1; c <= head.length; c++) { t.getCell(c).font = { bold: true }; t.getCell(c).fill = fill(TOTAL_BG) }
  }
  const header = (cells: Cell[]) => {
    head = cells.map((c) => String(c ?? ''))
    const r = ws.getRow(out)
    head.forEach((h, i) => {
      const c = r.getCell(i + 1); c.value = h; c.font = { bold: true, color: { argb: WHITE } }; c.fill = fill(DARK); c.alignment = { vertical: 'middle' }
      width[i] = Math.max(width[i] || 0, h.length + 2)
    })
    r.height = 20
    if (!filtered) { ws.views = [{ state: 'frozen', ySplit: out }]; filtered = true }
    first = ++out; band = 0
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || []
    if (i === 0) { header(row); continue }
    const filledCells = row.filter((c) => c != null && c !== '').length
    if (!filledCells) { total(first, out - 1); out++; continue }
    // a one-cell row after a blank one titles a new section; the row after it is that section's header
    if (filledCells === 1 && !(rows[i - 1] || []).some((c) => c != null && c !== '') && rows[i + 1]) {
      const t = ws.getRow(out++).getCell(1); t.value = String(row.find((c) => c != null && c !== '')); t.font = { bold: true, size: 12 }
      header(rows[++i]); continue
    }
    const r = ws.getRow(out)
    row.forEach((v, j) => {
      const c = r.getCell(j + 1), h = head[j] || '', s = v == null ? '' : String(v).trim()
      if (s === '') return
      const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
      if (/^\d{4}-\d{2}-\d{2}$/.test(s) || us) { c.value = new Date((us ? `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` : s) + 'T12:00:00Z'); c.numFmt = 'mmm d, yyyy' }
      else if (NUM.test(s) && (typeof v === 'number' || MONEY_HEAD.test(h) || /days|policies|life|hours|\(h\)|count|#$/i.test(h) && !/policy #/i.test(h))) {
        c.value = Number(s); c.alignment = { horizontal: 'right' }
        if (MONEY_HEAD.test(h)) c.numFmt = '"$"#,##0.00'
      } else c.value = s
      width[j] = Math.max(width[j] || 0, Math.min(50, s.length + 2))
      if (band % 2 === 1) c.fill = fill(BAND)
      if (GOOD.test(s)) { c.fill = fill(GREEN_BG); c.font = { bold: true, color: { argb: GREEN } } }
      else if (BAD.test(s)) { c.fill = fill(RED_BG); c.font = { bold: true, color: { argb: RED } } }
      else if (WARN.test(s)) { c.fill = fill(AMBER_BG); c.font = { bold: true, color: { argb: AMBER } } }
      else if (PEOPLE_HEAD.test(h)) c.fill = fill(personFill(s))
      if (/^days$/i.test(h) && NUM.test(s)) {
        const d = Number(s)
        if (d <= 30) { c.fill = fill(RED_BG); c.font = { bold: true, color: { argb: RED } } } else if (d <= 60) { c.fill = fill(AMBER_BG); c.font = { bold: true, color: { argb: AMBER } } }
      }
      if (/^due/i.test(h) && c.value instanceof Date && c.value.toISOString().slice(0, 10) < today) { c.fill = fill(RED_BG); c.font = { bold: true, color: { argb: RED } } }
    })
    out++; band++
  }
  total(first, out - 1)
  if (head.length && rows.length > 1) ws.autoFilter = { from: 'A1', to: colName(head.length) + '1' }
  width.forEach((w, i) => { ws.getColumn(i + 1).width = Math.max(8, w || 8) })
}

function colName(n: number) {
  let s = ''
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}
