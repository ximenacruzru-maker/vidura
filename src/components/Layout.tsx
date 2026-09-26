import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { can, ROLE_LABEL } from '../lib/access'
import { agencyName } from '../lib/data'
import { bookLabel, getAccounts, getBookPolicies, type Account, type BookPolicy } from '../lib/books'
import { money0 } from '../lib/format'
import logo from '../assets/logo.jpg'
import logoHalloween from '../assets/logo-halloween.jpg'
import { getLook, onLook } from '../lib/theme'
import { Icon } from './icons'
import LegacyHost, { LEGACY_ROUTES } from './LegacyHost'
import SyncControl from './SyncControl'
import VidaAI from './VidaAI'
import ForesightAI from './ForesightAI'

type Item = { h: string } | { div: true } | { to: string; label: string; icon: string; show: boolean; also?: string[] }

/** The app shell, laid out like the original Vidura platform: one sidebar, four sections. */
export default function Layout({ children }: { children: ReactNode }) {
  const { me, signOut } = useAuth()
  const { pathname } = useLocation()
  const go = useNavigate()
  const [visited, setVisited] = useState(false)
  const [menu, setMenu] = useState(false)
  // The seasonal Halloween theme has its own logo; every other theme shows the DECLARA tile.
  const [theme, setTheme] = useState(getLook().theme)
  useEffect(() => onLook((l) => setTheme(l.theme)), [])
  useEffect(() => { if (LEGACY_ROUTES[pathname]) setVisited(true); setMenu(false) }, [pathname])

  const c = (k: string) => can(me, k)
  const first = (me?.display_name || '').split(' ')[0]
  const nav: Item[] = [
    { h: 'Workspace' },
    { to: '/today', label: first ? `${first}’s Space` : 'My Space', icon: 'today', show: true },
    { to: '/work', label: 'Work & Tickets', icon: 'tickets', show: c('work') },
    { to: '/chat', label: 'Team Chat', icon: 'chat', show: c('chat') },
    { to: '/pay', label: 'My Pay', icon: 'reports', show: !(me?.role === 'owner' || me?.role === 'admin') },
    { div: true },
    { h: 'Performance' },
    { to: '/', label: 'Executive Dashboard', icon: 'executive', show: c('performance'), also: ['/legacy-dashboard'] },
    { to: '/sales', label: 'Sales KPIs', icon: 'sales', show: c('performance'), also: ['/huddle'] },
    { to: '/reports', label: 'Reports', icon: 'reports', show: c('performance'), also: ['/commissions', '/sdr'] },
    { h: 'Agency Management' },
    { to: '/resources', label: 'Agency Resources', icon: 'service', show: c('resources') || c('passwords') },
    { to: '/books/farmers', label: 'Books of Business', icon: 'book', show: c('books'), also: ['/books'] },
    { h: 'Team Development' },
    { to: '/training', label: 'Training', icon: 'training', show: c('training') },
    { to: '/hr', label: c('hr') ? 'HR / Licensing' : 'Licensing', icon: 'licensing', show: true },
    { to: '/proteges', label: 'Proteges', icon: 'proteges', show: c('proteges') },
    { div: true },
    { to: '/settings', label: 'Settings', icon: 'settings', show: true },
  ]
  const visible = nav.filter((n, i) => {
    if ('to' in n) return n.show
    if ('div' in n) return true
    for (const x of nav.slice(i + 1)) { if (!('to' in x)) return false; if (x.show) return true }
    return false
  })
  const isOn = (n: { to: string; also?: string[] }) =>
    n.to === '/' ? pathname === '/' || (n.also || []).includes(pathname) : pathname === n.to || pathname.startsWith(n.to + '/') || (n.also || []).some((a) => pathname === a || pathname.startsWith(a + '/'))
  const initials = (me?.display_name || '?').split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase()
  const legacy = c('performance') && !!LEGACY_ROUTES[pathname]

  return (
    <div className="shell">
      <aside className="side">
        <div className="side-brand">
          <div className="brand-tile"><img className="brand-logo" src={theme === 'halloween' ? logoHalloween : logo} alt="Declara" /></div>
          <p className="side-for">For</p>
          <p className="side-sub">{agencyName(me)}</p>
        </div>
        <nav className="nav">
          {visible.map((n, i) => ('h' in n ? <div key={n.h} className="nav-h" data-sec={n.h}>{n.h}</div>
            : 'div' in n ? <div key={'d' + i} className="nav-div" />
              : (
                <button key={n.to} className={isOn(n) ? 'active' : ''} onClick={() => go(n.to)}>
                  <Icon name={n.icon} /><span>{n.label}</span>
                </button>
              )))}
        </nav>
        <div className="side-foot">
          <button className="logout" onClick={signOut} title="Sign out"><Icon name="logout" width={1.5} /><span>Sign Out</span></button>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          {c('books') ? <GlobalSearch /> : <div />}
          <div className="hd-right">
          {c('performance') && <SyncControl />}
          <VidaAI />
          {c('performance') && <ForesightAI />}
          <div className="hd-user">
            <span className="hd-av">{initials}</span>
            <span className="hd-un"><b>{me?.display_name || 'Signed in'}</b><em>{ROLE_LABEL[me?.role || ''] || ''}</em></span>
            <button className="hd-chev" aria-label="Account menu" onClick={() => setMenu(!menu)}><Icon name="chev" width={2} /></button>
            {menu && (
              <div className="hd-menu" onMouseLeave={() => setMenu(false)}>
                <button onClick={() => go('/settings')}>Settings &amp; appearance</button>
                <button onClick={() => go('/password')}>Change password</button>
                <button onClick={signOut}>Sign out</button>
              </div>
            )}
          </div>
          </div>
        </header>
        {/* The original performance screens stay loaded once opened, so switching back is instant. */}
        {c('performance') && (legacy || visited) && <LegacyHost path={pathname} />}
        {!legacy && <main className="page">{children}</main>}
      </div>
    </div>
  )
}

/* ---------- search: policy number or business name, across the P&C book ---------- */
interface Hit { account: Account; policy: BookPolicy; num: string; score: number }
const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

function GlobalSearch() {
  const go = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const [idx, setIdx] = useState<{ accounts: Account[]; policies: BookPolicy[] } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const load = () => { if (!idx) Promise.all([getAccounts(), getBookPolicies()]).then(([accounts, policies]) => setIdx({ accounts, policies })).catch(() => {}) }
  useEffect(() => {
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [])
  const hits = useMemo<Hit[]>(() => {
    const n = norm(q)
    if (!idx || n.length < 2) return []
    const acct = new Map(idx.accounts.map((a) => [a.id, a]))
    const out: Hit[] = []
    for (const p of idx.policies) {
      const a = acct.get(p.account_id); if (!a) continue
      const i = norm(`${p.policy_number} ${a.name} ${a.dba} ${p.insured} ${p.location}`).indexOf(n); if (i < 0) continue
      const num = norm(p.policy_number || '')
      out.push({ account: a, policy: p, num: p.policy_number || '', score: (num === n ? 0 : num.startsWith(n) ? 1 : 2) * 1000 + i })
    }
    return out.sort((x, y) => x.score - y.score).slice(0, 30)
  }, [q, idx])
  const pick = (h: Hit) => { setOpen(false); setQ(''); go(`/books/${h.account.book}?open=${encodeURIComponent(h.account.id)}`) }
  let last = ''
  return (
    <div className="gsearch" ref={box}>
      <span className="gsearch-ico"><Icon name="search" width={1.7} /></span>
      <input className="gq" type="text" autoComplete="off" spellCheck={false} placeholder="Search policy number or business name…" aria-label="Search the P&C book"
        value={q} onFocus={load}
        onChange={(e) => { setQ(e.target.value); setSel(0); setOpen(true); load() }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setOpen(false); (e.target as HTMLInputElement).blur() }
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
          if (e.key === 'Enter' && hits[sel]) pick(hits[sel])
        }} />
      {q && <button className="gclear" onClick={() => { setQ(''); setOpen(false) }} title="Clear search">×</button>}
      {open && norm(q).length >= 2 && (
        <div className="gres">
          {!idx ? <div className="gempty">Loading the book…</div>
            : !hits.length ? <div className="gempty">No policy or business matches that.</div>
              : hits.map((h, i) => {
                const lbl = bookLabel(h.account.book)
                const head = lbl !== last ? (last = lbl) : null
                return (
                  <div key={h.policy.id}>
                    {head && <div className="ghead">{head}</div>}
                    <button className={'gitem' + (i === sel ? ' sel' : '')} onMouseEnter={() => setSel(i)} onClick={() => pick(h)}>
                      <span><span className="gname">{h.account.name}</span><span className="gsub">{h.policy.product || 'Policy'} · {h.policy.carrier}</span></span>
                      <span className="gright"><span className="gnum">{h.num}</span><span className="gsub">{h.policy.premium == null ? '—' : money0(h.policy.premium)}</span></span>
                    </button>
                  </div>
                )
              })}
        </div>
      )}
    </div>
  )
}
