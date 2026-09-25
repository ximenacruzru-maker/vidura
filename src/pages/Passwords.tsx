import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { Drawer, Empty, ErrorBox, Loading, PageHead, Panel, Search } from '../components/ui'
import { isAdmin } from '../lib/data'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'
import PasswordImport from '../components/PasswordImport'
import { getReference } from '../lib/books'
import { loginsFor } from '../lib/logins'

interface Login { id: string; grp: string; name: string; url: string | null; username: string | null; notes: string | null; has_secret: boolean; updated_by: string | null; updated_at: string }
interface LogRow { id: number; login_name: string | null; action: string; by_name: string | null; at: string }
const GROUPS = ['Carriers & wholesalers', 'Raters & agency tools', 'Leads & marketing', 'Banking & payments', 'Social media', 'Office & IT', 'Other']
const blank = { id: null as string | null, grp: 'Carriers & wholesalers', name: '', url: '', username: '', notes: '', password: '' }
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })

export default function Passwords({ embedded = false }: { embedded?: boolean }) {
  const { me } = useAuth()
  const admin = isAdmin(me?.role)
  const [reload, setReload] = useState(0)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState('all')
  const [edit, setEdit] = useState<typeof blank | null>(null)
  const [shown, setShown] = useState<Record<string, string>>({})
  const [toast, setToast] = useState('')

  const { data, error } = useAsync(async () => {
    const [l, g, mk] = await Promise.all([
      supabase.from('agency_logins').select('*').order('grp').order('name'),
      admin ? supabase.from('agency_login_log').select('*').order('at', { ascending: false }).limit(25) : Promise.resolve({ data: [], error: null }),
      getReference<any[]>('markets').catch(() => []),
    ])
    if (l.error) throw l.error
    const logins = (l.data || []) as Login[]
    // carrier logos, borrowed from the carrier markets list
    const carriers = (mk || []).flatMap((m: any) => m.carriers || []).filter((c: any) => c.logo)
    const logo: Record<string, string> = {}
    for (const x of logins) { const c = carriers.find((c: any) => loginsFor([x], c).length); if (c) logo[x.id] = c.logo }
    return { logins, log: ((g as any).data || []) as LogRow[], logo }
  }, [reload])

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2500); return () => clearTimeout(t) }, [toast])

  const reveal = async (id: string) => {
    const { data, error } = await supabase.rpc('agency_login_reveal', { p_id: id })
    if (error) { alert(error.message); return null }
    return (data as string | null) || ''
  }
  const show = async (id: string) => {
    if (shown[id] != null) { setShown(({ [id]: _, ...rest }) => rest); return }
    const v = await reveal(id); if (v == null) return
    setShown((s) => ({ ...s, [id]: v }))
    setTimeout(() => setShown(({ [id]: _, ...rest }) => rest), 20000)
  }
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); setToast(`${what} copied`) } catch { setToast('Copy blocked by the browser') } }
  const copyPw = async (id: string) => { const v = shown[id] ?? (await reveal(id)); if (v != null) copy(v, 'Password') }

  const save = async () => {
    if (!edit) return
    const { error } = await supabase.rpc('agency_login_save', { p_id: edit.id, p_grp: edit.grp, p_name: edit.name, p_url: edit.url, p_username: edit.username, p_notes: edit.notes, p_password: edit.password || null })
    if (error) { alert(error.message); return }
    setEdit(null); setShown({}); setReload((n) => n + 1); setToast('Saved')
  }
  const remove = async (l: Login) => {
    if (!confirm(`Delete the ${l.name} login? This can’t be undone.`)) return
    const { error } = await supabase.from('agency_logins').delete().eq('id', l.id)
    if (error) alert(error.message); else { setEdit(null); setReload((n) => n + 1) }
  }

  const head = embedded ? null : <PageHead kicker="Agency management" title="Agency passwords" sub="Carrier portals and agency systems. Passwords are encrypted, and every view is logged." />
  if (error) return <>{head}<ErrorBox error={error} /></>
  if (!data) return <>{head}<Loading /></>

  const ql = q.toLowerCase()
  const list = data.logins.filter((l) => !ql || `${l.grp} ${l.name} ${l.url} ${l.username} ${l.notes}`.toLowerCase().includes(ql))
  const allGroups = [...new Set([...GROUPS, ...data.logins.map((l) => l.grp)])].filter((g) => data.logins.some((l) => l.grp === g))
  const groups = allGroups.filter((g) => (only === 'all' || only === g) && list.some((l) => l.grp === g))

  return (
    <>
      {head}
      <div className="filters" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <Search value={q} onChange={setQ} placeholder="Search carrier, site or username" />
        {admin && <div className="row-actions"><PasswordImport existing={data.logins} onDone={() => setReload((n) => n + 1)} /><button className="btn-primary" onClick={() => setEdit({ ...blank })}>+ Add login</button></div>}
      </div>
      {data.logins.length > 0 && (
        <div className="pw-pills">
          <button className={only === 'all' ? 'on' : ''} onClick={() => setOnly('all')}>All <em>{data.logins.length}</em></button>
          {allGroups.map((g) => <button key={g} className={only === g ? 'on' : ''} onClick={() => setOnly(g)}>{g} <em>{data.logins.filter((l) => l.grp === g).length}</em></button>)}
        </div>
      )}
      {!data.logins.length ? (
        <Panel title="Nothing saved yet">
          <Empty>{admin ? 'Add each carrier portal and agency system with “Add login”. Type the current password in yourself — it is encrypted as soon as you save.' : 'An admin hasn’t added any logins yet.'}</Empty>
        </Panel>
      ) : !list.length ? <Empty>No login matches “{q}”.</Empty> : groups.map((g) => (
        <Panel key={g} title={g} sub={`${list.filter((l) => l.grp === g).length} logins`}>
          <div className="cards">
            {list.filter((l) => l.grp === g).map((l) => {
              const href = l.url ? (/^https?:/i.test(l.url) ? l.url : 'https://' + l.url) : null
              return (
                <div key={l.id} className="card pw-card">
                  <div className="pw-top">
                    {data.logo[l.id] ? <img className="carrier-logo" src={data.logo[l.id]} alt={l.name} /> : <span className="pw-ico">{l.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()}</span>}
                    {admin && <button className="linkbtn" style={{ marginLeft: 'auto' }} onClick={() => setEdit({ id: l.id, grp: l.grp, name: l.name, url: l.url || '', username: l.username || '', notes: l.notes || '', password: '' })}>Edit</button>}
                  </div>
                  <div className="card-t">{l.name}</div>
                  {href && <a href={href} target="_blank" rel="noreferrer" className="pw-link">{l.url!.replace(/^https?:\/\//, '').replace(/\/$/, '')} ↗</a>}
                  <div className="creds">
                    <div className="creds-r"><span className="creds-k">User</span>
                      {l.username ? <><span className="mono creds-v">{l.username}</span><button className="linkbtn" onClick={() => copy(l.username!, 'Username')}>Copy</button></> : <span className="sub creds-v">not set</span>}</div>
                    <div className="creds-r"><span className="creds-k">Pass</span>
                      {l.has_secret ? <><span className="mono creds-v">{shown[l.id] != null ? shown[l.id] : '••••••••••'}</span>
                        <button className="linkbtn" onClick={() => show(l.id)}>{shown[l.id] != null ? 'Hide' : 'Show'}</button>
                        <button className="linkbtn" onClick={() => copyPw(l.id)}>Copy</button></> : <span className="sub creds-v">not set</span>}</div>
                    {l.notes && <div className="sub creds-note">{l.notes}</div>}
                  </div>
                  <div className="sub pw-upd">🔒 Encrypted · updated {when(l.updated_at)}{l.updated_by ? ` by ${l.updated_by}` : ''}</div>
                </div>
              )
            })}
          </div>
        </Panel>
      ))}

      {admin && data.log.length > 0 && (
        <Panel title="Recent activity" sub="Who viewed or changed a login — admins only">
          <table className="tbl"><tbody>{data.log.map((r) => (
            <tr key={r.id}><td className="sub">{when(r.at)}</td><td><b>{r.by_name || 'Someone'}</b> {r.action} <b>{r.login_name}</b></td></tr>
          ))}</tbody></table>
        </Panel>
      )}
      <p className="note">{admin ? `Staff see ${embedded ? 'this tab' : 'this page'} only when you switch on “Agency passwords” for them under Settings › Producers & access. Only admins can add, change or delete logins.` : 'Only admins can add or change logins.'}</p>

      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit login' : 'Add login'} sub="The password is encrypted in the database the moment you save.">
        {edit && (
          <form className="pw-form" onSubmit={(e) => { e.preventDefault(); save() }} autoComplete="off">
            <label>Group<input className="fld" list="pw-groups" value={edit.grp} onChange={(e) => setEdit({ ...edit, grp: e.target.value })} />
              <datalist id="pw-groups">{[...new Set([...GROUPS, ...data.logins.map((l) => l.grp)])].map((g) => <option key={g} value={g} />)}</datalist></label>
            <label>Name<input className="fld" required placeholder="e.g. Bamboo Insurance agent portal" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label>Website<input className="fld" placeholder="https://" value={edit.url} onChange={(e) => setEdit({ ...edit, url: e.target.value })} /></label>
            <label>Username<input className="fld" autoComplete="off" value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value })} /></label>
            <label>Password<PwInput value={edit.password} onChange={(v) => setEdit({ ...edit, password: v })} placeholder={edit.id ? 'Leave blank to keep the current password' : ''} /></label>
            <label>Notes<textarea className="fld" rows={3} placeholder="Agent code, security questions hint, who to call…" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></label>
            <div className="row-actions" style={{ justifyContent: 'space-between', marginTop: 6 }}>
              {edit.id ? <button type="button" className="btn-ghost" style={{ color: 'var(--bad)' }} onClick={() => remove(data.logins.find((l) => l.id === edit.id)!)}>Delete</button> : <span />}
              <button className="btn-primary">Save</button>
            </div>
          </form>
        )}
      </Drawer>
      {toast && <div className="toast">{toast}</div>}
    </>
  )
}

function PwInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [vis, setVis] = useState(false)
  return (
    <span className="pw-in">
      <input className="fld" type={vis ? 'text' : 'password'} autoComplete="new-password" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="linkbtn" onClick={() => setVis(!vis)}>{vis ? 'Hide' : 'Show'}</button>
    </span>
  )
}
