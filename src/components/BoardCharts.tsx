// Charts for the boards (Team Space, the Daily Huddle): horizontal stacked bars, a donut, progress rings and a calls-
// by-hour column chart. Drawn for the dark board surface with a validated palette (aqua, blue, orange — colorblind-
// safe against the board's blue), 2px gaps between stacked parts, a legend whenever there are two series, values in
// text colors (never the series color) and a tooltip on every mark.
import type { ReactNode } from 'react'

export const SERIES = { a: '#199e70', b: '#5b8def', c: '#d07a12' } as const
export type Key = { k: string; label: string; color: string }

export function Legend({ keys }: { keys: Key[] }) {
  return <div className="bc-legend">{keys.map((x) => <span key={x.k}><i style={{ background: x.color }} />{x.label}</span>)}</div>
}

/** one row per person: a stacked bar (parts by key), the total at the end, an optional note under the name */
export function HBars({ rows, keys, fmt, legend = true, max }: {
  rows: { label: string; parts: Record<string, number>; note?: ReactNode; badge?: ReactNode }[]; keys: Key[]; fmt: (n: number) => string; legend?: boolean; max?: number
}) {
  const total = (r: (typeof rows)[number]) => keys.reduce((a, x) => a + (r.parts[x.k] || 0), 0)
  const top = max || Math.max(1, ...rows.map(total))
  return (
    <div className="bc-hbars">
      {legend && keys.length > 1 && <Legend keys={keys} />}
      {rows.map((r) => {
        const t = total(r)
        return (
          <div key={r.label} className="bc-row" title={`${r.label}: ${keys.map((x) => `${fmt(r.parts[x.k] || 0)} ${x.label.toLowerCase()}`).join(' · ')}`}>
            <span className="bc-name"><span className="bc-n">{r.label}</span>{r.badge}{r.note ? <small>{r.note}</small> : null}</span>
            <span className="bc-track">{keys.map((x) => (r.parts[x.k] ? <i key={x.k} style={{ width: (r.parts[x.k] / top) * 100 + '%', background: x.color }} /> : null))}</span>
            <b className="bc-val">{fmt(t)}</b>
          </div>
        )
      })}
    </div>
  )
}

/** a donut: two or three parts with the headline in the middle */
export function Donut({ parts, center, sub, size = 132 }: { parts: { label: string; v: number; color: string }[]; center: string; sub?: string; size?: number }) {
  const total = parts.reduce((a, p) => a + p.v, 0) || 1, r = 44, c = 2 * Math.PI * r, gap = parts.filter((p) => p.v > 0).length > 1 ? 2 : 0
  let at = 0
  return (
    <div className="bc-donut">
      <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={parts.map((p) => `${p.label} ${Math.round((p.v / total) * 100)}%`).join(', ')}>
        <circle cx="60" cy="60" r={r} className="bc-donut-bg" />
        {parts.map((p) => {
          const len = Math.max(0, (p.v / total) * c - gap), el = (
            <circle key={p.label} cx="60" cy="60" r={r} fill="none" stroke={p.color} strokeWidth="14" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-at} transform="rotate(-90 60 60)">
              <title>{`${p.label}: ${Math.round((p.v / total) * 100)}%`}</title>
            </circle>)
          at += (p.v / total) * c
          return el
        })}
        <text x="60" y="58" textAnchor="middle" className="bc-donut-c">{center}</text>
        {sub && <text x="60" y="76" textAnchor="middle" className="bc-donut-s">{sub}</text>}
      </svg>
      <div className="bc-donut-key">{parts.map((p) => <span key={p.label}><i style={{ background: p.color }} />{p.label}<b>{Math.round((p.v / total) * 100)}%</b></span>)}</div>
    </div>
  )
}

/** a progress ring toward a goal (green once it's met) */
export function Ring({ value, max, label, show }: { value: number; max: number; label: string; show?: string }) {
  const p = max ? Math.min(1, value / max) : 0, r = 30, c = 2 * Math.PI * r
  return (
    <div className={'bc-ring' + (max && value >= max ? ' met' : '')} title={`${label}: ${show || `${value} of ${max}`}`}>
      <svg viewBox="0 0 80 80" role="img" aria-label={`${label} ${show || `${value} of ${max}`}`}>
        <circle cx="40" cy="40" r={r} className="bc-ring-bg" />
        <circle cx="40" cy="40" r={r} className="bc-ring-fg" strokeDasharray={`${p * c} ${c}`} transform="rotate(-90 40 40)" />
        <text x="40" y="45" textAnchor="middle">{show || value}</text>
      </svg>
      <span>{label}{max ? <em>goal {max}</em> : null}</span>
    </div>
  )
}

/** calls by hour, outbound and inbound stacked, office hours */
export function HourChart({ calls, from = 7, to = 19 }: { calls: { started_at?: string | null; direction: string | null }[]; from?: number; to?: number }) {
  const hour = (iso: string) => Number(new Date(iso).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Los_Angeles' })) % 24
  const hours = Array.from({ length: to - from + 1 }, (_, i) => from + i)
  const by = hours.map((h) => ({ h, out: 0, inb: 0 }))
  calls.forEach((c) => { if (!c.started_at) return; const x = by.find((b) => b.h === hour(c.started_at!)); if (x) { if (c.direction === 'inbound') x.inb++; else x.out++ } })
  const top = Math.max(1, ...by.map((b) => b.out + b.inb))
  const lab = (h: number) => (h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`)
  return (
    <div className="bc-hours">
      <Legend keys={[{ k: 'o', label: 'Outbound', color: SERIES.a }, { k: 'i', label: 'Inbound', color: SERIES.b }]} />
      <div className="bc-hours-plot">{by.map((b) => (
        <div key={b.h} className="bc-hour" title={`${lab(b.h)}: ${b.out} out · ${b.inb} in`}>
          <span className="bc-hour-v">{b.out + b.inb || ''}</span>
          <span className="bc-hour-track">
            {b.inb ? <i style={{ height: (b.inb / top) * 100 + '%', background: SERIES.b }} /> : null}
            {b.out ? <i style={{ height: (b.out / top) * 100 + '%', background: SERIES.a }} /> : null}
          </span>
          <span className="bc-hour-m">{lab(b.h)}</span>
        </div>
      ))}</div>
    </div>
  )
}
