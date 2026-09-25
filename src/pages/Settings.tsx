import { Fragment, useState } from 'react'
import { useAuth } from '../auth'
import { Empty, ErrorBox, Loading, PageHead, Panel } from '../components/ui'
import { FONTS, getLook, onLook, saveLook, THEMES, type Look } from '../lib/theme'
import ChangePassword from './ChangePassword'
import { useEffect } from 'react'
import { can, ROLE_LABEL, roleDefaults, SECTIONS } from '../lib/access'
import type { Role, StaffAccount } from '../lib/data'
import { timeAgo } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

type Row = StaffAccount & { last_sign_in_at: string | null }
const ROLES: Role[] = ['owner', 'admin', 'producer', 'protege', 'sdr', 'csr']

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('staff-admin', { body })
  if (error) {
    let msg = error.message
    try { msg = (await (error as any).context?.json())?.error || msg } catch { /* not JSON */ }
    throw new Error(msg)
  }
  return data
}

/** Team & access: add logins, change roles, switch sections on/off, turn people off — no code needed. */
function TeamAccess() {
  const { me } = useAuth()
  const [reload, setReload] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const { data, error } = useAsync(async () => (await call({ action: 'list' })).staff as Row[], [reload])

  const run = async (body: Record<string, unknown>, done: string) => {
    setBusy(true); setNote('')
    try { await call(body); setNote(done); setReload((n) => n + 1) } catch (e: any) { alert(e.message) } finally { setBusy(false) }
  }

  return (
    <>
      {note && <div className="note-box" style={{ marginBottom: 12 }}>{note}</div>}
      <Panel title="Staff logins" sub={data ? `${data.filter((s) => s.active).length} active` : undefined}
        right={<button className="btn-primary" onClick={() => setAdding(!adding)}>{adding ? 'Cancel' : '+ Add staff member'}</button>}>
        {adding && <AddForm busy={busy} ownerCanAdd={me?.role === 'owner'} onSave={(b) => run({ action: 'create', ...b }, `${b.display_name} can now sign in with ${b.email} and the temporary password you set. They’ll be asked to choose their own password the first time.`).then(() => setAdding(false))} />}
        {error ? <ErrorBox error={error} /> : !data ? <Loading /> : data.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Name</th><th>Role</th><th>Can open</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.map((s) => (
                  <Fragment key={s.user_id}>
                    <tr className="clickable" onClick={() => setOpen(open === s.user_id ? null : s.user_id)}>
                      <td><div className="strong">{s.display_name}{s.user_id === me?.user_id ? ' (you)' : ''}</div><div className="sub">{s.email}</div></td>
                      <td>{ROLE_LABEL[s.role] || s.role}</td>
                      <td className="sub">{SECTIONS.filter((x) => can(s, x.key)).map((x) => x.label.split(' (')[0]).join(', ')}</td>
                      <td className="sub">{s.last_sign_in_at ? timeAgo(s.last_sign_in_at) : 'never'}{s.must_change_password ? ' · temp password' : ''}</td>
                      <td><span className={'pill ' + (s.active ? 'pill-good' : 'pill-muted')}>{s.active ? 'Active' : 'Off'}</span></td>
                      <td className="r"><button className="linkbtn">{open === s.user_id ? 'Close' : 'Edit'}</button></td>
                    </tr>
                    {open === s.user_id && (
                      <tr className="detail"><td colSpan={6}>
                        <EditRow s={s} self={s.user_id === me?.user_id} ownerMe={me?.role === 'owner'} busy={busy}
                          onSave={(patch, msg) => run({ action: 'update', user_id: s.user_id, ...patch }, msg)}
                          onReset={(pw) => run({ action: 'reset_password', user_id: s.user_id, password: pw }, `Temporary password set for ${s.display_name}. Give it to them privately; they’ll choose a new one when they sign in.`)} />
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>No staff yet.</Empty>}
        <p className="note">Admins and owners can open everything and manage this page. For everyone else, the role sets the starting access and the switches fine-tune it.</p>
      </Panel>
    </>
  )
}

function Switches({ role, access, onChange }: { role: Role; access: Record<string, boolean>; onChange: (a: Record<string, boolean>) => void }) {
  const full = role === 'owner' || role === 'admin'
  const d = roleDefaults(role)
  const adminOnly = (k: string) => k === 'performance'
  return (
    <div className="access-grid">
      {SECTIONS.map((x) => {
        const on = full ? true : adminOnly(x.key) ? false : x.key in access ? access[x.key] : d[x.key]
        return (
          <label key={x.key} className={'access-item' + (full || adminOnly(x.key) ? ' locked' : '')}>
            <input type="checkbox" checked={on} disabled={full || adminOnly(x.key)} onChange={(e) => {
              const next = { ...access }
              if (e.target.checked === d[x.key]) delete next[x.key]; else next[x.key] = e.target.checked
              onChange(next)
            }} />
            <span><b>{x.label}</b><small>{x.note}</small></span>
          </label>
        )
      })}
    </div>
  )
}

function tempPassword() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const b = new Uint32Array(12); crypto.getRandomValues(b)
  return Array.from(b, (n) => a[n % a.length]).join('')
}

function AddForm({ busy, ownerCanAdd, onSave }: { busy: boolean; ownerCanAdd: boolean; onSave: (b: { email: string; display_name: string; role: Role; producer_name: string; password: string; access: Record<string, boolean> }) => Promise<void> }) {
  const [f, setF] = useState({ email: '', display_name: '', role: 'producer' as Role, producer_name: '', password: tempPassword(), access: {} as Record<string, boolean> })
  return (
    <div className="plan">
      <div className="form-grid">
        <label>Full name<input className="fld" value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></label>
        <label>Email (their login)<input className="fld" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label>Role<select className="fld" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role, access: {} })}>
          {ROLES.filter((r) => r !== 'owner' || ownerCanAdd).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
        <label>Name in AgencyZoom (producers)<input className="fld" placeholder="e.g. Samuel Sweet" value={f.producer_name} onChange={(e) => setF({ ...f, producer_name: e.target.value })} /></label>
        <label>Temporary password<input className="fld" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
      </div>
      <div className="plan-l" style={{ marginTop: 14 }}>What they can open</div>
      <Switches role={f.role} access={f.access} onChange={(access) => setF({ ...f, access })} />
      <div className="row-actions" style={{ marginTop: 12 }}>
        <button className="btn-primary" disabled={busy} onClick={() => onSave(f)}>{busy ? 'Adding…' : 'Add staff member'}</button>
      </div>
      <p className="note">Give them the temporary password privately. The first time they sign in, Declara asks them to set their own.</p>
    </div>
  )
}

function EditRow({ s, self, ownerMe, busy, onSave, onReset }: { s: Row; self: boolean; ownerMe: boolean; busy: boolean; onSave: (patch: Record<string, unknown>, msg: string) => void; onReset: (pw: string) => void }) {
  const [role, setRole] = useState<Role>(s.role)
  const [access, setAccess] = useState<Record<string, boolean>>(s.access || {})
  const [name, setName] = useState(s.display_name)
  const [prod, setProd] = useState(s.producer_name || '')
  const [pw, setPw] = useState('')
  const locked = s.role === 'owner' && !ownerMe
  if (locked) return <p className="note">Only an owner can change an owner’s account.</p>
  return (
    <div>
      <div className="form-grid">
        <label>Name<input className="fld" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Role<select className="fld" value={role} disabled={self} onChange={(e) => { setRole(e.target.value as Role); setAccess({}) }}>
          {ROLES.filter((r) => r !== 'owner' || ownerMe || s.role === 'owner').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
        <label>Name in AgencyZoom<input className="fld" value={prod} onChange={(e) => setProd(e.target.value)} /></label>
      </div>
      {self && <p className="note">You can’t change your own role or turn off your own login.</p>}
      <div className="plan-l" style={{ marginTop: 14 }}>What they can open</div>
      <Switches role={role} access={access} onChange={setAccess} />
      <div className="row-actions" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn-primary" disabled={busy} onClick={() => onSave({ display_name: name, role, access, producer_name: prod }, `Saved ${name}.`)}>Save changes</button>
        {!self && <button className="btn-ghost" disabled={busy} onClick={() => {
          if (confirm(s.active ? `Turn off ${s.display_name}'s login? They won't be able to sign in until you turn it back on.` : `Turn ${s.display_name}'s login back on?`))
            onSave({ active: !s.active }, s.active ? `${s.display_name} can no longer sign in.` : `${s.display_name} can sign in again.`)
        }}>{s.active ? 'Turn off login' : 'Turn login back on'}</button>}
        {!self && <span className="row-actions">
          <input className="fld" style={{ width: 190 }} placeholder="New temporary password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className="btn-ghost" disabled={busy || pw.length < 8} onClick={() => { onReset(pw); setPw('') }}>Set temporary password</button>
          <button className="linkbtn" onClick={() => setPw(tempPassword())}>generate</button>
        </span>}
      </div>
    </div>
  )
}


/** Settings, laid out like the original platform: a band, underlined tabs, then the section. */
export default function Settings() {
  const { me } = useAuth()
  const admin = me?.role === 'owner' || me?.role === 'admin'
  const [tab, setTab] = useState<'appearance' | 'access' | 'password'>('appearance')
  const [look, setLookState] = useState<Look>(getLook())
  const people = useAsync(async () => {
    if (!admin) return null
    const { count } = await supabase.from('staff_accounts').select('*', { count: 'exact', head: true }).eq('active', true)
    return count ?? 0
  }, [admin])
  useEffect(() => onLook(setLookState), [])
  const tabs: [typeof tab, string][] = [['appearance', 'Appearance'], ...(admin ? [['access', 'Producers & access'] as [typeof tab, string]] : []), ['password', 'Password']]
  return (
    <>
      <PageHead kicker="Administration" title="Settings" sub={`${THEMES[look.theme]?.name || 'Declara Blue'} theme${admin && people.data != null ? ` · ${people.data} on the account` : ''}`} />
      <div className="set-band">
        <div><div className="eye">Agency configuration</div><h2>Settings</h2></div>
        <div className="set-stats">
          <div><small>Theme</small><b>{THEMES[look.theme]?.name}</b></div>
          <div><small>Typeface</small><b>{FONTS[look.font]?.name.split(' ')[0]}</b></div>
          {admin && people.data != null && <div><small>People</small><b>{people.data}</b></div>}
        </div>
      </div>
      <div className="set-tabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'appearance' && <Appearance look={look} userId={me?.user_id || ''} />}
      {tab === 'access' && admin && <TeamAccess />}
      {tab === 'password' && <ChangePassword embedded />}
    </>
  )
}

function Appearance({ look, userId }: { look: Look; userId: string }) {
  const [err, setErr] = useState('')
  const pick = async (next: Look) => { setErr(''); try { await saveLook(userId, next) } catch (e: any) { setErr('Couldn’t save that for next time: ' + (e?.message || e)) } }
  return (
    <>
      {err && <div className="error-box" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="p2">
        <section className="panel">
          <div className="panel-h"><div><div className="panel-t">Colour theme</div><div className="panel-s">Your own colours — changes the whole platform for you, nobody else</div></div></div>
          <div className="panel-b">
            {Object.entries(THEMES).map(([k, t]) => (
              <div key={k} className={'th-r' + (look.theme === k ? ' th-on' : '')} tabIndex={0} role="button"
                onClick={() => pick({ ...look, theme: k })} onKeyDown={(e) => e.key === 'Enter' && pick({ ...look, theme: k })}>
                <div className="th-sw">{t.swatch.map((c) => <i key={c} style={{ background: c }} />)}</div>
                <div className="th-n">{t.name}{t.note && <span className="th-s">{t.note}</span>}</div>
                <div className="th-c">{look.theme === k ? 'In use' : 'Use'}</div>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-h"><div><div className="panel-t">Typeface</div><div className="panel-s">Display face for names, headings and figures</div></div></div>
          <div className="panel-b">
            {Object.entries(FONTS).map(([k, f]) => (
              <div key={k} className={'th-r' + (look.font === k ? ' th-on' : '')} tabIndex={0} role="button"
                onClick={() => pick({ ...look, font: k })} onKeyDown={(e) => e.key === 'Enter' && pick({ ...look, font: k })}>
                <div className="th-fp" style={{ fontFamily: f.serif }}>Aa</div>
                <div className="th-n">{f.name}<span className="th-s">{f.note}</span></div>
                <div className="th-c">{look.font === k ? 'In use' : 'Use'}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="band-note">Everyone on the team picks their own theme and typeface. The choice is saved to your login, so it follows you to any computer and changes nothing for anyone else.</div>
    </>
  )
}
