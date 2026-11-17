// Team Space: the board to put up on the big screen. Where the agency is today (written today against what the folio
// goal needs a day, life sold, quotes), the folio so far against the goal and its projected finish (the same pace as the
// Executive Dashboard's Running total vs goal), and what everyone is up to — each person's focus, who's out, and what
// they've done in Declara today, and calls by person from Ricochet (with who's on a call now). Any past day can be
// picked. It refreshes every minute; TV mode hides the menu and fills the screen. Team Chat is the other tab. The
// board shows no client names, since a screen in the office can be seen by walk-ins.
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { FocusPick, OutToggle } from '../components/TeamToday'
import { PageHead } from '../components/ui'
import { can } from '../lib/access'
import { getFolios, getPolicies } from '../lib/data'
import { addDays, money0, todayPacific } from '../lib/format'
import { isLife } from '../lib/lifePromo'
import { pace } from '../lib/pace'
import { supabase } from '../lib/supabase'
import { loadTeamToday, personBits, teamPeople, tidyName, type TeamPerson } from '../lib/teamToday'
import { useAsync } from '../lib/useAsync'
import { RunningChart } from './executive/parts'
import Chat from './Chat'
import './executive/executive.css'

type Call = { agent: string | null; direction: string | null }
type Agent = { user_id: number; name: string; status: string | null; status_since: string | null; active: boolean; updated_at: string }

async function loadBoard(day: string) {
  const [team, folios, goals, calls, agents] = await Promise.all([
    loadTeamToday(day),
    getFolios().catch(() => []),
    supabase.from('reference_data').select('data').eq('key', 'lg:GOALS').maybeSingle().then((r) => (r.data?.data || {}) as { premium?: number | null; policies?: number | null }),
    // Ricochet (ricochet-sync, every minute): the day's calls, and each user's live status
    supabase.from('ricochet_calls').select('agent, direction').eq('day', day).limit(5000).then((r) => (r.error ? [] : (r.data as Call[]))),
    supabase.from('ricochet_agents').select('user_id, name, status, status_since, active, updated_at').then((r) => (r.error ? [] : (r.data as Agent[]))),
  ])
  const folio = folios.find((f) => f.start_date <= day && day <= f.end_date) || null
  const sold = folio ? (await getPolicies(folio.start_date, folio.end_date).catch(() => [])).filter((r) => r.sale_date <= day) : []
  return { team, folio, goals, sold, calls, agents }
}

const clock = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })
const mins = (iso: string | null) => { if (!iso) return ''; const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m` }
/** Ricochet's "Busy" is an agent on a call */
const onCall = (a: Agent | undefined) => !!a && a.active && /busy|on.?call|talk/i.test(a.status || '')

function Board() {
  const { me } = useAuth()
  const today = todayPacific()
  const [day, setDay] = useState(today)
  const [tick, setTick] = useState(0)
  const [now, setNow] = useState(clock())
  const [tv, setTv] = useState(false)
  const { data, error } = useAsync(() => loadBoard(day), [day, tick])
  const [at, setAt] = useState('')
  useEffect(() => { if (data) setAt(clock()) }, [data])
  // a fresh read every minute, and the clock
  useEffect(() => {
    const a = setInterval(() => setTick((n) => n + 1), 60_000), b = setInterval(() => setNow(clock()), 15_000)
    return () => { clearInterval(a); clearInterval(b) }
  }, [])
  // TV mode: the menu and top bar hidden, the page full screen; Esc (or leaving full screen) ends it
  useEffect(() => {
    document.body.classList.toggle('tv', tv)
    if (tv && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {})
    if (!tv && document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    const off = () => { if (!document.fullscreenElement) setTv(false) }
    document.addEventListener('fullscreenchange', off)
    return () => { document.removeEventListener('fullscreenchange', off); document.body.classList.remove('tv') }
  }, [tv])

  const isToday = day === today
  const step = (n: number) => { const d = addDays(day, n); setDay(d > today ? today : d) }
  const long = new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
  const head = (
    <div className="ts-head">
      <div><p className="ts-title">Team Space</p><p className="ts-date">{long}{isToday ? ` · ${now}` : ''}</p></div>
      <div className="ts-head-r">
        <div className="ts-days" role="group" aria-label="Day">
          <button type="button" onClick={() => step(-1)} aria-label="Previous day">‹ Prev</button>
          <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value && e.target.value <= today ? e.target.value : today)} aria-label="Pick a day" />
          <button type="button" onClick={() => step(1)} disabled={isToday} aria-label="Next day">Next ›</button>
          {!isToday && <button type="button" className="on" onClick={() => setDay(today)}>Today</button>}
        </div>
        <span className="ts-upd">{isToday ? `Updated ${at} · refreshes every minute` : 'A past day'}</span>
        <button type="button" className="ts-tv" onClick={() => setTv(!tv)}>{tv ? '✕ Exit TV mode' : '📺 TV mode'}</button>
      </div>
    </div>
  )

  const people = data ? teamPeople(data.team) : null
  if (!data) return <div className="ts">{head}<p className="ts-wait">{error ? 'Team Space couldn’t load: ' + ((error as Error).message || 'try again') : 'Loading…'}</p></div>
  if (!people) return <div className="ts">{head}<p className="ts-wait">Team Space shows the day once Declara can read it (the owner, admins and whoever runs the work queue).</p></div>
  const d = data.team.d!, edit = can(me, 'work_manager')
  const again = () => setTick((n) => n + 1)
  const when = isToday ? 'today' : new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })

  // the day
  const sales = d.sales, prem = sales.reduce((a, r) => a + (Number(r.premium) || 0), 0)
  const life = sales.filter((r) => isLife({ line: r.line, carrier: r.carrier })).length
  const qprem = d.quotes.reduce((a, r) => a + (Number(r.premium) || 0), 0)
  const inToday = people.filter((p) => !p.out), out = people.filter((p) => p.out)
  // the folio so far and the pace as of the day (the Running total vs goal's rule)
  const F = data.folio, goal = Number(data.goals.premium) || 0, polGoal = Number(data.goals.policies) || 0
  const points = data.sold.map((r) => ({ date: r.sale_date, value: Number(r.premium) || 0 }))
  const P = F ? pace(F.start_date, F.end_date, day, points) : null
  const before = data.sold.filter((r) => r.sale_date < day).reduce((a, r) => a + (Number(r.premium) || 0), 0)
  const daysFromDay = P ? P.days.filter((s) => s >= day).length : 0
  const need = goal && daysFromDay ? Math.max(0, goal - before) / daysFromDay : 0
  const ftd = P ? P.total : 0, policies = data.sold.length
  const mineFolio = (keys: Set<string>) => data.sold.filter((r) => keys.has(tidyName(r.producer))).reduce((a, r) => a + (Number(r.premium) || 0), 0)
  const md = (iso: string) => iso.slice(5).replace('-', '/')
  const bar = (v: number, of: number) => <span className="ts-bar"><i style={{ width: Math.min(100, of ? (v / of) * 100 : 0) + '%' }} /></span>

  // calls by person (Ricochet names matched to the team the same way as everything else), and who's on a call now
  const owner = (n: string | null) => people.find((p) => p.mine(n)) || null
  const tally = new Map<string, { name: string; out: number; inb: number; agent?: Agent }>()
  const row = (name: string) => { const t = tally.get(name) || { name, out: 0, inb: 0 }; tally.set(name, t); return t }
  data.calls.forEach((c) => { const t = row(owner(c.agent)?.name || (c.agent || 'Unassigned').trim()); if (c.direction === 'inbound') t.inb++; else t.out++ })
  const live = isToday ? data.agents.filter((a) => a.active) : []
  live.forEach((a) => { const n = owner(a.name)?.name || a.name; if (onCall(a) || tally.has(n)) row(n).agent = a })
  const board = [...tally.values()].sort((a, b) => b.out + b.inb - (a.out + a.inb) || a.name.localeCompare(b.name))
  const top = Math.max(1, ...board.map((t) => t.out + t.inb))
  const totalOut = data.calls.filter((c) => c.direction !== 'inbound').length, totalIn = data.calls.length - totalOut
  const busyNow = live.filter(onCall).length
  const synced = data.agents.reduce((m, a) => (a.updated_at > m ? a.updated_at : m), '')
  const agentOf = (p: TeamPerson) => live.find((a) => p.mine(a.name))

  return (
    <div className="ts">
      {head}
      <div className="ts-kpis">
        <div className="ts-k hero">
          <span>Written {when}</span><b>{money0(prem)}</b>
          <em>{sales.length} polic{sales.length === 1 ? 'y' : 'ies'}{need ? <> · {money0(need)} needed {isToday ? 'today' : 'that day'} for the goal</> : null}</em>
          {need ? bar(prem, need) : null}
        </div>
        <div className="ts-k"><span>Calls {when}</span><b>{data.calls.length}</b><em>{totalOut} outbound · {totalIn} inbound{isToday ? ` · ${busyNow} on a call now` : ''}</em></div>
        <div className={'ts-k' + (life ? ' life' : '')}><span>Life {when}</span><b>{life ? `🎉 ${life}` : '0'}</b><em>{life ? `life polic${life === 1 ? 'y' : 'ies'} sold` : 'no life sold'}</em></div>
        <div className="ts-k"><span>Quotes {when}</span><b>{d.quotes.length}</b><em>{money0(qprem)} quoted</em></div>
        {F && P ? <>
          <div className="ts-k">
            <span>Folio to date · {md(F.start_date)}–{md(F.end_date)}</span><b>{money0(ftd)}</b>
            <em>{goal ? `of ${money0(goal)} · ${Math.round((ftd / goal) * 100)}%` : 'no goal set'} · {policies}{polGoal ? ` of ${polGoal}` : ''} policies</em>
            {goal ? bar(ftd, goal) : null}
          </div>
          <div className={'ts-k' + (goal && P.projected != null ? (P.projected >= goal ? ' good' : ' warn') : '')}>
            <span>Projected finish · {P.left.length} day{P.left.length === 1 ? '' : 's'} left</span><b>{money0(P.projected ?? ftd)}</b>
            <em>{P.projected != null ? `${money0(P.low || 0)} – ${money0(P.high || 0)}` : 'folio complete'}{goal && P.projected != null ? ` · ${Math.round((P.projected / goal) * 100)}% of goal` : ''}</em>
          </div>
        </> : <div className="ts-k"><span>Folio</span><b>—</b><em>no folio on this day</em></div>}
      </div>

      <div className="ts-main">
        <section className="ts-people" aria-label="What everyone is up to">
          <p className="ts-h">What everyone {isToday ? 'is up to' : 'did'} <span>{inToday.length} in{out.length ? ` · ${out.map((p) => p.name.split(' ')[0]).join(' & ')} out` : ''}</span></p>
          <div className="ts-grid">
            {people.map((p) => {
              const t = tally.get(p.name), n = t ? t.out + t.inb : 0, a = agentOf(p)
              const bits = [...(n ? [`📞 ${n} call${n === 1 ? '' : 's'}`] : []), ...personBits(p, money0)], folio = mineFolio(p.keys)
              return (
                <div key={p.name} className={'ts-p' + (p.out ? ' out' : '') + (p.life ? ' life' : '') + (onCall(a) ? ' call' : '')}>
                  <div className="ts-top">
                    <span className="ts-av" style={{ background: p.color }}>{p.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
                    <div className="ts-who"><b>{p.name}</b>
                      {edit ? <FocusPick name={p.name} focus={p.focus} onChange={again} className="ts-focus" /> : <span className="ts-focus">{p.focus}</span>}</div>
                    {edit ? <OutToggle day={day} name={p.name} out={p.out} onChange={again} className="ts-out" /> : <span className={'ts-out' + (p.out ? ' on' : '')}>{p.out ? 'Out' : 'In'}</span>}
                  </div>
                  {onCall(a) && <div className="ts-oncall" title={`Ricochet: ${a!.status}`}><i aria-hidden="true" />On a call · {mins(a!.status_since)}</div>}
                  {p.out ? <div className="ts-line muted">Out{isToday ? ' today' : ''}{p.note ? ` · ${p.note}` : ''}</div> : <>
                    {p.sales ? <div className="ts-big">{money0(p.prem)}<span>{when}</span></div> : null}
                    <div className="ts-line">{p.life ? <b className="ts-life">🎉 {p.life} life sold · </b> : null}{bits.length ? bits.join(' · ') : <span className="muted">Nothing in Declara {isToday ? 'yet today' : 'that day'}</span>}</div>
                  </>}
                  {folio > 0 && <div className="ts-ftd">{money0(folio)} written this folio{isToday ? '' : ` through ${md(day)}`}</div>}
                </div>
              )
            })}
          </div>
        </section>
        <aside className="ts-side">
          <div className="ts-feed ts-calls">
            <p className="ts-h">📞 Calls {when} <span>{data.calls.length ? `${data.calls.length} · Ricochet` : 'Ricochet'}{isToday && synced ? ` · synced ${new Date(synced).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })}` : ''}</span></p>
            {board.length ? <ul>{board.map((t) => (
              <li key={t.name} className={onCall(t.agent) ? 'call' : ''}>
                <b>{t.name.split(' ')[0]}{onCall(t.agent) ? <span className="ts-dot" title={`On a call · ${mins(t.agent!.status_since)}`} /> : null}</b>
                <span className="ts-cbar"><i style={{ width: ((t.out + t.inb) / top) * 100 + '%' }} /></span>
                <em>{t.out + t.inb}</em>
                <small>{t.out} out · {t.inb} in{onCall(t.agent) ? ` · on a call ${mins(t.agent!.status_since)}` : ''}</small>
              </li>))}</ul> : <p className="ts-none">{data.agents.length ? `No calls in Ricochet ${isToday ? 'yet today' : 'that day'}.` : 'Calls show up here once the Ricochet sync is running.'}</p>}
          </div>
          {F && <div className="xd ts-run"><RunningChart title="Running total vs goal" today={day} start={F.start_date} end={F.end_date} goal={goal || null} points={points} /></div>}
          <div className="ts-feed">
            <p className="ts-h">Sales {when} <span>{sales.length ? money0(prem) : ''}</span></p>
            {sales.length ? <ul>{[...sales].reverse().map((r, i) => (
              <li key={i} className={isLife({ line: r.line, carrier: r.carrier }) ? 'life' : ''}>
                <b>{(r.producer || 'Unassigned').trim().replace(/\s+/g, ' ').split(' ')[0]}</b>
                <span>{[r.line, r.carrier].filter(Boolean).join(' · ') || 'Policy'}</span><em>{money0(Number(r.premium) || 0)}</em>
              </li>))}</ul> : <p className="ts-none">{isToday ? 'No sales yet today. First one gets the balloons 🎈' : 'No sales that day.'}</p>}
          </div>
        </aside>
      </div>
    </div>
  )
}

export default function TeamSpace() {
  const { me } = useAuth()
  const { pathname } = useLocation()
  const go = useNavigate()
  const board = can(me, 'work_manager'), chat = can(me, 'chat')
  const tab = pathname.endsWith('/chat') || !board ? 'chat' : 'board'
  return (
    <>
      <PageHead kicker="Workspace" title="Team Space" sub={tab === 'board' ? 'Where the agency is today and what everyone is up to. Put it on the big screen with TV mode.' : 'Team Chat: shared with signed-in staff. Messages older than 30 days are hidden.'}
        right={board && chat ? <div className="ts-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'board'} className={tab === 'board' ? 'on' : ''} onClick={() => go('/team')}>Board</button>
          <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => go('/team/chat')}>Team Chat</button>
        </div> : undefined} />
      {tab === 'board' ? <Board /> : chat ? <Chat embedded /> : null}
    </>
  )
}
