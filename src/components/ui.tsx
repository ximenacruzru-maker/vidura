import type { ReactNode } from 'react'

export function PageHead({ kicker, title, sub, right }: { kicker?: string; title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {kicker && <div className="kicker">{kicker}</div>}
        <h1>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {right && <div className="head-right">{right}</div>}
    </div>
  )
}

export function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'warn' }) {
  return (
    <div className={'tile' + (tone ? ' tile-' + tone : '')}>
      <div className="tile-l">{label}</div>
      <div className="tile-v">{value}</div>
      {sub && <div className="tile-s">{sub}</div>}
    </div>
  )
}

export function Panel({ title, sub, children, right }: { title: string; sub?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-h">
        <div>
          <div className="panel-t">{title}</div>
          {sub && <div className="panel-s">{sub}</div>}
        </div>
        {right}
      </div>
      <div className="panel-b">{children}</div>
    </section>
  )
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return <div className="loading">{what}…</div>
}

export function ErrorBox({ error }: { error: unknown }) {
  return <div className="error-box">Something went wrong loading this: {String((error as any)?.message || error)}</div>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Drawer({ open, onClose, title, sub, children }: { open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="drawer-bg" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="drawer-h">
          <div>
            <div className="panel-t">{title}</div>
            {sub && <div className="panel-s">{sub}</div>}
          </div>
          <button className="btn-ghost" onClick={onClose} aria-label="Close">Close</button>
        </div>
        <div className="drawer-b">{children}</div>
      </aside>
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: ReactNode }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={value === t.key ? 'on' : ''} onClick={() => onChange(t.key)}>{t.label}</button>
      ))}
    </div>
  )
}

export function Search({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input className="search" type="search" value={value} placeholder={placeholder || 'Search'} onChange={(e) => onChange(e.target.value)} />
}

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== '')
  if (!shown.length) return null
  return <dl className="kv">{shown.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
}

export function Tiles({ children }: { children: ReactNode }) {
  return <div className="tiles">{children}</div>
}
