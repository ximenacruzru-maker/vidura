import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { ROLE_LABEL } from '../lib/access'
import { getTeam, type StaffAccount } from '../lib/data'
import { supabase } from '../lib/supabase'
import { Icon } from './icons'

const ViewAsEditor = lazy(() => import('./ViewAsEditor'))

/** App owners (platform admins) only, top right: pick anyone on the team to see Declara exactly as they do, or a client
 *  to preview their portal. Everything stays under the owner's own login; only the screens change. */
export function ViewAsSwitcher() {
  const { me, realMe, viewAs } = useAuth()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [team, setTeam] = useState<StaffAccount[] | null>(null)
  const [clients, setClients] = useState<{ display_name: string; account_ids: string[] }[]>([])
  const [q, setQ] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open || team) return
    getTeam().then(setTeam).catch(() => setTeam([]))
    supabase.from('client_logins').select('display_name, account_ids').eq('active', true).order('display_name').then(({ data }) => setClients((data || []) as typeof clients))
  }, [open, team])
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  if (!realMe?.platform_admin) return null
  const viewing = me && me.user_id !== realMe.user_id
  const ql = q.trim().toLowerCase()
  const people = (team || []).filter((s) => s.user_id !== realMe.user_id && (!ql || `${s.display_name} ${s.role}`.toLowerCase().includes(ql)))
  const cl = clients.filter((c) => !ql || c.display_name.toLowerCase().includes(ql))
  const pick = async (id: string | null) => { setOpen(false); setQ(''); await viewAs(id) }
  return (
    <div className="va" ref={box}>
      <button className={'va-btn' + (viewing ? ' on' : '')} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title="View as — see Declara as someone on the team" aria-label="View as someone else">
        <Icon name="proteges" />{viewing && <span>Viewing as {me!.display_name.split(' ')[0]}</span>}
      </button>
      {open && (
        <div className="va-menu" role="menu">
          <input className="fld" placeholder="Search the team…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search the team" />
          <button role="menuitem" className={!viewing ? 'cur' : ''} onClick={() => pick(null)}><b>Myself</b><small>{realMe.display_name} · {ROLE_LABEL[realMe.role]}</small></button>
          <div className="va-h">Team</div>
          {!team ? <div className="va-empty">Loading…</div> : people.length ? people.map((s) => (
            <button key={s.user_id} role="menuitem" className={me?.user_id === s.user_id ? 'cur' : ''} onClick={() => pick(s.user_id)}>
              <b>{s.display_name}</b><small>{ROLE_LABEL[s.role] || s.role}{s.access?.commissions_only ? ' · My Commissions only' : ''}</small>
            </button>
          )) : <div className="va-empty">No one matches.</div>}
          {cl.length > 0 && <>
            <div className="va-h">Clients (portal preview)</div>
            {cl.map((c) => (
              <button key={c.account_ids[0]} role="menuitem" onClick={async () => { await pick(null); nav('/client-view/' + encodeURIComponent(c.account_ids[0])) }}>
                <b>{c.display_name}</b><small>Client portal</small>
              </button>
            ))}
          </>}
        </div>
      )}
    </div>
  )
}

/** Across the top while viewing as someone: who, a way to change what they can see, and the way back. */
export function ViewAsBanner() {
  const { me, realMe, viewAs } = useAuth()
  const [edit, setEdit] = useState(false)
  if (!me || !realMe || me.user_id === realMe.user_id) return null
  const first = me.display_name.split(' ')[0]
  return (
    <div className="va-band" role="status">
      <span><b>Viewing as {me.display_name}</b> · {ROLE_LABEL[me.role] || me.role} — Declara exactly as {first} sees it. Anything you change is saved under your own name.</span>
      <span className="va-band-b">
        <button className="btn-ghost" onClick={() => setEdit(true)}>Edit what {first} can see</button>
        <button className="btn-primary" onClick={() => viewAs(null)}>Back to my view</button>
      </span>
      {edit && <Suspense fallback={null}><ViewAsEditor person={me} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); viewAs(me.user_id) }} /></Suspense>}
    </div>
  )
}
