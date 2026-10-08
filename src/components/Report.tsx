// Report building blocks laid out like the PDF reports: a section with a teal marker, and goal cards with a progress bar.
// The styles are the .rp-* rules in styles.css; a page using them wraps its content in <div className="rp">.
import type { ReactNode } from 'react'

/** A report section: a colored marker, the title and a hairline, like the PDF. */
export function Section({ title, sub, right, children }: { title: string; sub?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rp-sec">
      <div className="rp-sec-h"><div className="rp-sec-t"><h2>{title}</h2>{sub && <span>{sub}</span>}</div>{right}</div>
      {children}
    </section>
  )
}

/** A goal card: the label, the number against its goal, and a progress bar (or a note). */
export function GoalCard({ label, show, pct, good, limit, note, tone, neutral }: { label: string; show: string; pct?: number; good: boolean; limit?: boolean; note?: string; tone?: 'teal' | 'violet'; neutral?: boolean }) {
  const p = Math.max(0, Math.min(1, pct ?? 0))
  return (
    <div className={'rp-card' + (good ? ' good' : '') + (limit && p > 0.8 ? ' warn' : '') + (tone ? ' t-' + tone : '') + (neutral ? ' neutral' : '')}>
      <div className="rp-k">{label}</div>
      <div className="rp-card-v">{show}</div>
      {note != null ? <div className="rp-card-note">{note}</div> : <div className="rp-bar"><i style={{ width: p * 100 + '%' }} /></div>}
    </div>
  )
}
