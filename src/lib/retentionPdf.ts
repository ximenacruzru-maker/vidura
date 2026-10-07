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
  const W = 612, H = 792, L = 36, R = W - 36, CW = R - L, BOTTOM = H - 48
  type RGB = [number, number, number]
  const C: Record<string, RGB> = {
    navy: [27, 39, 84], navy2: [44, 62, 128], ink: [33, 37, 52], muted: [112, 117, 135], faint: [160, 165, 180],
    line: [226, 229, 238], soft: [246, 247, 251], card: [255, 255, 255], teal: [14, 148, 136], tealSoft: [224, 245, 242],
    green: [22, 150, 82], greenSoft: [225, 245, 233], red: [214, 54, 54], redSoft: [252, 230, 230],
    amber: [214, 128, 18], amberSoft: [253, 240, 220], violet: [113, 74, 214], violetSoft: [237, 232, 252], gold: [201, 160, 60],
  }
  const KIND_STYLE: Record<RetentionEntry['kind'], { fg: RGB; bg: RGB }> = {
    save: { fg: C.green, bg: C.greenSoft }, cross_sell: { fg: C.teal, bg: C.tealSoft }, loss: { fg: C.red, bg: C.redSoft }, review: { fg: C.violet, bg: C.violetSoft },
  }
  let y = 0
  const fill = (c: RGB) => pdf.setFillColor(c[0], c[1], c[2])
  const stroke = (c: RGB) => pdf.setDrawColor(c[0], c[1], c[2])
  const font = (size: number, bold = false, color: RGB = C.ink) => { pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.setTextColor(color[0], color[1], color[2]) }
  const txt = (s: string, x: number, yy: number, size: number, bold = false, color: RGB = C.ink, align?: 'right' | 'center') => { font(size, bold, color); pdf.text(s, x, yy, align ? { align } : undefined) }
  const box = (x: number, yy: number, w2: number, h: number, c: RGB, r = 6) => { fill(c); pdf.roundedRect(x, yy, w2, h, r, r, 'F') }
  const fit = (s: string, size: number, maxW: number, bold = false) => { font(size, bold); let t = s; while (t.length > 1 && pdf.getTextWidth(t) > maxW) t = t.slice(0, -2); return t === s ? s : t.trimEnd() + '…' }
  const newPage = () => { pdf.addPage(); band(false); y = 74 }
  const room = (h: number) => { if (y + h > BOTTOM) newPage() }

  /** The header band: a full one on the first page, a slim one after. */
  function band(first: boolean) {
    const h = first ? 112 : 46
    fill(C.navy); pdf.rect(0, 0, W, h, 'F')
    fill(C.navy2); pdf.circle(W - 30, first ? -10 : -24, first ? 112 : 66, 'F')
    fill(C.teal); pdf.rect(0, h, W, 4, 'F')
    if (first) {
      txt('RETENTION & BOOK GROWTH', L, 38, 9, true, [150, 200, 220])
      txt('Performance Report', L, 64, 24, true, [255, 255, 255])
      txt(`${name}  ·  Director of Client Success, Retention & Book Growth`, L, 86, 10, false, [205, 212, 235])
      txt(agency, R, 38, 9, true, [205, 212, 235], 'right')
      txt(`Generated ${us(today)}`, R, 64, 10, false, [255, 255, 255], 'right')
      if (folio) txt(`Folio ${us(folio.start_date)} – ${us(folio.end_date)}`, R, 80, 9, false, [205, 212, 235], 'right')
    } else {
      txt('Retention & Book Growth', L, 29, 12, true, [255, 255, 255])
      txt(`${name}  ·  ${us(today)}`, R, 29, 9, false, [205, 212, 235], 'right')
    }
  }
  /** A section title with a colored marker and a hairline. */
  const section = (title: string, sub?: string, keep = 60) => {
    room(keep + 40); y += 14
    box(L, y - 11, 4, 15, C.teal, 2)
    txt(title, L + 12, y, 13, true, C.navy)
    if (sub) { font(13, true); txt(sub, L + 18 + pdf.getTextWidth(title), y, 9, false, C.muted) }
    y += 10; stroke(C.line); pdf.setLineWidth(0.8); pdf.line(L, y, R, y); y += 14
  }
  /** A small colored pill with a label. */
  const pill = (label: string, x: number, yy: number, st: { fg: RGB; bg: RGB }) => {
    font(7.5, true); const tw = pdf.getTextWidth(label)
    box(x, yy - 8.5, tw + 12, 12, st.bg, 6); txt(label, x + 6, yy, 7.5, true, st.fg); return tw + 12
  }
  /** A progress bar. */
  const bar = (x: number, yy: number, w2: number, pct: number, c: RGB, h = 6) => {
    box(x, yy, w2, h, C.line, h / 2)
    if (pct > 0) box(x, yy, Math.max(h, w2 * Math.min(1, pct)), h, c, h / 2)
  }

  // ---- the periods ----
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
  const headline = stats[periods.findIndex((p) => p.label === (folio ? 'This folio' : 'This month'))]

  // ================= page 1 =================
  band(true); y = 140

  // hero: Net Book Movement + the three parts
  const heroH = 104
  box(L, y, CW, heroH, C.soft, 10)
  const nbm = headline.mv.net
  txt(`NET BOOK MOVEMENT · ${folio ? 'THIS FOLIO' : 'THIS MONTH'}`, L + 18, y + 26, 8, true, C.muted)
  txt(m0(nbm), L + 18, y + 62, 34, true, nbm >= 0 ? C.green : C.red)
  txt('saved + cross-sell − lost premium'.replace('−', '-'), L + 18, y + 82, 8.5, false, C.muted)
  const parts: { label: string; v: string; n: number; c: RGB; bg: RGB }[] = [
    { label: 'Saved', v: m0(headline.mv.saved.p), n: headline.mv.saved.n, c: C.green, bg: C.greenSoft },
    { label: 'Cross-sell', v: m0(headline.mv.cross.p), n: headline.mv.cross.n, c: C.teal, bg: C.tealSoft },
    { label: 'Lost', v: m0(headline.mv.lost.p), n: headline.mv.lost.n, c: C.red, bg: C.redSoft },
  ]
  const pw = 104, px0 = R - 14 - parts.length * pw - (parts.length - 1) * 8
  parts.forEach((p, i) => {
    const x = px0 + i * (pw + 8)
    box(x, y + 14, pw, heroH - 28, C.card, 8); box(x, y + 14, 4, heroH - 28, p.c, 2)
    txt(p.label.toUpperCase(), x + 14, y + 34, 7.5, true, C.muted)
    txt(p.v, x + 14, y + 58, 16, true, p.c)
    txt(`${p.n} polic${p.n === 1 ? 'y' : 'ies'}`, x + 14, y + 74, 8, false, C.muted)
  })
  y += heroH + 8

  // today: goals as progress cards
  section('Today', us(today))
  const td = days.find((d) => d.day === today)
  const goals: { label: string; now: number; goal: number; show: string; good: boolean; c: RGB }[] = [
    { label: 'At-risk touches', now: td?.at_risk_touches ?? 0, goal: 15, show: `${td?.at_risk_touches ?? 0} / 15`, good: (td?.at_risk_touches ?? 0) >= 15, c: C.navy2 },
    { label: 'Renewal conversations', now: td?.renewal_conversations ?? 0, goal: 5, show: `${td?.renewal_conversations ?? 0} / 5`, good: (td?.renewal_conversations ?? 0) >= 5, c: C.teal },
    { label: 'Escalations same day', now: td ? Math.min(td.escalations_same_day, td.escalations) : 0, goal: Math.max(1, td?.escalations ?? 0), show: td?.escalations ? `${Math.min(td.escalations_same_day, td.escalations)} / ${td.escalations}` : 'none', good: !td?.escalations || td.escalations_same_day >= td.escalations, c: C.violet },
    { label: 'Critical cases aged >1 day', now: td?.open_critical_aged ?? 0, goal: 1, show: String(td?.open_critical_aged ?? 0), good: (td?.open_critical_aged ?? 0) === 0, c: C.red },
  ]
  const gw = (CW - 3 * 10) / 4, gh = 62
  room(gh + 10)
  goals.forEach((g, i) => {
    const x = L + i * (gw + 10)
    box(x, y, gw, gh, C.soft, 8)
    txt(fit(g.label.toUpperCase(), 7, gw - 20, true), x + 10, y + 17, 7, true, C.muted)
    txt(g.show, x + 10, y + 39, 16, true, g.good ? C.green : C.ink)
    if (g.label.startsWith('Critical')) txt(g.good ? 'goal met' : 'needs an owner today', x + 10, y + 53, 7.5, false, g.good ? C.green : C.red)
    else bar(x + 10, y + 48, gw - 20, g.now / g.goal, g.good ? C.green : g.c, 5)
  })
  y += gh + 10
  if (!td) { txt('Today’s scorecard isn’t logged yet.', L, y + 4, 9, false, C.amber); y += 14 }
  if (td?.priority) {
    room(30); box(L, y, CW, 26, C.amberSoft, 6); box(L, y, 4, 26, C.amber, 2)
    txt('TODAY’S PRIORITY', L + 14, y + 16.5, 7.5, true, C.amber); txt(fit(td.priority, 9.5, CW - 130), L + 108, y + 16.5, 9.5, false, C.ink); y += 34
  }

  /** The log as a table: day, a colored type pill, client, premium (green / red), notes that wrap. */
  const entries = (list: RetentionEntry[], empty: string) => {
    if (!list.length) { room(24); box(L, y, CW, 22, C.soft, 6); txt(empty, L + 12, y + 14.5, 9, false, C.muted); y += 30; return }
    const cols = [{ h: 'DAY', w: 58 }, { h: 'TYPE', w: 92 }, { h: 'CLIENT', w: 140 }, { h: 'PREMIUM', w: 66 }, { h: 'NOTES', w: CW - 356 }]
    const xs: number[] = []; let x = L; for (const c of cols) { xs.push(x); x += c.w }
    const head = () => { box(L, y, CW, 18, C.navy, 4); cols.forEach((c, i) => txt(c.h, c.h === 'PREMIUM' ? xs[i] + c.w - 8 : xs[i] + 8, y + 12, 7, true, [255, 255, 255], c.h === 'PREMIUM' ? 'right' : undefined)); y += 18 }
    room(40); head()
    list.forEach((e, i) => {
      font(8.5); const notes = pdf.splitTextToSize([e.reason, e.note].filter(Boolean).join(' · ') || '—', cols[4].w - 14) as string[]
      font(8.5, true); const client = pdf.splitTextToSize(e.client, cols[2].w - 14) as string[]
      const lines = Math.max(notes.length, client.length + (e.carrier ? 1 : 0), 1)
      const h = 10 + lines * 11
      if (y + h > BOTTOM) { newPage(); head() }
      if (i % 2) { fill(C.soft); pdf.rect(L, y, CW, h, 'F') }
      const base = y + 15
      txt(us(e.day).slice(0, 5), xs[0] + 8, base, 8.5, false, C.muted)
      pill(KIND[e.kind].replace('Service / review', 'Service'), xs[1] + 8, base, KIND_STYLE[e.kind])
      client.forEach((ln, k) => txt(ln, xs[2] + 8, base + k * 11, 8.5, true, C.ink))
      if (e.carrier) txt(e.carrier, xs[2] + 8, base + client.length * 11, 7.5, false, C.muted)
      const prem = e.kind === 'review' ? '—' : (e.kind === 'loss' ? '−' : '+') + m0(Number(e.premium)).replace('−', '-')
      txt(prem.replace('−', '-'), xs[3] + cols[3].w - 8, base, 9, true, e.kind === 'loss' ? C.red : e.kind === 'review' ? C.faint : C.green, 'right')
      notes.forEach((ln, k) => txt(ln, xs[4] + 8, base + k * 11, 8.5, false, C.ink))
      y += h
    })
    stroke(C.line); pdf.setLineWidth(0.8); pdf.line(L, y, R, y); y += 12
  }
  entries(log.filter((e) => e.day === today), 'Nothing logged today yet.')

  // the periods side by side
  section('At a glance', 'today · folio · month · year to date', 200)
  {
    const labelW = 168, cw = (CW - labelW) / periods.length
    room(30)
    box(L, y, CW, 20, C.navy, 4)
    periods.forEach((p, i) => txt(p.label.toUpperCase(), L + labelW + (i + 1) * cw - 10, y + 13, 7.5, true, [255, 255, 255], 'right'))
    y += 20
    const rows: [string, (s: (typeof stats)[number]) => string, RGB?][] = [
      ['Net Book Movement', (s) => m0(s.mv.net), C.navy],
      ['Saved premium', (s) => `${m0(s.mv.saved.p)}  (${s.mv.saved.n})`, C.green],
      ['Cross-sell premium', (s) => `${m0(s.mv.cross.p)}  (${s.mv.cross.n})`, C.teal],
      ['Lost premium', (s) => `${m0(s.mv.lost.p)}  (${s.mv.lost.n})`, C.red],
      ['Service / review calls', (s) => String(s.reviews)],
      ['At-risk touches', (s) => String(s.touches)],
      ['Live renewal conversations', (s) => String(s.convos)],
      ['Escalations contacted same day', (s) => (s.esc ? `${s.same} of ${s.esc}` : '—')],
      ['Scorecard days logged', (s) => String(s.daysLogged)],
    ]
    rows.forEach(([label, f, c], i) => {
      room(20)
      if (i % 2 === 0) { fill(C.soft); pdf.rect(L, y, CW, 19, 'F') }
      if (c) box(L + 8, y + 6, 6, 6, c, 3)
      txt(label, L + (c ? 20 : 8), y + 13, 9, i === 0, C.ink)
      stats.forEach((s, k) => txt(f(s), L + labelW + (k + 1) * cw - 10, y + 13, 9, i === 0, i === 0 ? (s.mv.net >= 0 ? C.green : C.red) : C.ink, 'right'))
      y += 19
    })
    y += 8
  }

  // ---- folio: bonus and gates ----
  if (folio && bonus) {
    section('This folio', `${us(folio.start_date)} – ${us(folio.end_date)}`, 200)
    const tiers = [...(staff?.bonus_tiers || [])].sort((a, b) => Number(a.min) - Number(b.min))
    const top = Number(tiers[tiers.length - 1]?.min || 200000)
    const cardH = 98
    room(cardH + 10)
    box(L, y, CW, cardH, C.soft, 10)
    txt('AGENCY PREMIUM WRITTEN', L + 18, y + 22, 7.5, true, C.muted)
    txt(m0(bonus.premium), L + 18, y + 50, 24, true, C.navy)
    const lvl = bonus.tier.amount ? `${m0(bonus.tier.amount)} bonus level reached` : `Bonus starts at ${m0(Number(tiers[0]?.min || 100000))}`
    txt(lvl, L + 18, y + 66, 9, true, bonus.tier.amount ? C.green : C.amber)
    const met = bonus.gates.filter((g) => g.ok).length
    pill(bonus.eligible ? 'ALL 4 GATES MET' : `${met} OF 4 GATES MET`, L + 18, y + 84, bonus.eligible ? { fg: C.green, bg: C.greenSoft } : { fg: C.amber, bg: C.amberSoft })
    // tier track
    const tx = L + 220, tw2 = CW - 240, ty = y + 44
    bar(tx, ty, tw2, bonus.premium / top, C.teal, 10)
    tiers.forEach((t) => {
      const xx = tx + tw2 * (Number(t.min) / top), hit = bonus.premium >= Number(t.min)
      fill(hit ? C.green : C.card); stroke(hit ? C.green : C.faint); pdf.setLineWidth(1.2); pdf.circle(Math.min(xx, tx + tw2 - 6), ty + 5, 6, 'FD')
      txt(m0(Number(t.amount)), Math.min(xx, tx + tw2 - 6), ty - 10, 9, true, hit ? C.green : C.ink, 'center')
      txt(`at ${m0(Number(t.min)).replace('$', '$').replace(',000', 'k')}`, Math.min(xx, tx + tw2 - 6), ty + 26, 7.5, false, C.muted, 'center')
    })
    y += cardH + 12
    // gates, two by two
    const gw2 = (CW - 10) / 2, gh2 = 38
    bonus.gates.forEach((g, i) => {
      if (i % 2 === 0) room(gh2 + 8)
      const x = L + (i % 2) * (gw2 + 10)
      box(x, y, gw2, gh2, g.ok ? C.greenSoft : C.amberSoft, 8)
      fill(g.ok ? C.green : C.amber); pdf.circle(x + 18, y + gh2 / 2, 8, 'F')
      if (g.ok) { pdf.setDrawColor(255, 255, 255); pdf.setLineWidth(1.6); pdf.line(x + 14, y + gh2 / 2, x + 17, y + gh2 / 2 + 3); pdf.line(x + 17, y + gh2 / 2 + 3, x + 22.5, y + gh2 / 2 - 3) }
      else txt('!', x + 18, y + gh2 / 2 + 3.5, 10, true, [255, 255, 255], 'center')
      txt(fit(g.label, 9, gw2 - 44, true), x + 34, y + 16, 9, true, C.ink)
      txt(fit(g.detail, 8, gw2 - 44), x + 34, y + 29, 8, false, C.muted)
      if (i % 2 === 1 || i === bonus.gates.length - 1) y += gh2 + 8
    })
    y += 4
    entries(log.filter((e) => e.day >= folio.start_date && e.day <= folio.end_date), 'Nothing logged in this folio yet.')
  }

  // ---- the year: a bar chart of Net Book Movement by month, then the numbers ----
  section(`${year} month by month`, '', 180)
  const months = [...new Set([...log.map((e) => e.day.slice(0, 7)), ...days.map((d) => d.day.slice(0, 7))])].filter((m) => m.startsWith(year)).sort()
  if (!months.length) { box(L, y, CW, 22, C.soft, 6); txt('Nothing logged this year yet.', L + 12, y + 14.5, 9, false, C.muted); y += 30 }
  else {
    const mv = months.map((m) => ({ m, ...movement(log.filter((e) => e.day.startsWith(m))), notes: log.filter((e) => e.day.startsWith(m) && e.kind === 'review').length }))
    const chartH = 110
    room(chartH + 30)
    box(L, y, CW, chartH + 24, C.soft, 10)
    const max = Math.max(1, ...mv.map((x) => Math.abs(x.net)))
    const zero = y + 14 + chartH * (mv.some((x) => x.net < 0) ? 0.6 : 0.85)
    stroke(C.line); pdf.setLineWidth(0.8); pdf.line(L + 14, zero, R - 14, zero)
    const slot = (CW - 28) / Math.max(mv.length, 6), bw = Math.min(42, slot * 0.55)
    mv.forEach((x, i) => {
      const cx = L + 14 + slot * i + slot / 2, hgt = (Math.abs(x.net) / max) * (chartH * (x.net < 0 ? 0.35 : 0.6))
      box(cx - bw / 2, x.net >= 0 ? zero - hgt : zero, bw, Math.max(hgt, 1.5), x.net >= 0 ? C.green : C.red, 3)
      txt(m0(x.net), cx, x.net >= 0 ? zero - hgt - 5 : zero + hgt + 11, 8, true, x.net >= 0 ? C.green : C.red, 'center')
      txt(new Date(x.m + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }), cx, y + chartH + 16, 8, true, C.muted, 'center')
    })
    y += chartH + 32
    const cols = ['MONTH', 'SAVED', 'CROSS-SELL', 'LOST', 'NET BOOK MOVEMENT', 'SERVICE CALLS'], cw = CW / cols.length
    room(40); box(L, y, CW, 18, C.navy, 4)
    cols.forEach((c, i) => txt(c, i ? L + (i + 1) * cw - 8 : L + 8, y + 12, 7, true, [255, 255, 255], i ? 'right' : undefined)); y += 18
    mv.forEach((x, i) => {
      room(20); if (i % 2) { fill(C.soft); pdf.rect(L, y, CW, 19, 'F') }
      const cells: [string, RGB][] = [[monthName(x.m), C.ink], [`${m0(x.saved.p)} (${x.saved.n})`, C.green], [`${m0(x.cross.p)} (${x.cross.n})`, C.teal], [`${m0(x.lost.p)} (${x.lost.n})`, C.red], [m0(x.net), x.net >= 0 ? C.green : C.red], [String(x.notes), C.violet]]
      cells.forEach(([v, c], k) => txt(v, k ? L + (k + 1) * cw - 8 : L + 8, y + 13, 9, k === 0 || k === 4, c, k ? 'right' : undefined))
      y += 19
    })
  }

  // footers
  const pages = pdf.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i)
    stroke(C.line); pdf.setLineWidth(0.8); pdf.line(L, H - 34, R, H - 34)
    txt(`${agency}  ·  Retention & Book Growth  ·  ${name}`, L, H - 20, 7.5, false, C.faint)
    txt(`Page ${i} of ${pages}`, R, H - 20, 7.5, true, C.muted, 'right')
  }
  pdf.setProperties({ title: `Retention report — ${name} — ${us(today)}` })
  pdf.save(`Retention_Report_${name.replace(/\s+/g, '_')}_${today}.pdf`)
}
