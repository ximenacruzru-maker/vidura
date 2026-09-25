import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { applyLook, cachedLook } from './lib/theme'
import { supabase } from './lib/supabase'

applyLook(cachedLook())

/* Password-reset and invite links land here as #access_token=…&type=recovery. Sign the person in
   with that token, remember that they need to choose a password, and clean the address bar. */
async function handleAuthLink() {
  const h = location.hash.replace(/^#\/?/, '')
  if (!/(^|&)(access_token|error)=/.test(h)) return
  const p = new URLSearchParams(h)
  history.replaceState(null, '', location.pathname + '#/')
  if (p.get('error')) { sessionStorage.setItem('vx_auth_error', p.get('error_description') || 'That link has expired. Ask for a new one.'); return }
  const at = p.get('access_token'), rt = p.get('refresh_token')
  if (at && rt) {
    await supabase.auth.setSession({ access_token: at, refresh_token: rt })
    if (p.get('type') === 'recovery' || p.get('type') === 'invite') sessionStorage.setItem('vx_recovery', '1')
  }
}

handleAuthLink().finally(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
))
