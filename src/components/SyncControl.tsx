import { useCallback, useEffect, useRef, useState } from 'react'
import { getLastSync } from '../lib/data'
import { timeAgo } from '../lib/format'
import { supabase } from '../lib/supabase'
import { Icon } from './icons'
import { useAuth } from '../auth'

const LIMIT = 3
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })

/** Top-right sync status plus the "Refresh" button: 3 forced refreshes per rolling 24 hours, agency-wide.
 *  The hourly sync (Mon–Fri, 8 AM – 5 PM Pacific) keeps running regardless. */
export default function SyncControl() {
  const [sync, setSync] = useState<{ finished_at: string | null; status: string; error?: string | null; last_ok?: string | null } | null>(null)
  const [uses, setUses] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const { me } = useAuth()
  const demo = !!me?.agency?.is_demo, connected = !!me?.agency?.agencyzoom_sync

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const [s, r] = await Promise.all([
      getLastSync(),
      supabase.from('force_refresh_log').select('requested_at').gt('requested_at', since).order('requested_at'),
    ])
    setSync(s)
    setUses(((r.data || []) as { requested_at: string }[]).map((x) => x.requested_at))
    return s
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 5 * 60 * 1000); return () => clearInterval(t) }, [load])
  useEffect(() => {
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [])

  const left = Math.max(0, LIMIT - uses.length)
  const nextAt = left === 0 && uses[0] ? new Date(new Date(uses[0]).getTime() + 24 * 3600 * 1000).toISOString() : null
  const bad = sync?.status === 'error'

  const run = async () => {
    if (demo) { setMsg('This is a demo agency with sample data, so there is nothing to pull. In a live agency, Refresh pulls the latest from AgencyZoom.'); setOpen(true); return }
    if (!confirm(`Pull fresh AgencyZoom data now?\n\nThis uses 1 of ${LIMIT} force refreshes allowed in 24 hours (${left} left).`)) return
    setBusy(true); setMsg('')
    const before = sync?.finished_at || ''
    const { data, error } = await supabase.functions.invoke('agencyzoom-refresh', { body: {} })
    if (error) {
      let body: any = null
      try { body = await (error as any).context?.json() } catch { /* not JSON */ }
      setMsg(body?.error === 'limit' && body.next_at ? `Limit reached — next refresh ${fmtWhen(body.next_at)}` : 'Couldn’t start the refresh: ' + (body?.error || error.message))
      setOpen(true); setBusy(false); load(); return
    }
    setMsg(`Refreshing… (${data?.left ?? left - 1} left today)`)
    // Watch for the sync to finish (usually 1–2 minutes).
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 10000))
      const s = await load()
      if (s?.finished_at && s.finished_at > before) { setMsg(s.status === 'error' ? 'Refresh failed — see the message above' : 'Refreshed — reload a page to see new numbers'); break }
    }
    setBusy(false)
  }

  const label = busy ? 'Refreshing…' : bad ? 'Sync failing' : `Synced ${timeAgo(sync?.finished_at || null)}`
  return (
    <div className="tsync" ref={box}>
      <button className={'tsync-pill' + (bad ? ' bad' : '')} onClick={() => setOpen(!open)} title="AgencyZoom sync status" aria-expanded={open}>
        <span className="sync-dot" data-ok={sync?.status === 'success' || sync?.status === 'partial'} data-bad={bad} />
        <span className="tsync-l">{label}</span>
      </button>
      {(connected || demo) && <button className="tsync-btn" onClick={run} disabled={busy || left === 0} title={left === 0 && nextAt ? `3 of 3 used · next ${fmtWhen(nextAt)}` : `${left} of ${LIMIT} force refreshes left in 24 hours`}>
        <Icon name="refresh" width={1.9} /><span>Refresh</span><em>{left}</em>
      </button>}
      {open && (
        <div className="tsync-pop">
          <b>AgencyZoom</b>
          <div>{bad ? `Last good sync ${timeAgo(sync?.last_ok || null)}` : `Last synced ${timeAgo(sync?.finished_at || null)}`}</div>
          {bad && <div className="sync-err" title={sync?.error || ''}>{/login failed/i.test(sync?.error || '') ? 'AgencyZoom rejected the saved login. Update the username/password in Supabase → Edge Functions → Secrets.' : sync?.error}</div>}
          {msg && <div className="tsync-msg">{msg}</div>}
          <div className="sub">{left === 0 && nextAt ? `3 of 3 force refreshes used · next ${fmtWhen(nextAt)}` : `${left} of ${LIMIT} force refreshes left in 24 hours`}</div>
          <div className="sub">Auto-sync runs hourly, Mon–Fri 8 AM – 5 PM Pacific.</div>
        </div>
      )}
    </div>
  )
}
