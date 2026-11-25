// The goal race, on Team Space and the Daily Huddle: everyone who set goals for the day, ranked by how close they are
// to reaching them (calls and premium written against their own goals), live while it's today (refreshed every
// minute), with medals, a ✅ once every goal is reached, and each person's PTO streak while the incentive runs.
import { useEffect, useState } from 'react'
import { getDailyGoals, incentiveDay, samePerson, streakData, streakFor, PTO_INCENTIVE } from '../lib/goals'
import { money0, todayPacific } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

const MEDAL = ['🥇', '🥈', '🥉']
const k = (n: number) => (n >= 1000 ? '$' + (Math.round(n / 100) / 10).toString().replace(/\.0$/, '') + 'k' : money0(n))

export default function GoalRace({ day, title = 'Goal race', className = '' }: { day: string; title?: string; className?: string }) {
  const today = todayPacific(), live = day === today
  const [tick, setTick] = useState(0)
  useEffect(() => { if (!live) return; const t = setInterval(() => setTick((n) => n + 1), 60000); return () => clearInterval(t) }, [live])
  const data = useAsync(async () => {
    const [goals, calls, sales, runs] = await Promise.all([
      getDailyGoals(day, day).catch(() => []),
      supabase.rpc('calls_by_day', { p_from: day, p_to: day }).then((r) => ((r.data || []) as any[]).map((x) => ({ agent: x.agent as string | null, n: Number(x.calls) || 0 }))),
      supabase.from('policies_sold').select('producer, premium').eq('sale_date', day).limit(2000).then((r) => (r.data || []) as { producer: string | null; premium: number | string | null }[]),
      live && incentiveDay(today) ? streakData(today).catch(() => null) : Promise.resolve(null),
    ])
    return { goals, calls, sales, runs }
  }, [day, tick])
  const d = data.data
  const rows = (d?.goals || []).filter((g) => g.calls != null || g.revenue != null).map((g) => {
    const c = d!.calls.filter((x) => samePerson(x.agent, g.name)).reduce((t, x) => t + x.n, 0)
    const r = d!.sales.filter((x) => samePerson(x.producer, g.name)).reduce((t, x) => t + (Number(x.premium) || 0), 0)
    const pc = g.calls ? Math.min(1, c / g.calls) : null, pr = g.revenue ? Math.min(1, r / g.revenue) : null
    const parts = [pc, pr].filter((x): x is number => x != null)
    const score = parts.length ? parts.reduce((t, x) => t + x, 0) / parts.length : 0
    const s = d!.runs ? streakFor(g.name, d!.runs, today) : null
    return { name: g.name, c, r, gc: g.calls, gr: g.revenue, pc, pr, score, all: parts.length > 0 && parts.every((x) => x >= 1), s }
  }).sort((a, b) => b.score - a.score || b.r - a.r)
  const hit = rows.filter((x) => x.all).length

  return (
    <div className={'ts-feed gr ' + className}>
      <p className="ts-h">🎯 {title} <span>{live ? 'live' : ''}{live && rows.length ? ' · ' : ''}{rows.length ? `${hit} of ${rows.length} hit every goal` : ''}</span></p>
      {!d ? <p className="ts-none">Loading goals…</p> : !rows.length ? <p className="ts-none">No goals set {live ? 'yet today' : 'that day'}. Everyone sets theirs on their Hunter Goal Scoreboard.</p>
        : <ol className="gr-list">{rows.map((x, i) => (
          <li key={x.name} className={x.all ? 'won' : ''}>
            <span className="gr-rank">{x.all ? '✅' : MEDAL[i] || i + 1}</span>
            <span className="gr-who"><b>{x.name.split(' ')[0]}</b>
              {x.s && (x.s.run > 0 || x.s.earned > 0) ? <small title={`${x.s.run} of ${PTO_INCENTIVE.run} days in a row with every goal reached`}>🔥 {x.s.run}/{PTO_INCENTIVE.run}{x.s.earned ? ` · 🏖️ ${x.s.earned}` : ''}</small> : null}</span>
            <span className="gr-bars">
              {x.pc != null && <span className="gr-bar" title={`Calls ${x.c} of ${x.gc}`}><em>📞 {x.c}/{x.gc}</em><i><u style={{ width: x.pc * 100 + '%' }} className={x.pc >= 1 ? 'full' : ''} /></i></span>}
              {x.pr != null && <span className="gr-bar" title={`Premium ${money0(x.r)} of ${money0(x.gr || 0)}`}><em>💵 {k(x.r)}/{k(x.gr || 0)}</em><i><u style={{ width: x.pr * 100 + '%' }} className={x.pr >= 1 ? 'full' : ''} /></i></span>}
            </span>
            <b className="gr-pct">{Math.round(x.score * 100)}%</b>
          </li>
        ))}</ol>}
    </div>
  )
}
