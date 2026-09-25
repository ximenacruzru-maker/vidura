import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { getMe, type StaffAccount } from './lib/data'
import { loadLook } from './lib/theme'
import { claimBrowserStorage } from './lib/agencyStorage'
import logo from './assets/logo.png'

interface AuthState {
  session: Session | null
  me: StaffAccount | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthCtx = createContext<AuthState>({ session: null, me: null, loading: true, signOut: async () => {} })
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [me, setMe] = useState<StaffAccount | null>(null)
  const [loading, setLoading] = useState(true)
  const uid = useRef<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      // A different person signed in (another tab, or after sign-out): start from a clean page so no
      // screen keeps data it loaded for the previous login.
      if (uid.current && s?.user?.id && s.user.id !== uid.current) { location.reload(); return }
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    let alive = true
    if (!session) { setMe(null); setLoading(false); return }
    uid.current = session.user.id
    setLoading(true)
    getMe().then((m) => {
      if (!alive) return
      if (m) claimBrowserStorage(m.agency_id, !!m.agency?.is_demo)
      setMe(m); setLoading(false)
    })
    loadLook(session.user.id).catch(() => {})
    return () => { alive = false }
  }, [session?.user?.id])

  // Reload after signing out so nothing the screens loaded stays in memory for the next login.
  const signOut = async () => { await supabase.auth.signOut(); location.reload() }

  return <AuthCtx.Provider value={{ session, me, loading, signOut }}>{children}</AuthCtx.Provider>
}

export function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState(() => { const e = sessionStorage.getItem('vx_auth_error') || ''; sessionStorage.removeItem('vx_auth_error'); return e })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const forgot = async () => {
    setErr(''); setMsg('')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setErr('Type your email above first, then click “Forgot password?”.'); return }
    setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname })
    setBusy(false)
    if (error) setErr(error.message); else setMsg('If that email has a login, a reset link is on its way. Check your inbox (and spam); the link works for one hour.')
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setErr(error.message === 'Invalid login credentials' ? 'That email and password don’t match a staff account.' : error.message)
    setBusy(false)
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <img src={logo} alt="Vidura" className="login-logo" />
        <div className="login-sub">Agency staff sign-in</div>
        <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button className="btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="linkbtn" style={{ alignSelf: 'center' }} onClick={forgot} disabled={busy}>Forgot password?</button>
        {err && <div className="login-err">{err}</div>}
        {msg && <div className="note" style={{ textAlign: 'center', margin: 0 }}>{msg}</div>}
      </form>
    </div>
  )
}
