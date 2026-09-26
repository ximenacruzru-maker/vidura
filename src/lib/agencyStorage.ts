// Browser storage belongs to one agency at a time. Screens keep things in localStorage (an imported
// AgencyZoom report, commission drafts, remembered filters, the original screens' settings). When a
// login from a different agency signs in on this browser, the previous agency's items are set aside
// under "declara_stash:<agency>" and the new agency's are put back, so nothing crosses agencies and
// nothing is lost. The colour theme and the sign-in session are the person's, not the agency's.
const OWNER = 'declara_agency'
const STASH = 'declara_stash:'
const LEGACY = STASH + 'before-agencies'
const personal = (k: string) => k === OWNER || k === 'declara_look_v2' || k.startsWith(STASH) || k.startsWith('sb-')

export function claimBrowserStorage(agencyId: string, isDemo: boolean) {
  try {
    const prev = localStorage.getItem(OWNER)
    if (prev === agencyId) return
    const items: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (!personal(k)) items[k] = localStorage.getItem(k)! }
    // Items saved before agencies existed belong to the original agency: a demo login never adopts them.
    if (prev || isDemo) {
      if (Object.keys(items).length) localStorage.setItem(prev ? STASH + prev : LEGACY, JSON.stringify(items))
      Object.keys(items).forEach((k) => localStorage.removeItem(k))
      const back = localStorage.getItem(STASH + agencyId) ?? (isDemo ? null : localStorage.getItem(LEGACY))
      if (back) Object.entries(JSON.parse(back) as Record<string, string>).forEach(([k, v]) => localStorage.setItem(k, v))
      localStorage.removeItem(STASH + agencyId)
      if (!isDemo && back && !localStorage.getItem(STASH + agencyId)) localStorage.removeItem(LEGACY)
    }
    localStorage.setItem(OWNER, agencyId)
  } catch { /* storage unavailable (private mode): nothing is kept, so nothing can cross over */ }
}
