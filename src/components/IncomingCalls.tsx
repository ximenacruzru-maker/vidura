// The big incoming-call alert on Team Space: while an inbound call is ringing (Ricochet's call webhook sends the
// ringing / answered / ended events — ricochet_live_calls), the board shows who or what is calling, e.g. "Service
// Advantage", and how long it's been ringing, until someone picks up. Checked every few seconds; a call that never
// reports back stops showing after two minutes.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Live = { call_key: string; caller: string | null; queue: string | null; state: string; started_at: string; updated_at: string }
const secs = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function IncomingCalls({ on }: { on: boolean }) {
  const [calls, setCalls] = useState<Live[]>([])
  const [, setNow] = useState(0)
  useEffect(() => {
    if (!on) { setCalls([]); return }
    let alive = true
    const load = async () => {
      const since = new Date(Date.now() - 120_000).toISOString()
      const { data } = await supabase.from('ricochet_live_calls').select('call_key, caller, queue, state, started_at, updated_at').eq('state', 'ringing').gte('updated_at', since).order('started_at')
      if (alive) setCalls((data as Live[] | null) || [])
    }
    load()
    const a = setInterval(load, 4000), b = setInterval(() => setNow((n) => n + 1), 1000)
    return () => { alive = false; clearInterval(a); clearInterval(b) }
  }, [on])
  const ringing = calls.filter((c) => secs(c.started_at) < 120)
  if (!ringing.length) return null
  return (
    <div className="ic" role="alert" aria-live="assertive">
      {ringing.map((c) => (
        <div key={c.call_key} className="ic-call">
          <span className="ic-icon" aria-hidden="true">📞</span>
          <div className="ic-t">
            <span>Incoming call{c.queue && c.caller && c.queue !== c.caller ? ` · ${c.queue}` : ''}</span>
            <b>{c.caller || c.queue || 'Unknown caller'}</b>
          </div>
          <span className="ic-time" title="Ringing for">{clock(secs(c.started_at))}</span>
        </div>
      ))}
      <p className="ic-ask">Can someone pick up?</p>
    </div>
  )
}
