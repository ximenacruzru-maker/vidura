// A call list as a PDF, in the same style as the retention report: the header band, the totals (called, reached,
// voicemail, no answer, not interested / wrong number, still to call), then every client with the phone, the result,
// when they were called and the notes. Downloaded from the call list (the person it's assigned to, the owner, admins).
import { loadScript } from './perf/commissionFiles'
import type { CallItem, CallResult } from '../pages/CallLists'

const us = (iso: string) => iso.slice(5, 7) + '/' + iso.slice(8, 10) + '/' + iso.slice(0, 4)
const LABEL: Record<CallResult, string> = { reached: 'Reached', voicemail: 'Left voicemail', no_answer: 'No answer', not_interested: 'Not interested', wrong_number: 'Wrong number' }

export async function downloadCallListPdf(list: { assignee: string; name: string; date: string; rows: CallItem[] }, today: string, agency = 'Your agency') {
  const rows = list.rows
  const n = (k: CallResult) => rows.filter((r) => r.result === k).length
  const called = rows.filter((r) => r.result).length, left = rows.length - called

  const w = window as unknown as { jspdf?: { jsPDF: new (o: object) => any } }
  if (!w.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
  const pdf = new w.jspdf!.jsPDF({ unit: 'pt', format: 'letter' })
  const W = 612, H = 792, L = 36, R = W - 36, CW = R - L, BOTTOM = H - 48
  type RGB = [number, number, number]
  const C: Record<string, RGB> = {
    navy: [27, 39, 84], navy2: [44, 62, 128], ink: [33, 37, 52], muted: [112, 117, 135], faint: [160, 165, 180],
    line: [226, 229, 238], soft: [246, 247, 251], card: [255, 255, 255], teal: [14, 148, 136], tealSoft: [224, 245, 242],
    green: [22, 150, 82], greenSoft: [225, 245, 233], red: [214, 54, 54], redSoft: [252, 230, 230],
    amber: [214, 128, 18], amberSoft: [253, 240, 220], blueSoft: [228, 233, 250], gray: [107, 114, 128], graySoft: [238, 239, 242],
  }
  const STYLE: Record<CallResult | 'none', { fg: RGB; bg: RGB }> = {
    reached: { fg: C.green, bg: C.greenSoft }, voicemail: { fg: C.navy2, bg: C.blueSoft }, no_answer: { fg: C.amber, bg: C.amberSoft },
    not_interested: { fg: C.red, bg: C.redSoft }, wrong_number: { fg: C.gray, bg: C.graySoft }, none: { fg: C.faint, bg: C.soft },
  }
  let y = 0
  const fill = (c: RGB) => pdf.setFillColor(c[0], c[1], c[2])
  const stroke = (c: RGB) => pdf.setDrawColor(c[0], c[1], c[2])
  const font = (size: number, bold = false, color: RGB = C.ink) => { pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.setTextColor(color[0], color[1], color[2]) }
  const txt = (s: string, x: number, yy: number, size: number, bold = false, color: RGB = C.ink, align?: 'right' | 'center') => { font(size, bold, color); pdf.text(s, x, yy, align ? { align } : undefined) }
  const box = (x: number, yy: number, w2: number, h: number, c: RGB, r = 6) => { fill(c); pdf.roundedRect(x, yy, w2, h, r, r, 'F') }
  const fit = (s: string, size: number, maxW: number, bold = false) => { font(size, bold); let t = s; while (t.length > 1 && pdf.getTextWidth(t) > maxW) t = t.slice(0, -2); return t === s ? s : t.trimEnd() + '…' }
  const pill = (label: string, x: number, yy: number, st: { fg: RGB; bg: RGB }) => { font(7.5, true); const tw = pdf.getTextWidth(label); box(x, yy - 8.5, tw + 12, 12, st.bg, 6); txt(label, x + 6, yy, 7.5, true, st.fg) }
  const bar = (x: number, yy: number, w2: number, pct: number, c: RGB, h = 6) => { box(x, yy, w2, h, C.line, h / 2); if (pct > 0) box(x, yy, Math.max(h, w2 * Math.min(1, pct)), h, c, h / 2) }

  function band(first: boolean) {
    const h = first ? 112 : 46
    fill(C.navy); pdf.rect(0, 0, W, h, 'F')
    fill(C.navy2); pdf.circle(W - 30, first ? -10 : -24, first ? 112 : 66, 'F')
    fill(C.teal); pdf.rect(0, h, W, 4, 'F')
    if (first) {
      txt(list.name.toUpperCase(), L, 38, 9, true, [150, 200, 220])
      txt('Call List Report', L, 64, 24, true, [255, 255, 255])
      txt(`${list.assignee}  ·  list of ${us(list.date)}  ·  ${rows.length} clients`, L, 86, 10, false, [205, 212, 235])
      txt(agency, R, 38, 9, true, [205, 212, 235], 'right')
      txt(`Generated ${us(today)}`, R, 64, 10, false, [255, 255, 255], 'right')
    } else {
      txt(list.name, L, 29, 12, true, [255, 255, 255])
      txt(`${list.assignee}  ·  ${us(today)}`, R, 29, 9, false, [205, 212, 235], 'right')
    }
  }
  const section = (title: string, sub?: string) => {
    y += 14; box(L, y - 11, 4, 15, C.teal, 2); txt(title, L + 12, y, 13, true, C.navy)
    if (sub) { font(13, true); txt(sub, L + 18 + pdf.getTextWidth(title), y, 9, false, C.muted) }
    y += 10; stroke(C.line); pdf.setLineWidth(0.8); pdf.line(L, y, R, y); y += 14
  }

  // ---- page 1: the totals ----
  band(true); y = 140
  const heroH = 104
  box(L, y, CW, heroH, C.soft, 10)
  txt('CALLED', L + 18, y + 26, 8, true, C.muted)
  txt(`${called} / ${rows.length}`, L + 18, y + 60, 30, true, C.navy)
  bar(L + 18, y + 72, 150, rows.length ? called / rows.length : 0, C.teal, 7)
  txt(`${rows.length ? Math.round((called / rows.length) * 100) : 0}% of the list · ${left} still to call`, L + 18, y + 94, 8.5, false, C.muted)
  const share = (v: number) => (called ? `${Math.round((v / called) * 100)}% of calls` : '—')
  const parts: { label: string; v: number; sub: string; st: { fg: RGB; bg: RGB } }[] = [
    { label: 'Reached', v: n('reached'), sub: share(n('reached')), st: STYLE.reached }, { label: 'Voicemail', v: n('voicemail'), sub: share(n('voicemail')), st: STYLE.voicemail },
    { label: 'No answer', v: n('no_answer'), sub: share(n('no_answer')), st: STYLE.no_answer },
    { label: 'Declined', v: n('not_interested'), sub: `+ ${n('wrong_number')} wrong number${n('wrong_number') === 1 ? '' : 's'}`, st: STYLE.not_interested },
  ]
  const pw = 80, px0 = R - 14 - parts.length * pw - (parts.length - 1) * 6
  parts.forEach((p, i) => {
    const x = px0 + i * (pw + 6)
    box(x, y + 14, pw, heroH - 28, C.card, 8); box(x, y + 14, 4, heroH - 28, p.st.fg, 2)
    txt(fit(p.label.toUpperCase(), 7.5, pw - 18, true), x + 14, y + 34, 7.5, true, C.muted)
    txt(String(p.v), x + 14, y + 60, 20, true, p.st.fg)
    txt(fit(p.sub, 8, pw - 18), x + 14, y + 76, 8, false, C.muted)
  })
  y += heroH + 8

  // ---- every client ----
  section('Clients', `${called} called · ${left} to call`)
  const cols = [{ h: '#', w: 24 }, { h: 'CLIENT', w: 142 }, { h: 'PHONE', w: 84 }, { h: 'RESULT', w: 92 }, { h: 'CALLED', w: 66 }, { h: 'NOTES', w: CW - 408 }]
  const xs: number[] = []; let x = L; for (const c of cols) { xs.push(x); x += c.w }
  const head = () => { box(L, y, CW, 18, C.navy, 4); cols.forEach((c, i) => txt(c.h, xs[i] + 8, y + 12, 7, true, [255, 255, 255])); y += 18 }
  head()
  // called first (by when), then the ones still to call (by renewal date)
  const sorted = [...rows].sort((a, b) => (a.result ? 0 : 1) - (b.result ? 0 : 1) || String(a.called_at || '').localeCompare(String(b.called_at || '')) || String(a.opportunity_date || '').localeCompare(String(b.opportunity_date || '')))
  sorted.forEach((r, i) => {
    const who = [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Client'
    font(8.5); const notes = pdf.splitTextToSize(r.notes?.trim() || '—', cols[5].w - 14) as string[]
    const h = 10 + Math.max(notes.length, 2) * 11
    if (y + h > BOTTOM) { pdf.addPage(); band(false); y = 74; head() }
    if (i % 2) { fill(C.soft); pdf.rect(L, y, CW, h, 'F') }
    const base = y + 15
    txt(String(i + 1), xs[0] + 8, base, 8, false, C.faint)
    txt(fit(who, 8.5, cols[1].w - 14, true), xs[1] + 8, base, 8.5, true, C.ink)
    txt(fit([r.line, r.opportunity_date && `renews ${us(r.opportunity_date)}`].filter(Boolean).join(' · '), 7.5, cols[1].w - 14), xs[1] + 8, base + 11, 7.5, false, C.muted)
    txt(r.phone || '—', xs[2] + 8, base, 8.5, false, C.ink)
    pill(r.result ? LABEL[r.result] : 'Not called', xs[3] + 8, base, STYLE[r.result || 'none'])
    if (r.called_at) {
      const d = new Date(r.called_at)
      txt(d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }), xs[4] + 8, base, 8.5, false, C.ink)
      txt(d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), xs[4] + 8, base + 11, 7.5, false, C.muted)
    } else txt('—', xs[4] + 8, base, 8.5, false, C.faint)
    notes.forEach((ln, k) => txt(ln, xs[5] + 8, base + k * 11, 8.5, false, r.notes ? C.ink : C.faint))
    y += h
  })
  stroke(C.line); pdf.setLineWidth(0.8); pdf.line(L, y, R, y)

  const pages = pdf.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i)
    stroke(C.line); pdf.setLineWidth(0.8); pdf.line(L, H - 34, R, H - 34)
    txt(`${agency}  ·  ${list.name}  ·  ${list.assignee}`, L, H - 20, 7.5, false, C.faint)
    txt(`Page ${i} of ${pages}`, R, H - 20, 7.5, true, C.muted, 'right')
  }
  pdf.setProperties({ title: `${list.name} — ${list.assignee} — ${us(today)}` })
  pdf.save(`Call_List_${list.assignee.replace(/\s+/g, '_')}_${today}.pdf`)
}
