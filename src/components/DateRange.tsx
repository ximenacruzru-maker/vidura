/** From / To date pickers shown beside a period dropdown when "Custom range" is picked. */
export interface Range { from: string; to: string }

export function DateRange({ value, onChange, className = 'fld' }: { value: Range; onChange: (r: Range) => void; className?: string }) {
  return (
    <span className="date-range">
      <label>From <input type="date" className={className} value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} /></label>
      <label>To <input type="date" className={className} value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} /></label>
    </span>
  )
}

/** The range to use: both ends in order, blanks filled with the fallback (swapped if entered backwards). */
export function resolveRange(r: Range, fallback: Range): Range {
  const from = r.from || fallback.from, to = r.to || fallback.to
  return from <= to ? { from, to } : { from: to, to: from }
}
