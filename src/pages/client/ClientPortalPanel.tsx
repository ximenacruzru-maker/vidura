import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth'
import { Empty, ErrorBox, Panel } from '../../components/ui'
import { addClientItem, createClientLogin, getClientItems, listClientLogins, resetClientPassword, setClientItemStatus, setClientLoginActive, type ClientItem } from '../../lib/client'
import type { Account } from '../../lib/books'
import { isAdmin } from '../../lib/data'
import { mdy, timeAgo } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'

function tempPassword() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const b = new Uint32Array(12); crypto.getRandomValues(b)
  return Array.from(b, (n) => a[n % a.length]).join('')
}

/** On an account in Books of Business: what this client sees in their portal. Post pending items and updates (they show
 *  on the client's dashboard within seconds), preview their view, and (owners/admins) give or turn off their login. */
export default function ClientPortalPanel({ account }: { account: Account }) {
  const { me } = useAuth()
  const nav = useNavigate()
  const admin = isAdmin(me?.role)
  const [reload, setReload] = useState(0)
  const items = useAsync(() => getClientItems(account.id), [account.id, reload])
  const logins = useAsync(async () => (admin ? listClientLogins(account.id) : []), [account.id, reload, admin])
  const [f, setF] = useState({ kind: 'pending' as 'pending' | 'update', title: '', detail: '', due_on: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [give, setGive] = useState<null | { display_name: string; email: string; password: string }>(null)
  const [made, setMade] = useState<null | { email: string; password: string }>(null)

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr('')
    try { await fn(); setReload((n) => n + 1); return true } catch (e) { setErr(e instanceof Error ? e.message : String(e)); return false } finally { setBusy(false) }
  }
  const post = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!f.title.trim()) return setErr('Give it a title the client will understand.')
    if (await run(() => addClientItem({ account_id: account.id, kind: f.kind, title: f.title.trim(), detail: f.detail.trim(), due_on: f.due_on || null }))) setF({ kind: f.kind, title: '', detail: '', due_on: '' })
  }
  const list = items.data || []
  const open = list.filter((i) => i.status === 'open'), done = list.filter((i) => i.status === 'done')

  return (
    <Panel title="Client portal" sub="What this client sees when they sign in — live. Your internal notes never show there."
      right={<button className="btn-ghost" onClick={() => nav('/client-view/' + encodeURIComponent(account.id))}>Preview client view</button>}>
      {err && <div className="cp-err">{err}</div>}

      <div className="cp-adm-h">Pending items & updates shown to the client</div>
      <form className="cp-adm-form" onSubmit={post}>
        <select className="fld" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as 'pending' | 'update' })} aria-label="Type">
          <option value="pending">Pending (needs doing)</option><option value="update">Update (FYI)</option>
        </select>
        <input className="fld" placeholder="e.g. Sign the autopay form for Xpress Gas & Mart 5 WC" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="Title" maxLength={200} />
        <input className="fld" type="date" value={f.due_on} onChange={(e) => setF({ ...f, due_on: e.target.value })} aria-label="Due date (optional)" title="Due date (optional)" />
        <textarea className="fld" placeholder="Details for the client (optional)" value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} rows={2} aria-label="Details" />
        <button className="btn-primary" disabled={busy}>Post to client</button>
      </form>
      {items.error ? <ErrorBox error={items.error} /> : !items.data ? null : list.length ? (
        <div className="cp-adm-items">
          {[...open, ...done].map((i: ClientItem) => (
            <div key={i.id} className={'cp-adm-item' + (i.status === 'done' ? ' done' : '')}>
              <span className={'pill ' + (i.status === 'done' ? 'pill-good' : i.kind === 'pending' ? 'pill-warn' : 'pill-muted')}>{i.status === 'done' ? 'Done' : i.kind === 'pending' ? 'Pending' : 'Update'}</span>
              <div><b>{i.title}</b>{i.detail && <div className="sub">{i.detail}</div>}<div className="sub">{i.due_on ? `due ${mdy(i.due_on)} · ` : ''}posted {timeAgo(i.created_at)}{i.created_by ? ` by ${i.created_by}` : ''}</div></div>
              <button className="btn-ghost" disabled={busy} onClick={() => run(() => setClientItemStatus(i.id, i.status === 'done' ? 'open' : 'done'))}>{i.status === 'done' ? 'Reopen' : 'Mark done'}</button>
            </div>
          ))}
        </div>
      ) : <Empty>Nothing posted yet. Renewal alerts, statuses and documents show on their own.</Empty>}

      {admin && <>
        <div className="cp-adm-h">Client login</div>
        {logins.error ? <ErrorBox error={logins.error} /> : (logins.data || []).map((c) => (
          <div key={c.user_id} className="cp-adm-item">
            <span className={'pill ' + (c.active ? 'pill-good' : 'pill-muted')}>{c.active ? 'Active' : 'Off'}</span>
            <div><b>{c.display_name}</b><div className="sub">{c.email} · {c.last_sign_in_at ? `last signed in ${timeAgo(c.last_sign_in_at)}` : 'hasn’t signed in yet'}{c.must_change_password ? ' · will choose a password at first sign-in' : ''}</div></div>
            <div className="cp-adm-btns">
              <button className="btn-ghost" disabled={busy} onClick={() => { const pw = tempPassword(); run(() => resetClientPassword(c.user_id, pw)).then((ok) => ok && setMade({ email: c.email, password: pw })) }}>New temp password</button>
              <button className="btn-ghost" disabled={busy} onClick={() => confirm(c.active ? `Turn off ${c.display_name}'s portal login?` : `Turn ${c.display_name}'s portal login back on?`) && run(() => setClientLoginActive(c.user_id, !c.active))}>{c.active ? 'Turn off' : 'Turn on'}</button>
            </div>
          </div>
        ))}
        {logins.data && !logins.data.length && !give && (
          <button className="btn-primary" onClick={() => setGive({ display_name: account.contact || account.name, email: '', password: tempPassword() })}>Give {account.contact?.split(' ')[0] || 'this client'} portal access</button>
        )}
        {give && (
          <form className="cp-adm-form" onSubmit={async (e) => {
            e.preventDefault()
            const g = give
            if (await run(() => createClientLogin({ account_ids: [account.id], email: g.email, display_name: g.display_name, password: g.password }))) { setMade({ email: g.email, password: g.password }); setGive(null) }
          }}>
            <input className="fld" placeholder="Client's name" value={give.display_name} onChange={(e) => setGive({ ...give, display_name: e.target.value })} aria-label="Client's name" />
            <input className="fld" type="email" placeholder="Client's email (their login)" value={give.email} onChange={(e) => setGive({ ...give, email: e.target.value })} aria-label="Client's email" required />
            <input className="fld mono" value={give.password} onChange={(e) => setGive({ ...give, password: e.target.value })} aria-label="Temporary password" />
            <button className="btn-primary" disabled={busy}>Create login</button>
            <button type="button" className="btn-ghost" onClick={() => setGive(null)}>Cancel</button>
          </form>
        )}
        {made && (
          <div className="note-box">Give the client their sign-in (it isn’t emailed): <b>{location.origin + location.pathname}</b> · email <b>{made.email}</b> · temporary password <b className="mono">{made.password}</b>. They choose their own password the first time they sign in. <button className="linkbtn" onClick={() => setMade(null)}>Hide</button></div>
        )}
      </>}
    </Panel>
  )
}
