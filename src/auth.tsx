import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { getMe, getStaffMember, type StaffAccount } from './lib/data'
import { loadLook } from './lib/theme'
import { clearBrowserData, endDeviceSync, startDeviceSync } from './lib/deviceSync'
import logo from './assets/login-logo.jpg'
import { COPYRIGHT } from './lib/format'

interface AuthState {
  session: Session | null
  /** Who the screens are drawn for: the signed-in person, or the team member an app owner is viewing as. */
  me: StaffAccount | null
  /** The person actually signed in (differs from me only while an app owner views as someone). */
  realMe: StaffAccount | null
  loading: boolean
  signOut: () => Promise<void>
  /** App owners (platform admins) only: see Declara as another team member; null goes back to themselves. */
  viewAs: (userId: string | null) => Promise<void>
}

const AuthCtx = createContext<AuthState>({ session: null, me: null, realMe: null, loading: true, signOut: async () => {}, viewAs: async () => {} })
const VIEW_AS = 'declara_view_as'
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [me, setMe] = useState<StaffAccount | null>(null)
  const [as, setAs] = useState<StaffAccount | null>(null)
  const [loading, setLoading] = useState(true)
  const uid = useRef<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      // Opened with no one signed in (signed out elsewhere, or the sign-in expired): nothing of an agency's stays here.
      if (!data.session) clearBrowserData()
      setSession(data.session)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      // Signed out in another tab: this tab stops saving and clears its copy too.
      if (e === 'SIGNED_OUT') void endDeviceSync(true)
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
    getMe().then(async (m) => {
      if (!alive) return
      // Fill the browser's working copy before any screen reads it.
      if (m) await startDeviceSync(m.agency_id, session.user.id, !!m.agency?.is_demo)
      if (!alive) return
      // an app owner who was viewing as someone keeps that view on reload (this tab only)
      let target: StaffAccount | null = null
      const keep = (() => { try { return sessionStorage.getItem(VIEW_AS) } catch { return null } })()
      if (m?.platform_admin && keep && keep !== m.user_id) target = await getStaffMember(keep).catch(() => null)
      if (!alive) return
      setMe(m); setAs(target); setLoading(false)
    })
    loadLook(session.user.id).catch(() => {})
    return () => { alive = false }
  }, [session?.user?.id])

  // Save what is waiting, clear the agency's items from the browser, then reload so nothing the screens loaded
  // stays in memory for the next login.
  const signOut = async () => {
    if (!(await endDeviceSync()) && !confirm('Your latest changes could not be saved (check the connection). Sign out anyway and lose them?')) return
    await endDeviceSync(true)
    await supabase.auth.signOut(); location.reload()
  }

  const viewAs = async (userId: string | null) => {
    if (!me?.platform_admin) return
    const target = userId && userId !== me.user_id ? await getStaffMember(userId) : null
    try { if (target) sessionStorage.setItem(VIEW_AS, target.user_id); else sessionStorage.removeItem(VIEW_AS) } catch { /* private window */ }
    setAs(target)
    location.hash = '#/'
  }
  // While viewing as someone: their role, sections and names, under the owner's agency — and none of the owner's extras.
  const shown = me && as ? { ...as, agency: me.agency, platform_admin: false, must_change_password: false } : me

  return <AuthCtx.Provider value={{ session, me: shown, realMe: me, loading, signOut, viewAs }}>{children}</AuthCtx.Provider>
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
        <img src={logo} alt="Declara" className="login-logo" />
        <div className="login-sub">Sign in</div>
        <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button className="btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <button type="button" className="linkbtn" style={{ alignSelf: 'center' }} onClick={forgot} disabled={busy}>Forgot password?</button>
        {err && <div className="login-err">{err}</div>}
        {msg && <div className="note" style={{ textAlign: 'center', margin: 0 }}>{msg}</div>}
        <div className="copy-note">{COPYRIGHT}</div>
      </form>
    </div>
  )
}
