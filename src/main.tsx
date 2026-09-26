import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { applyLook, cachedLook } from './lib/theme'
import { supabase } from './lib/supabase'

/* Declara used to be called Vidura, and saved its settings in this browser under "vidura…" names. Move them to the
   new names once (theme choice, cached screens, saved plans and the per-agency stash), before anything reads them. */
function renameSavedSettings() {
  const OLD = 'vidura', NEW = 'declara'
  for (const store of [localStorage, sessionStorage]) {
    for (const k of Object.keys(store)) {
      if (!k.startsWith(OLD)) continue
      const nk = NEW + k.slice(OLD.length), v = store.getItem(k)
      if (v != null && store.getItem(nk) == null) store.setItem(nk, v.replace(/"vidura_/g, '"declara_').replace(/"theme":"vidura"/g, '"theme":"declara"'))
      store.removeItem(k)
    }
  }
}
try { renameSavedSettings() } catch { /* storage blocked (private mode): nothing to move */ }

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
