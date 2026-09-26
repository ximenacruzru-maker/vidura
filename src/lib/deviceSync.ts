// Screens keep things in localStorage under "declara_…" names: an imported AgencyZoom report, commission plan drafts,
// reconciliations, reimbursements, remembered filters, the original screens' settings. Those items are kept in the
// database (public.app_store, one row per login and name) so they are encrypted at rest and backed up; the browser
// holds only a working copy while someone is signed in:
//   • at sign-in the copy is filled from the database (items still found only on this browser are uploaded first),
//   • every change a screen makes is saved back to the database a moment later,
//   • at sign-out, or when the page opens with no one signed in, the copy is cleared.
// Only the colour theme stays on the browser; it is the person's, not the agency's.
import { supabase } from './supabase'

const OWNER = 'declara_agency'
const STASH = 'declara_stash:'
const LEGACY = STASH + 'before-agencies'
// A Claude API key used to be saved inside the commission plans; it now lives on the server (see ai-proxy).
const COMM_KEY = 'declara_comm_plans_v1'

/** Items that belong to the person on this browser rather than to the agency's data. */
const keep = (k: string) => k === OWNER || k === 'declara_look_v2' || k.startsWith(STASH)
const isData = (k: string | null): k is string => !!k && k.startsWith('declara_') && !keep(k)

let who: { agency: string; user: string } | null = null
const pending = new Map<string, string | null>()
let timer: ReturnType<typeof setTimeout> | undefined
let quiet = false

const raw = { set: Storage.prototype.setItem, remove: Storage.prototype.removeItem }
const dataKeys = () => { const out: string[] = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (isData(k)) out.push(k) } return out }
const json = <T,>(s: string | null): T | null => { try { return s == null ? null : JSON.parse(s) } catch { return null } }

/** Takes a Claude API key out of stored commission plans, returning the cleaned value and the key. */
function stripAiKey(k: string, v: string): { value: string; aiKey: string } {
  if (k !== COMM_KEY) return { value: v, aiKey: '' }
  const o = json<any>(v)
  if (!o?.ai?.key) return { value: v, aiKey: '' }
  const aiKey = String(o.ai.key)
  o.ai = { ...o.ai, key: '' }
  return { value: JSON.stringify(o), aiKey }
}

function track(k: string, v: string | null) {
  if (quiet || !who || !isData(k)) return
  if (v != null && k === COMM_KEY) {
    const s = stripAiKey(k, v)
    if (s.aiKey) { quiet = true; try { raw.set.call(localStorage, k, s.value) } finally { quiet = false } void uploadAiKey(s.aiKey, v) }
    v = s.value
  }
  pending.set(k, v)
  clearTimeout(timer); timer = setTimeout(() => { void flush() }, 800)
}

/** Watches a window's localStorage writes: this page's, and the original screens' frame (it calls this on load). */
export function watchStorage(w: Window & typeof globalThis) {
  const P = w.Storage.prototype, set = P.setItem, remove = P.removeItem, clear = P.clear
  P.setItem = function (this: Storage, k: string, v: string) { set.call(this, k, v); if (this === w.localStorage) track(String(k), String(v)) }
  P.removeItem = function (this: Storage, k: string) { remove.call(this, k); if (this === w.localStorage) track(String(k), null) }
  P.clear = function (this: Storage) { const ks = this === w.localStorage ? dataKeys() : []; clear.call(this); ks.forEach((k) => track(k, null)) }
}
watchStorage(window)
;(window as any).__declaraStore = watchStorage

/** Saves waiting changes to the database. Resolves false if any could not be saved. */
export async function flush(): Promise<boolean> {
  clearTimeout(timer)
  if (!who || !pending.size) return true
  const batch = [...pending]; pending.clear()
  const up = batch.filter(([, v]) => v != null).map(([key, value]) => ({ agency_id: who!.agency, user_id: who!.user, key, value: value!, updated_at: new Date().toISOString() }))
  const del = batch.filter(([, v]) => v == null).map(([k]) => k)
  let ok = true
  if (up.length) { const { error } = await supabase.from('app_store').upsert(up); if (error) ok = false }
  if (del.length) { const { error } = await supabase.from('app_store').delete().eq('user_id', who.user).in('key', del); if (error) ok = false }
  // Anything that failed is retried with the next change, or at sign-out.
  if (!ok) batch.forEach(([k, v]) => { if (!pending.has(k)) pending.set(k, v) })
  return ok
}

/** Clears the agency's items from this browser (and this tab's session items), keeping only the theme. */
export function clearBrowserData() {
  quiet = true
  try {
    dataKeys().forEach((k) => raw.remove.call(localStorage, k))
    for (const k of Object.keys(sessionStorage)) if (k.startsWith('declara_')) sessionStorage.removeItem(k)
  } catch { /* storage unavailable */ } finally { quiet = false }
}

async function uploadAiKey(key: string, original: string) {
  // Saving needs an admin; either way the key is not kept in the browser. If it could not be saved,
  // Settings asks an admin to enter it there.
  const model = json<any>(original)?.ai?.model || ''
  await supabase.rpc('ai_key_save', { p_key: key, p_model: model.startsWith('claude-') ? model : '' }).then(() => {}, () => {})
}

/** At sign-in: upload anything found only on this browser, then fill the browser's copy from the database. */
export async function startDeviceSync(agencyId: string, userId: string, isDemo: boolean) {
  try {
    who = { agency: agencyId, user: userId }
    const prev = localStorage.getItem(OWNER)
    // Items already on this browser that belong to this agency: the current ones when this agency used the browser
    // last, the ones set aside for it when another agency signed in since, and for a real agency the ones saved
    // before agencies existed. A different agency's current items are set aside for it until it signs in here.
    const local: Record<string, string> = {}
    const current: Record<string, string> = {}
    dataKeys().forEach((k) => { current[k] = localStorage.getItem(k)! })
    if (prev === agencyId || (!prev && !isDemo)) Object.assign(local, current)
    else if (Object.keys(current).length) raw.set.call(localStorage, prev ? STASH + prev : LEGACY, JSON.stringify(current))
    Object.assign(local, json<Record<string, string>>(localStorage.getItem(STASH + agencyId)) || {})
    if (!isDemo) Object.assign(local, json<Record<string, string>>(localStorage.getItem(LEGACY)) || {})

    const { data, error } = await supabase.from('app_store').select('key, value').eq('user_id', userId)
    if (error) throw error
    const saved = new Map((data || []).map((r) => [r.key as string, r.value as string]))
    const upload: { agency_id: string; user_id: string; key: string; value: string }[] = []
    for (const [k, v] of Object.entries(local)) {
      if (!isData(k) || saved.has(k)) continue
      const s = stripAiKey(k, v)
      if (s.aiKey) await uploadAiKey(s.aiKey, v)
      upload.push({ agency_id: agencyId, user_id: userId, key: k, value: s.value }); saved.set(k, s.value)
    }
    if (upload.length) { const { error: e } = await supabase.from('app_store').upsert(upload); if (e) throw e }
    // Uploaded: nothing of this agency's needs to stay in the browser any more.
    raw.remove.call(localStorage, STASH + agencyId)
    if (!isDemo) raw.remove.call(localStorage, LEGACY)

    clearBrowserData()
    quiet = true
    try { saved.forEach((v, k) => raw.set.call(localStorage, k, stripAiKey(k, v).value)) } finally { quiet = false }
    raw.set.call(localStorage, OWNER, agencyId)
  } catch (e) {
    // The database could not be reached: keep working with what is on the browser; changes are saved when it can be.
    console.error('Could not load saved items', e)
  }
}

/** Save anything waiting, then clear the browser's copy. Returns false (and clears nothing) if saving failed. */
export async function endDeviceSync(force = false): Promise<boolean> {
  const ok = await flush()
  if (!ok && !force) return false
  who = null; pending.clear(); clearBrowserData()
  return true
}

// Save waiting changes when the tab is hidden or closed.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flush() })
