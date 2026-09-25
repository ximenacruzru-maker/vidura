import { useState } from 'react'
import { useAuth } from '../auth'
import { supabase } from '../lib/supabase'
import logo from '../assets/logo.jpg'

/** Set your own password. Shown automatically after signing in with a temporary password. */
export default function ChangePassword({ forced, embedded, onDone }: { forced?: boolean; embedded?: boolean; onDone?: () => void }) {
  const { me, signOut } = useAuth()
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (a.length < 8) { setErr('Use at least 8 characters.'); return }
    if (a !== b) { setErr('The two passwords don’t match.'); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: a })
    if (error) { setErr(error.message); setBusy(false); return }
    await supabase.rpc('password_changed')
    setBusy(false); setOk(true); setA(''); setB('')
    onDone?.()
  }
  const form = (
    <form className={forced ? 'login-card' : 'panel-b pw-card'} onSubmit={submit} style={forced ? undefined : { display: 'flex', flexDirection: 'column', gap: 12 }}>
      {forced && <img src={logo} alt="Declara" className="login-logo" />}
      {forced && <div className="login-sub">Welcome{me?.display_name ? ', ' + me.display_name.split(' ')[0] : ''} — choose your password</div>}
      <label>New password<input className="fld" type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} required /></label>
      <label>Type it again<input className="fld" type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} required /></label>
      <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
      {err && <div className="login-err">{err}</div>}
      {ok && !forced && <div className="note">Password changed.</div>}
      {forced && <button type="button" className="btn-ghost" onClick={signOut}>Sign out</button>}
    </form>
  )
  if (embedded) return <section className="panel"><div className="panel-h"><div><div className="panel-t">Change your password</div><div className="panel-s">At least 8 characters</div></div></div>{form}</section>
  return forced ? <div className="login">{form}</div> : (
    <>
      <div className="page-head"><div><div className="kicker">Account</div><h1>Change password</h1></div></div>
      <section className="panel">{form}</section>
    </>
  )
}
