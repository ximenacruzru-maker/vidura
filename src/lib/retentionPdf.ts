// The retention & book growth report as a PDF: what was done today, in the folio, in the month and in the year to date
// — Net Book Movement, saves, cross-sell, losses, service notes and the huddle numbers — with today's and the folio's
// entries in full, the folio bonus and its gates, and the year month by month. For the person in the role and admins.
import { supabase } from './supabase'
import { loadScript } from './perf/commissionFiles'
import { folioBonus, movement, type Period, type RetentionDay, type RetentionEntry } from './retention'
import type { BonusTier } from './payday'

const KIND: Record<RetentionEntry['kind'], string> = { save: 'Save', loss: 'Loss', cross_sell: 'Cross-sell', review: 'Service / review' }
const m0 = (n: number) => (n < 0 ? '-$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US')
const us = (iso: string) => iso.slice(5, 7) + '/' + iso.slice(8, 10) + '/' + iso.slice(0, 4)
const monthName = (m: string) => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export async function downloadRetentionPdf(name: string, folio: Period | null, today: string, agency = 'Your agency') {
  const year = today.slice(0, 4), month = today.slice(0, 7)
  const from = folio && folio.start_date < year + '-01-01' ? folio.start_date : year + '-01-01'
  const [days, log, staff] = await Promise.all([
    supabase.from('retention_days').select('*').eq('name', name).gte('day', from).lte('day', today).order('day').then((r) => { if (r.error) throw r.error; return r.data as RetentionDay[] }),
    supabase.from('retention_log').select('*').eq('name', name).gte('day', from).lte('day', today).order('day').order('id').then((r) => { if (r.error) throw r.error; return r.data as RetentionEntry[] }),
    supabase.from('hr_staff').select('bonus_tiers').eq('name', name).maybeSingle().then((r) => (r.data as { bonus_tiers: BonusTier[] | null } | null)),
  ])
  const bonus = folio ? await folioBonus(name, staff?.bonus_tiers, folio, today) : null

  const w = window as unknown as { jspdf?: { jsPDF: new (o: object) => any } }
  if (!w.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
  const pdf = new w.jspdf!.jsPDF({ unit: 'pt', format: 'letter' })
  const W = 612, L = 40, R = W - 40
  let y = 48
  const room = (h: number) => { if (y + h > 752) { pdf.addPage(); y = 48 } }
  const text = (s: string, x: number, o: { size?: number; bold?: boolean; color?: number[]; align?: 'right' | 'center' } = {}) => {
    pdf.setFont('helvetica', o.bold ? 'bold' : 'normal'); pdf.setFontSize(o.size || 10); pdf.setTextColor(...(o.color || [30, 30, 40]))
    pdf.text(s, x, y, o.align ? { align: o.align } : undefined)
  }
  /** A paragraph that wraps to the page width. */
  const para = (s: string, o: { size?: number; color?: number[]; indent?: number } = {}) => {
    pdf.setFontSize(o.size || 9)
    for (const ln of pdf.splitTextToSize(s, R - L - (o.indent || 0)) as string[]) { room(13); text(ln, L + (o.indent || 0), o); y += (o.size || 9) + 4 }
  }
  const heading = (s: string) => { room(40); y += 10; text(s, L, { size: 13, bold: true, color: [24, 44, 110] }); y += 6; pdf.setDrawColor(200, 200, 210); pdf.line(L, y, R, y); y += 16 }
  /** A table: column widths in points, the last column takes the rest; long cells wrap. */
  const table = (cols: { h: string; w: number; right?: boolean }[], rows: string[][]) => {
    const xs: number[] = []; let x = L
    for (const c of cols) { xs.push(x); x += c.w }
    room(30)
    cols.forEach((c, i) => text(c.h.toUpperCase(), c.right ? xs[i] + c.w - 4 : xs[i], { size: 7.5, bold: true, color: [110, 110, 125], align: c.right ? 'right' : undefined }))
    y += 12
    for (const r of rows) {
      const wrapped = r.map((cell, i) => (pdf.setFontSize(9), pdf.splitTextToSize(cell || '', cols[i].w - 8) as string[]))
      const h = Math.max(...wrapped.map((l) => l.length)) * 11 + 5
      room(h)
      wrapped.forEach((lines, i) => lines.forEach((ln, k) => { const yy = y; y = yy + k * 11; text(ln, cols[i].right ? xs[i] + cols[i].w - 4 : xs[i], { size: 9, align: cols[i].right ? 'right' : undefined }); y = yy }))
      y += h; pdf.setDrawColor(232, 232, 238); pdf.line(L, y - 8, R, y - 8)
    }
    y += 4
  }

  // ---- the four periods side by side ----
  const periods: { label: string; from: string; to: string }[] = [
    { label: 'Today', from: today, to: today },
    ...(folio ? [{ label: 'This folio', from: folio.start_date, to: folio.end_date < today ? folio.end_date : today }] : []),
    { label: 'This month', from: month + '-01', to: today },
    { label: 'Year to date', from: year + '-01-01', to: today },
  ]
  const stats = periods.map((p) => {
    const l = log.filter((e) => e.day >= p.from && e.day <= p.to), d = days.filter((x) => x.day >= p.from && x.day <= p.to)
    const mv = movement(l), sum = (k: keyof RetentionDay) => d.reduce((a, x) => a + Number(x[k] || 0), 0)
    const esc = sum('escalations'), same = d.reduce((a, x) => a + Math.min(x.escalations_same_day, x.escalations), 0)
    return { mv, reviews: l.filter((e) => e.kind === 'review').length, touches: sum('at_risk_touches'), convos: sum('renewal_conversations'), esc, same, daysLogged: d.length }
  })

  text('Retention & Book Growth Report', L, { size: 18, bold: true, color: [24, 44, 110] }); y += 18
  text(`${name} · Director of Client Success, Retention & Book Growth`, L, { size: 10, color: [90, 90, 105] }); y += 13
  text(`Generated ${us(today)}${folio ? ` · folio ${us(folio.start_date)} – ${us(folio.end_date)}` : ''}`, L, { size: 10, color: [90, 90, 105] }); y += 8

  heading('Summary')
  const cw = Math.floor((R - L - 170) / periods.length)
  table([{ h: '', w: 170 }, ...periods.map((p) => ({ h: p.label, w: cw, right: true }))], [
    ['Net Book Movement', ...stats.map((s) => m0(s.mv.net))],
    ['Saved premium (policies)', ...stats.map((s) => `${m0(s.mv.saved.p)} (${s.mv.saved.n})`)],
    ['Cross-sell premium (policies)', ...stats.map((s) => `${m0(s.mv.cross.p)} (${s.mv.cross.n})`)],
    ['Lost premium (policies)', ...stats.map((s) => `${m0(s.mv.lost.p)} (${s.mv.lost.n})`)],
    ['Service / review notes', ...stats.map((s) => String(s.reviews))],
    ['At-risk touches', ...stats.map((s) => String(s.touches))],
    ['Live renewal conversations', ...stats.map((s) => String(s.convos))],
    ['Critical escalations same day', ...stats.map((s) => (s.esc ? `${s.same} of ${s.esc}` : '0'))],
    ['Scorecard days logged', ...stats.map((s) => String(s.daysLogged))],
  ])
  y += 2; para('Net Book Movement = saved premium + cross-sell premium - lost premium.', { size: 8, color: [110, 110, 125] })

  // ---- today ----
  heading(`Today, ${us(today)}`)
  const td = days.find((d) => d.day === today)
  para(td ? `Scorecard: ${td.at_risk_touches} of 15 at-risk touches · ${td.renewal_conversations} of 5 renewal conversations · ${td.escalations_same_day} of ${td.escalations} escalations same day · ${td.open_critical_aged} critical cases aged over a day · brokered ${td.brokered_current ? 'current' : 'NOT current'}` : 'Scorecard not logged today.')
  if (td?.priority) para(`Priority: ${td.priority}`)
  y += 4
  const entryCols = [{ h: 'Day', w: 62 }, { h: 'Type', w: 84 }, { h: 'Client', w: 130 }, { h: 'Premium', w: 64, right: true }, { h: 'Notes', w: R - L - 340 }]
  const entryRow = (e: RetentionEntry) => [us(e.day), KIND[e.kind], e.client + (e.carrier ? ` (${e.carrier})` : ''), e.kind === 'review' ? '—' : (e.kind === 'loss' ? '-' : '') + m0(Number(e.premium)), [e.reason, e.note].filter(Boolean).join(' · ')]
  const todays = log.filter((e) => e.day === today)
  if (todays.length) table(entryCols, todays.map(entryRow)); else { text('Nothing logged today.', L, { size: 9, color: [110, 110, 125] }); y += 12 }

  // ---- folio ----
  if (folio && bonus) {
    heading(`This folio, ${us(folio.start_date)} – ${us(folio.end_date)}`)
    para(`Agency premium written: ${m0(bonus.premium)} · bonus level reached: ${bonus.tier.amount ? m0(bonus.tier.amount) + ` (at ${m0(bonus.tier.min)})` : 'none yet (starts at $100,000)'} · ${bonus.eligible ? 'all four gates met' : `${bonus.gates.filter((g) => g.ok).length} of 4 gates met`}`)
    for (const g of bonus.gates) para(`${g.ok ? '[x]' : '[ ]'}  ${g.label}: ${g.detail}`, { indent: 6, color: g.ok ? [30, 110, 60] : [160, 90, 20] })
    y += 4
    const inFolio = log.filter((e) => e.day >= folio.start_date && e.day <= folio.end_date)
    if (inFolio.length) table(entryCols, inFolio.map(entryRow)); else { text('Nothing logged in this folio yet.', L, { size: 9, color: [110, 110, 125] }); y += 12 }
  }

  // ---- the year, month by month ----
  heading(`${year} month by month`)
  const months = [...new Set([...log.map((e) => e.day.slice(0, 7)), ...days.map((d) => d.day.slice(0, 7))])].filter((m) => m.startsWith(year)).sort()
  if (months.length) {
    table([{ h: 'Month', w: 120 }, { h: 'Saved', w: 80, right: true }, { h: 'Cross-sell', w: 80, right: true }, { h: 'Lost', w: 80, right: true }, { h: 'Net Book Movement', w: 100, right: true }, { h: 'Service notes', w: R - L - 460, right: true }],
      months.map((m) => { const mv = movement(log.filter((e) => e.day.startsWith(m))); return [monthName(m), `${m0(mv.saved.p)} (${mv.saved.n})`, `${m0(mv.cross.p)} (${mv.cross.n})`, `${m0(mv.lost.p)} (${mv.lost.n})`, m0(mv.net), String(log.filter((e) => e.day.startsWith(m) && e.kind === 'review').length)] }))
  } else { text('Nothing logged this year yet.', L, { size: 9, color: [110, 110, 125] }); y += 12 }

  const pages = pdf.getNumberOfPages()
  for (let i = 1; i <= pages; i++) { pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(140, 140, 150); pdf.text(`${agency} · Retention & Book Growth · page ${i} of ${pages}`, W / 2, 776, { align: 'center' }) }
  pdf.setProperties({ title: `Retention report — ${name} — ${us(today)}` })
  pdf.save(`Retention_Report_${name.replace(/\s+/g, '_')}_${today}.pdf`)
}
