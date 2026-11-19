import { useEffect, useRef, useState, type ReactNode } from 'react'

type MenuItem = { label: ReactNode; onClick: () => void; danger?: boolean }
/** A row's or page's less-used actions behind one "⋯" button (Edit, Delete, Export…), so each row shows only what's
 *  used most. Closes on a pick, a click outside or Escape. */
export function MoreMenu({ items, label = '⋯', title = 'More actions' }: { items: (MenuItem | false | null | undefined)[]; label?: ReactNode; title?: string }) {
  const [open, setOpen] = useState(false)
  // placed against the window, so a table that scrolls sideways doesn't clip it
  const [at, setAt] = useState<{ top: number; right: number } | null>(null)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const away = () => setOpen(false)
    document.addEventListener('mousedown', off); document.addEventListener('keydown', key); window.addEventListener('scroll', away, true); window.addEventListener('resize', away)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', key); window.removeEventListener('scroll', away, true); window.removeEventListener('resize', away) }
  }, [open])
  const toggle = () => {
    const r = box.current?.getBoundingClientRect()
    if (r) setAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
    setOpen(!open)
  }
  const list = items.filter((x): x is MenuItem => !!x)
  if (!list.length) return null
  return (
    <span className="mm" ref={box}>
      <button type="button" className={'mm-btn' + (open ? ' on' : '')} aria-haspopup="menu" aria-expanded={open} aria-label={title} title={title} onClick={toggle}>{label}</button>
      {open && <span className="mm-pop" role="menu" style={at ? { top: at.top, right: at.right } : undefined}>{list.map((x, i) => <button key={i} type="button" role="menuitem" className={x.danger ? 'mm-bad' : undefined} onClick={() => { setOpen(false); x.onClick() }}>{x.label}</button>)}</span>}
    </span>
  )
}

/** Explanations stay out of the way: a short line shows as is; a longer one (a sentence about how a page or figure
 *  works) sits behind a small ⓘ that opens it. Numbers and short summaries are never hidden. */
const LONG = 90
const isLong = (n: ReactNode) => typeof n === 'string' && n.length > LONG
function About({ text, label }: { text: ReactNode; label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={'about-i' + (open ? ' on' : '')} aria-expanded={open} aria-label={label} title={open ? 'Hide' : String(text)} onClick={() => setOpen(!open)}>i</button>
      {open && <div className="about-t">{text}</div>}
    </>
  )
}

/** `keep`: the page keeps its full header as designed (Team Space) — the clean look leaves it alone */
export function PageHead({ kicker, title, sub, right, keep }: { kicker?: string; title: string; sub?: ReactNode; right?: ReactNode; keep?: boolean }) {
  const tuck = !keep && isLong(sub)
  return (
    <div className={'page-head' + (keep ? ' keep' : '')}>
      <div>
        {kicker && <div className="kicker">{kicker}</div>}
        {tuck ? <div className="head-t"><h1>{title}</h1><About text={sub} label={`About ${title}`} /></div> : <h1>{title}</h1>}
        {sub && !tuck && <div className="sub">{sub}</div>}
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
          {isLong(sub) ? <div className="head-t"><div className="panel-t">{title}</div><About text={sub} label={`About ${title}`} /></div> : <div className="panel-t">{title}</div>}
          {sub && !isLong(sub) && <div className="panel-s">{sub}</div>}
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
