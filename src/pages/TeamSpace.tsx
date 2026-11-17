// Team Space: the board to put up on the big screen. Where the agency is today (written today against what the folio
// goal needs a day, life sold, quotes), the folio so far against the goal and its projected finish (the same pace as the
// Executive Dashboard's Running total vs goal), and what everyone is up to — each person's focus, who's out, and what
// they've done in Declara today. It refreshes every minute; TV mode hides the menu and fills the screen. Team Chat is
// the other tab. The board shows no client names, since a screen in the office can be seen by walk-ins.
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { FocusPick, OutToggle } from '../components/TeamToday'
import { PageHead } from '../components/ui'
import { can } from '../lib/access'
import { getFolios, getPolicies } from '../lib/data'
import { money0, todayPacific } from '../lib/format'
import { isLife } from '../lib/lifePromo'
import { pace } from '../lib/pace'
import { supabase } from '../lib/supabase'
import { loadTeamToday, personBits, teamPeople, tidyName } from '../lib/teamToday'
import { useAsync } from '../lib/useAsync'
import { RunningChart } from './executive/parts'
import Chat from './Chat'
import './executive/executive.css'

async function loadBoard(today: string) {
  const [team, folios, goals] = await Promise.all([
    loadTeamToday(today),
    getFolios().catch(() => []),
    supabase.from('reference_data').select('data').eq('key', 'lg:GOALS').maybeSingle().then((r) => (r.data?.data || {}) as { premium?: number | null; policies?: number | null }),
  ])
  const folio = folios.find((f) => f.start_date <= today && today <= f.end_date) || null
  const sold = folio ? await getPolicies(folio.start_date, folio.end_date).catch(() => []) : []
  return { team, folio, goals, sold }
}

const clock = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })

function Board() {
  const { me } = useAuth()
  const today = todayPacific()
  const [tick, setTick] = useState(0)
  const [now, setNow] = useState(clock())
  const [tv, setTv] = useState(false)
  const { data, error } = useAsync(() => loadBoard(today), [today, tick])
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

  const people = data ? teamPeople(data.team) : null
  if (!data) return <div className="ts ts-wait">{error ? 'Team Space couldn’t load: ' + ((error as Error).message || 'try again') : 'Loading Team Space…'}</div>
  if (!people) return <div className="ts ts-wait">Team Space shows the day once Declara can read it (the owner, admins and whoever runs the work queue).</div>
  const d = data.team.d!, edit = can(me, 'work_manager')
  const again = () => setTick((n) => n + 1)

  // today
  const sales = d.sales, prem = sales.reduce((a, r) => a + (Number(r.premium) || 0), 0)
  const life = sales.filter((r) => isLife({ line: r.line, carrier: r.carrier })).length
  const qprem = d.quotes.reduce((a, r) => a + (Number(r.premium) || 0), 0)
  const inToday = people.filter((p) => !p.out), out = people.filter((p) => p.out)
  // the folio so far and the pace (the Running total vs goal's rule)
  const F = data.folio, goal = Number(data.goals.premium) || 0, polGoal = Number(data.goals.policies) || 0
  const points = data.sold.map((r) => ({ date: r.sale_date, value: Number(r.premium) || 0 }))
  const P = F ? pace(F.start_date, F.end_date, today, points) : null
  const before = P ? data.sold.filter((r) => r.sale_date < today).reduce((a, r) => a + (Number(r.premium) || 0), 0) : 0
  const daysFromToday = P ? P.days.filter((s) => s >= today).length : 0
  const need = goal && daysFromToday ? Math.max(0, goal - before) / daysFromToday : 0
  const ftd = P ? P.total : 0, policies = data.sold.length
  const mineFolio = (keys: Set<string>) => data.sold.filter((r) => keys.has(tidyName(r.producer))).reduce((a, r) => a + (Number(r.premium) || 0), 0)
  const long = new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
  const md = (iso: string) => iso.slice(5).replace('-', '/')
  const bar = (v: number, of: number) => <span className="ts-bar"><i style={{ width: Math.min(100, of ? (v / of) * 100 : 0) + '%' }} /></span>

  return (
    <div className="ts">
      <div className="ts-head">
        <div><p className="ts-title">Team Space</p><p className="ts-date">{long} · {now}</p></div>
        <div className="ts-head-r">
          <span className="ts-upd">Updated {at} · refreshes every minute</span>
          <button type="button" className="ts-tv" onClick={() => setTv(!tv)}>{tv ? '✕ Exit TV mode' : '📺 TV mode'}</button>
        </div>
      </div>

      <div className="ts-kpis">
        <div className="ts-k hero">
          <span>Written today</span><b>{money0(prem)}</b>
          <em>{sales.length} polic{sales.length === 1 ? 'y' : 'ies'}{need ? <> · {money0(need)} needed today for the goal</> : null}</em>
          {need ? bar(prem, need) : null}
        </div>
        <div className={'ts-k' + (life ? ' life' : '')}><span>Life today</span><b>{life ? `🎉 ${life}` : '0'}</b><em>{life ? `life polic${life === 1 ? 'y' : 'ies'} sold` : 'no life sold yet'}</em></div>
        <div className="ts-k"><span>Quotes today</span><b>{d.quotes.length}</b><em>{money0(qprem)} quoted</em></div>
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
        </> : <div className="ts-k"><span>Folio</span><b>—</b><em>no folio in progress today</em></div>}
      </div>

      <div className="ts-main">
        <section className="ts-people" aria-label="What everyone is up to">
          <p className="ts-h">What everyone is up to <span>{inToday.length} in{out.length ? ` · ${out.map((p) => p.name.split(' ')[0]).join(' & ')} out` : ''}</span></p>
          <div className="ts-grid">
            {people.map((p) => {
              const bits = personBits(p, money0), folio = mineFolio(p.keys)
              return (
                <div key={p.name} className={'ts-p' + (p.out ? ' out' : '') + (p.life ? ' life' : '')}>
                  <div className="ts-top">
                    <span className="ts-av" style={{ background: p.color }}>{p.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
                    <div className="ts-who"><b>{p.name}</b>
                      {edit ? <FocusPick name={p.name} focus={p.focus} onChange={again} className="ts-focus" /> : <span className="ts-focus">{p.focus}</span>}</div>
                    {edit ? <OutToggle day={today} name={p.name} out={p.out} onChange={again} className="ts-out" /> : <span className={'ts-out' + (p.out ? ' on' : '')}>{p.out ? 'Out today' : 'In'}</span>}
                  </div>
                  {p.out ? <div className="ts-line muted">Out today{p.note ? ` · ${p.note}` : ''}</div> : <>
                    {p.sales ? <div className="ts-big">{money0(p.prem)}<span>today</span></div> : null}
                    <div className="ts-line">{p.life ? <b className="ts-life">🎉 {p.life} life sold · </b> : null}{bits.length ? bits.join(' · ') : <span className="muted">Nothing in Declara yet today</span>}</div>
                  </>}
                  {folio > 0 && <div className="ts-ftd">{money0(folio)} written this folio</div>}
                </div>
              )
            })}
          </div>
        </section>
        <aside className="ts-side">
          {F && <div className="xd ts-run"><RunningChart title="Running total vs goal" today={today} start={F.start_date} end={F.end_date} goal={goal || null} points={points} /></div>}
          <div className="ts-feed">
            <p className="ts-h">Sales today <span>{sales.length ? money0(prem) : ''}</span></p>
            {sales.length ? <ul>{[...sales].reverse().map((r, i) => (
              <li key={i} className={isLife({ line: r.line, carrier: r.carrier }) ? 'life' : ''}>
                <b>{(r.producer || 'Unassigned').trim().replace(/\s+/g, ' ').split(' ')[0]}</b>
                <span>{[r.line, r.carrier].filter(Boolean).join(' · ') || 'Policy'}</span><em>{money0(Number(r.premium) || 0)}</em>
              </li>))}</ul> : <p className="ts-none">No sales yet today. First one gets the balloons 🎈</p>}
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
