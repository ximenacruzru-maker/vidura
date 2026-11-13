// The owner's quick look at the team's reports, animated at the top of My Space: each retention person's day (renewal
// reviews worked and reached, and what they logged) and each call list's progress, with a click straight into the
// full report. Owners and admins only.
import { Link } from 'react-router-dom'
import { callStats, getCallItems, groupLists } from '../pages/CallLists'
import { addDays, mdy, todayPacific } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

interface RetCard { name: string; day: string; reviews: number; worked: number; reached: number; logged: number; kinds: Record<string, number> }
const hasNotes = (r: { findings: string | null; notes: string | null }) => !!(r.findings?.trim() || r.notes?.trim())
const KIND: Record<string, string> = { save: 'save', loss: 'loss', cross_sell: 'cross-sell', new_business: 'new business', review: 'service note' }
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : w.endsWith('s') ? 'es' : 's'}`

async function load() {
  const today = todayPacific(), since = addDays(today, -10)
  const { data: ppl } = await supabase.from('staff_accounts').select('producer_name, display_name').eq('access->>retention', 'true').eq('active', true)
  const names = ((ppl || []) as { producer_name: string | null; display_name: string | null }[]).map((p) => p.producer_name || p.display_name).filter(Boolean) as string[]
  const ret: RetCard[] = await Promise.all(names.map(async (name) => {
    const [rv, lg] = await Promise.all([
      supabase.from('renewal_reviews').select('day, findings, notes, spoke, call1, call2').eq('name', name).gte('day', since).lte('day', today),
      supabase.from('retention_log').select('day, kind').eq('name', name).gte('day', since).lte('day', today),
    ])
    const rows = (rv.data || []) as { day: string; findings: string | null; notes: string | null; spoke: boolean; call1: string | null; call2: string | null }[]
    const log = (lg.data || []) as { day: string; kind: string }[]
    // today, or the last day they worked if nothing is in yet today
    const day = [...rows.map((r) => r.day), ...log.map((r) => r.day)].includes(today) ? today : [...rows.map((r) => r.day), ...log.map((r) => r.day)].sort().pop() || today
    const d = rows.filter((r) => r.day === day), w = d.filter(hasNotes), l = log.filter((r) => r.day === day)
    const kinds: Record<string, number> = {}; l.forEach((x) => { kinds[x.kind] = (kinds[x.kind] || 0) + 1 })
    return { name, day, reviews: d.length, worked: w.length, reached: w.filter((r) => r.spoke || r.call1 === 'reached' || r.call2 === 'reached').length, logged: l.length, kinds }
  }))
  const lists = groupLists(await getCallItems().catch(() => []))
  // each person's newest list
  const calls = lists.filter((l, i) => lists.findIndex((x) => x.assignee === l.assignee) === i)
  return { today, ret, calls: calls.map((l) => ({ ...l, s: callStats(l.rows) })) }
}

export default function ReportsMemo() {
  const { data } = useAsync(load, [])
  if (!data || (!data.ret.length && !data.calls.length)) return null
  const first = (n: string) => n.split(' ')[0]
  let k = 0
  return (
    <section className="rm" aria-label="Team reports">
      <span className="rm-shine" aria-hidden="true" />
      <div className="rm-head">
        <span className="rm-live"><i />Live</span>
        <p className="rm-title">📊 Team reports</p>
        <p className="rm-sub">Tap a card for the full report</p>
      </div>
      <div className="rm-cards">
        {data.ret.map((r) => {
          const pct = Math.min(100, Math.round((r.worked / 20) * 100))
          return (
            <Link key={'r' + r.name} to="/retention" className="rm-card" style={{ animationDelay: (k++) * 0.12 + 's' }}>
              <span className="rm-tag">🛡️ Retention</span>
              <b className="rm-name">{r.name}</b>
              <span className="rm-when">{r.day === data.today ? 'Today' : mdy(r.day)}</span>
              <span className="rm-big"><b>{r.worked}</b> of 20 renewals worked</span>
              <span className="rm-bar"><i style={{ width: pct + '%' }} /></span>
              <span className="rm-line">{plural(r.reached, 'client')} reached · {r.logged ? Object.entries(r.kinds).map(([kk, n]) => plural(n, KIND[kk] || kk)).join(', ') : 'nothing logged'}</span>
              <span className="rm-go">Open {first(r.name)}’s report →</span>
            </Link>
          )
        })}
        {data.calls.map((l) => {
          const pct = l.s.total ? Math.round((l.s.called / l.s.total) * 100) : 0
          return (
            <Link key={'c' + l.key} to={`/call-lists?who=${encodeURIComponent(l.assignee)}`} className="rm-card" style={{ animationDelay: (k++) * 0.12 + 's' }}>
              <span className="rm-tag">📞 {l.name}</span>
              <b className="rm-name">{l.assignee}</b>
              <span className="rm-when">List of {mdy(l.date)}</span>
              <span className="rm-big"><b>{l.s.called}</b> of {l.s.total} called</span>
              <span className="rm-bar"><i style={{ width: pct + '%' }} /></span>
              <span className="rm-line">{l.s.by.reached} reached · {l.s.by.voicemail} voicemail · {l.s.by.no_answer} no answer · {l.s.left} to go</span>
              <span className="rm-go">Open {first(l.assignee)}’s call list →</span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
