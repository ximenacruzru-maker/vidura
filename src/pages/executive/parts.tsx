// Cards, meters and inline-SVG charts for the Executive Dashboard. Markup and class names follow the
// original screen one-for-one so the scoped legacy stylesheet (executive.css) styles them unchanged.
import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { money0, type Bar, type Month } from '../../lib/perf/executive'

/* ---------- icons ---------- */
const V = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', viewBox: '0 0 24 24' } as const
const F = { ...V, strokeWidth: 2.1 } as const
export const ICO: Record<string, ReactNode> = {
  money: <svg {...V}><path d="M12 2.6v18.8M16.6 6.6c0-1.7-2-2.9-4.6-2.9S7.4 4.9 7.4 6.6s2 2.5 4.6 3.1 4.6 1.4 4.6 3.3-2 3.2-4.6 3.2-4.6-1.2-4.6-3" /></svg>,
  renew: <svg {...V}><path d="M20.5 12a8.5 8.5 0 1 1-2.5-6M20.5 3.5v5h-5" /></svg>,
  doc: <svg {...V}><rect x="5" y="2.8" width="14" height="18.4" rx="2.2" /><path d="M8.8 8h6.4M8.8 12h6.4M8.8 16h4.2" /></svg>,
  people: <svg {...V}><circle cx="9.2" cy="8" r="3.3" /><path d="M2.8 20.2a6.4 6.4 0 0 1 12.8 0" /><path d="M16.4 5.4a3 3 0 0 1 0 5.6M18.2 20.2a5.6 5.6 0 0 0-2-4.2" /></svg>,
  clock: <svg {...V}><circle cx="12" cy="12" r="8.8" /><path d="M12 6.8v5.4l3.4 2.1" /></svg>,
  pct: <svg {...V}><path d="M19 5 5 19" /><circle cx="7.6" cy="7.6" r="2.6" /><circle cx="16.4" cy="16.4" r="2.6" /></svg>,
  flag: <svg {...V}><path d="M5.4 21V3.4M5.4 3.4h11.2l-2.2 4 2.2 4H5.4" /></svg>,
  cal: <svg {...V}><rect x="3.4" y="5" width="17.2" height="15.6" rx="2.2" /><path d="M3.4 10h17.2M8.4 3v4M15.6 3v4" /></svg>,
  dollar: <svg {...F}><path d="M12 2.2v19.6" /><path d="M16.8 6.6c0-1.9-2.1-3.1-4.8-3.1S7.2 4.7 7.2 6.7s2.1 2.7 4.8 3.3 4.8 1.5 4.8 3.5-2.1 3.4-4.8 3.4-4.8-1.3-4.8-3.2" /></svg>,
  users: <svg {...F}><circle cx="8.6" cy="8.4" r="3.4" /><path d="M2.6 20a6 6 0 0 1 12 0" /><path d="M16.2 5.4a3.1 3.1 0 0 1 0 6M21.4 20a5.6 5.6 0 0 0-3.4-4.6" /></svg>,
  warn: <svg {...F}><path d="M12 3.6 2.4 20.4h19.2z" /><path d="M12 9.4v4.6" /><path d="M12 17.4v.05" /></svg>,
  bars: <svg {...F}><path d="M4 20V4" /><path d="M4 20h16" /><rect x="7" y="13" width="3" height="4" rx="0.6" /><rect x="12" y="9.5" width="3" height="7.5" rx="0.6" /><rect x="17" y="6" width="3" height="11" rx="0.6" /></svg>,
  trend: <svg {...F}><path d="M3.4 17.6 9.6 11l3.6 3.6 6.6-6.6" /><path d="M15.2 8h4.6v4.6" /></svg>,
  shield: <svg {...F}><path d="M12 3l8 3v6c0 4.4-3.2 8.3-8 9-4.8-.7-8-4.6-8-9V6zM9 12l2 2 4-4" /></svg>,
  coin: <svg {...F}><circle cx="12" cy="12" r="8.6" /><path d="M12 7.6v8.8M14.4 9.6c0-1-1.1-1.6-2.4-1.6s-2.4.6-2.4 1.5 1.1 1.4 2.4 1.7 2.4.8 2.4 1.8-1.1 1.6-2.4 1.6-2.4-.6-2.4-1.6" /></svg>,
  target: <svg {...F}><circle cx="12" cy="12" r="8.4" /><circle cx="12" cy="12" r="4.6" /><circle cx="12" cy="12" r="1.2" /></svg>,
}

/* ---------- score card ---------- */
type Tone = 'good' | 'warn' | 'bad'
export function Gauge({ pct, tone }: { pct: number; tone?: Tone }) {
  const p = Math.max(0, Math.min(100, pct || 0)), R = 26, C = 2 * Math.PI * R
  const col = tone === 'bad' ? '#A83E4B' : tone === 'warn' ? '#C08438' : '#1F7A57'
  return (
    <svg className="gg" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r={R} fill="none" stroke="var(--pale)" strokeWidth="7" />
      <circle cx="32" cy="32" r={R} fill="none" stroke={col} strokeWidth="7" strokeLinecap="round" strokeDasharray={(C * p / 100).toFixed(1) + ' ' + C.toFixed(1)} transform="rotate(-90 32 32)" />
      <text x="32" y="36" textAnchor="middle" className="gg-t">{Math.round(p)}%</text>
    </svg>
  )
}

export interface CardProps {
  icon: ReactNode; iconClass?: string; label: string; value: number | null; display?: string; why?: string
  drill?: string; onDrill?: (id: string) => void; goalLine?: string; pct?: number | null; tone?: Tone
  delta?: { tone?: string; arrow?: string; value: string }; goalNote?: string; sub?: string
}
/** Metrics the platform can compute show a gauge against a goal; metrics that need data it doesn't hold
 *  say "No data" and why, rather than showing a plausible-looking number. */
export function ScoreCard(o: CardProps) {
  if (o.value == null) {
    return (
      <div className="sc sc-nd">
        <div className="sc-h"><span className="sc-i">{o.icon}</span><div className="sc-l">{o.label}</div><span className="sc-nb">No data</span></div>
        <div className="sc-v sc-dash">&mdash;</div><div className="sc-s">{o.why || ''}</div>
      </div>
    )
  }
  const open = o.drill && o.onDrill ? () => o.onDrill!(o.drill!) : undefined
  const d = o.delta
  return (
    <div className={'sc' + (open ? ' sc-click' : '')} {...(open ? {
      tabIndex: 0, role: 'button', 'aria-label': 'View details for ' + o.label, onClick: open,
      onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } },
    } : {})}>
      <div className="sc-top"><span className={'sc-i ' + (o.iconClass || '')}>{o.icon}</span><div className="sc-l">{o.label}</div></div>
      <div className="sc-body">
        <div className="sc-v">{o.display}</div>
        {o.goalLine && <div className="sc-goal">{o.goalLine}</div>}
        <div className="sc-foot">
          <div className="sc-g">{o.pct != null && <Gauge pct={o.pct} tone={o.tone} />}</div>
          <div className="sc-delta">
            {d && <div className={'sc-dv ' + (d.tone || '')}>{(d.arrow || '') + ' ' + d.value}</div>}
            <div className="sc-gt">{o.goalNote || o.sub || ''}</div>
          </div>
        </div>
      </div>
      {open && <div className="sc-more">View details<span aria-hidden="true">&rsaquo;</span></div>}
    </div>
  )
}

/* ---------- bars and meters ---------- */
const CH_MUTE = '#9BA2FE', CH_GRID = '#E8ECFA', CH_ACCENT = '#4d60ff'

/** Horizontal bars, one hue, optionally emphasising the first (dominant) row. */
export function Bars({ items, emphasis, onGo }: { items: Bar[]; emphasis?: boolean; onGo?: (b: Bar) => void }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div className="hb">
      {items.map((it, n) => {
        const go = it.go && onGo ? () => onGo(it) : undefined
        return (
          <div key={it.label + n} className={'hb-row' + (go ? ' hb-click' : '')} {...(go ? { tabIndex: 0, onClick: go } : {})}>
            <div className="hb-l" title={it.label}>{it.label}{it.sub && <span className="hb-sub">{it.sub}</span>}</div>
            <div className="hb-track"><div className="hb-fill" style={{ width: ((it.value / max) * 100).toFixed(1) + '%', background: emphasis ? (n === 0 ? CH_ACCENT : CH_MUTE) : CH_ACCENT }} /></div>
            <div className="hb-v">{money0(it.value)}{it.pct != null && <span className="hb-pct">{it.pct.toFixed(0)}%</span>}</div>
          </div>
        )
      })}
    </div>
  )
}

export function Meter({ label, num, den, note, tone }: { label: string; num: number; den: number; note?: string | null; tone: Tone }) {
  const pct = den ? (num / den) * 100 : 0
  const col = tone === 'bad' ? CH_ACCENT : tone === 'warn' ? '#C08438' : '#1F7A57'
  return (
    <div className="mtr">
      <div className="mtr-top"><span className="mtr-l">{label}</span><span className="mtr-v">{Math.round(pct)}%</span></div>
      <div className="mtr-track"><div className="mtr-fill" style={{ width: pct.toFixed(1) + '%', background: col }} /></div>
      <div className="mtr-s">{num} of {den}{note ? <> &middot; {note}</> : ''}</div>
    </div>
  )
}

/* ---------- renewal chart ---------- */
/** Keeps the floating chart tooltip inside the window, as chShow did. */
function ChartTip({ tip }: { tip: { x: number; y: number; html: ReactNode } | null }) {
  const el = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  useLayoutEffect(() => {
    if (!tip || !el.current) return
    const r = el.current.getBoundingClientRect()
    setPos({ left: Math.min(window.innerWidth - r.width - 12, Math.max(8, tip.x + 14)), top: Math.max(8, tip.y - r.height - 12) })
  }, [tip])
  return <div ref={el} className="chtip" style={{ display: tip ? 'block' : 'none', left: pos.left, top: pos.top }}>{tip?.html}</div>
}

const BOOKS = ['Commercial', 'Farmers', 'Retail'] as const
/** Grouped bars per book with a readiness line on a second axis; mode "count" plots policies, "prem" premium. */
export function RenewalChart({ months, mode, colors, bookName }: { months: Month[]; mode: string; colors: Record<string, string>; bookName: Record<string, string> }) {
  const [tip, setTip] = useState<{ x: number; y: number; html: ReactNode } | null>(null)
  const isC = mode !== 'prem'
  const val = (m: Month, bk: typeof BOOKS[number]) => (isC ? m[('c' + bk) as 'cCommercial'] : m[bk])
  const tot = (m: Month) => (isC ? m.n : m.total)
  const W = 940, H = 250, PL = 54, PR = 54, PT = 18, PB = 34
  const iw = W - PL - PR, ih = H - PT - PB
  const max = Math.max(1, ...months.map(tot))
  const raw = max / 4, mag = Math.pow(10, Math.floor(Math.log10(raw) || 0))
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) || 10 * mag
  const top = Math.ceil(max / step) * step
  const band = iw / months.length
  const gw = Math.min(30, band - 12), bw = Math.max(3, (gw - 4) / 3)
  const y = (v: number) => PT + ih - (v / top) * ih
  const yr = (p: number) => PT + ih - (p / 100) * ih
  const fmt = (v: number) => (isC ? String(Math.round(v)) : v >= 1000 ? '$' + (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : '$' + Math.round(v))
  const show = (html: ReactNode) => (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, html })
  const hide = () => setTip(null)
  const pts = months.map((m, i) => (m.ready == null ? null : [PL + band * i + band / 2, yr(m.ready)])).filter(Boolean) as number[][]
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} className="ch" role="img" aria-label="Policies coming up for renewal by month and book, with the share that carry a premium">
        {[0, 1, 2, 3, 4].map((i) => {
          const v = (top * i) / 4, yy = y(v)
          return (
            <Fragment key={'g' + i}>
              <line x1={PL} x2={W - PR} y1={yy} y2={yy} stroke={CH_GRID} strokeWidth="1" />
              <text x={PL - 9} y={yy + 4} textAnchor="end" className="ch-ax">{fmt(v)}</text>
              <text x={W - PR + 9} y={yy + 4} textAnchor="start" className="ch-ax">{i * 25}%</text>
            </Fragment>
          )
        })}
        {months.map((m, i) => {
          const cx = PL + band * i + band / 2, x0 = cx - gw / 2
          return (
            <Fragment key={m.key}>
              {BOOKS.map((bk, bi) => {
                const v = val(m, bk); if (v <= 0) return null
                const x = x0 + bi * (bw + 2), yy = y(v), hh = Math.max(2, y(0) - yy)
                return (
                  <rect key={bk} x={x} y={yy} width={bw} height={hh} rx="2.5" fill={colors[bk]} tabIndex={0} className="ch-seg"
                    onMouseMove={show(<>{m.label} {m.year} &middot; {bookName[bk]}: <b>{isC ? v + (v === 1 ? ' policy' : ' policies') : money0(v)}</b></>)}
                    onMouseLeave={hide} onFocus={hide}>
                    <title>{m.label + ' ' + m.year + ' ' + bookName[bk] + ' ' + (isC ? v + ' policies' : money0(v))}</title>
                  </rect>
                )
              })}
              <text x={cx} y={H - 12} textAnchor="middle" className="ch-ax">{m.label}</text>
            </Fragment>
          )
        })}
        {pts.length > 1 && <polyline points={pts.map((p) => p[0] + ',' + p[1]).join(' ')} fill="none" stroke="#060672" strokeWidth="2" strokeLinejoin="round" />}
        {months.map((m, i) => m.ready == null ? null : (
          <circle key={'r' + m.key} cx={PL + band * i + band / 2} cy={yr(m.ready)} r="3.6" fill="#060672" tabIndex={0} className="ch-seg"
            onMouseMove={show(<>{m.label} {m.year} &middot; <b>{m.ready.toFixed(0)}%</b> priced</>)} onMouseLeave={hide} onFocus={hide}>
            <title>{m.label + ' ' + m.year + ' ' + m.ready.toFixed(0) + '% priced'}</title>
          </circle>
        ))}
        <line x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} stroke="#C7CEF6" strokeWidth="1" />
        <text x="14" y={PT + ih / 2} transform={`rotate(-90 14 ${PT + ih / 2})`} textAnchor="middle" className="ch-ax">{isC ? 'Policies' : 'Premium'}</text>
        <text x={W - 13} y={PT + ih / 2} transform={`rotate(90 ${W - 13} ${PT + ih / 2})`} textAnchor="middle" className="ch-ax">Priced (%)</text>
      </svg>
      <ChartTip tip={tip} />
    </>
  )
}

/* ---------- day chart and donut ---------- */
export function DayChart({ title, sub, money, series }: { title: string; sub?: string; money?: boolean; series: { label: string; value: number; text?: string }[] }) {
  const max = Math.max(...series.map((x) => x.value || 0), 1)
  return (
    <div className="panel">
      <div className="panel-h"><div><div className="panel-t">{title}</div><div className="panel-s">{sub || ''}</div></div></div>
      <div className="panel-b">
        <div className="dchart">
          {series.map((x, i) => (
            <div key={x.label + i} className="dbar-w" title={x.label + ': ' + (x.text != null ? x.text : money ? money0(x.value || 0) : String(x.value || 0))}>
              <div className="dbar" style={{ height: Math.max(2, ((x.value || 0) / max) * 100).toFixed(1) + '%' }} />
              <span className="dbar-l">{x.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const DONUT = ['var(--bistre)', '#01BCAF', '#F79009', '#8b5cf6', '#12B76A', '#FE454E', '#6b7280', '#0ea5e9']
export function Donut({ rows, colors = DONUT, center, centerSub }: { rows: { label: string; value: number }[]; colors?: string[]; center?: string; centerSub?: string }) {
  const total = rows.reduce((a, r) => a + r.value, 0) || 1
  const R = 42, C = 2 * Math.PI * R
  let acc = 0
  return (
    <div className="donut">
      <svg viewBox="0 0 120 120" width="120" height="120">
        {rows.map((r, i) => {
          const f = r.value / total, dash = f * C, off = C * (1 - acc)
          acc += f
          return (
            <circle key={r.label + i} r={R} cx="60" cy="60" fill="none" stroke={colors[i % colors.length]} strokeWidth="16"
              strokeDasharray={dash.toFixed(2) + ' ' + (C - dash).toFixed(2)} strokeDashoffset={off.toFixed(2)} transform="rotate(-90 60 60)">
              <title>{r.label + ' ' + Math.round(f * 100) + '%'}</title>
            </circle>
          )
        })}
        <text x="60" y="58" textAnchor="middle" fontSize="17" fontWeight="800" fill="#071477">{center != null ? center : rows.length ? Math.round((rows[0].value / total) * 100) + '%' : ''}</text>
        <text x="60" y="74" textAnchor="middle" fontSize="8.5" fill="#516fd4">{centerSub || (rows[0] ? rows[0].label : '')}</text>
      </svg>
      <div className="donut-l">
        {rows.map((r, i) => (
          <div key={r.label + i} className="donut-r"><i style={{ background: colors[i % colors.length] }} /><span>{r.label}</span><b>{money0(r.value)}</b><em>{Math.round((r.value / total) * 100)}%</em></div>
        ))}
      </div>
    </div>
  )
}
