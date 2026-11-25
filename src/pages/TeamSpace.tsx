// Team Space: the board to put up on the big screen. Where the agency is today (written today against what the folio
// goal needs a day, life sold, quotes), the folio so far against the goal and its projected finish (the same pace as the
// Executive Dashboard's Running total vs goal), and what everyone is up to — each person's focus, who's out, and what
// they've done in Declara today, and calls by person from Ricochet (with who's on a call now). Any past day can be
// picked. It refreshes every minute; TV mode hides the menu and fills the screen. Team Chat is the other tab. The
// board shows no client names, since a screen in the office can be seen by walk-ins.
import GoalRace from '../components/GoalRace'
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
import { loadTeamToday, teamPeople, tidyName, type TeamPerson } from '../lib/teamToday'
import { bestCalls, callAgent, UNANSWERED } from '../lib/ricochet'
import { HBars, SERIES } from '../components/BoardCharts'
import { BoardBoost, BreakingNews, useBoardNews } from '../components/BoardToday'
import IncomingCalls from '../components/IncomingCalls'
import { useTvMode } from '../lib/tvMode'
import { useAsync } from '../lib/useAsync'
import { RunningChart } from './executive/parts'
import Chat from './Chat'
import './executive/executive.css'

type Call = { agent: string | null; direction: string | null; started_at?: string | null }
type Agent = { user_id: number; name: string; status: string | null; status_since: string | null; active: boolean; updated_at: string }

async function loadBoard(day: string) {
  const [team, folios, goals, calls, agents] = await Promise.all([
    loadTeamToday(day),
    getFolios().catch(() => []),
    supabase.from('reference_data').select('data').eq('key', 'lg:GOALS').maybeSingle().then((r) => (r.data?.data || {}) as { premium?: number | null; policies?: number | null }),
    // Ricochet (ricochet-sync, every minute): the day's calls, and each user's live status
    supabase.from('ricochet_calls').select('agent, direction, source, started_at').eq('day', day).limit(5000).then((r) => (r.error ? [] : bestCalls(r.data as (Call & { source: string | null })[]))),
    supabase.from('ricochet_agents').select('user_id, name, status, status_since, active, updated_at').then((r) => (r.error ? [] : (r.data as Agent[]))),
  ])
  const folio = folios.find((f) => f.start_date <= day && day <= f.end_date) || null
  const sold = folio ? (await getPolicies(folio.start_date, folio.end_date).catch(() => [])).filter((r) => r.sale_date <= day) : []
  return { team, folio, goals, sold, calls, agents }
}

const clock = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })
const mins = (iso: string | null) => { if (!iso) return ''; const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m` }
/** a Ricochet status as the board shows it: On_Phone is on a call, then preview dialing, Busy (phone set to busy),
 *  available; Offline (or no status) isn't shown; anything else shows as Ricochet names it */
type Phone = { k: 'call' | 'preview' | 'busy' | 'avail' | 'other'; label: string }
function phone(a: Agent | undefined): Phone | null {
  if (!a || !a.active || !a.status) return null
  const s = a.status.toLowerCase().replace(/[_-]+/g, ' ')
  if (/on phone|on call|talk/.test(s)) return { k: 'call', label: 'On a call' }
  if (/preview|dial/.test(s)) return { k: 'preview', label: 'Preview dialing' }
  if (/busy/.test(s)) return { k: 'busy', label: 'Busy' }
  if (/avail|ready|idle|online|waiting/.test(s)) return { k: 'avail', label: 'Available' }
  if (/offline|logged out|log out/.test(s)) return null
  return { k: 'other', label: a.status.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) }
}
const ICON: Record<Phone['k'], string> = { call: '📞', preview: '👀', busy: '⛔', avail: '✅', other: '•' }

/** the calendar at the top: two weeks of days with what was written and the calls, any day a click away */
function DayStrip({ day, today, onPick, tick }: { day: string; today: string; onPick: (d: string) => void; tick: number }) {
  const dow = new Date(day + 'T12:00:00Z').getUTCDay()
  const start = addDays(day, -((dow + 6) % 7) - 7), end = addDays(start, 13)
  const { data } = useAsync(async () => {
    const [sold, calls] = await Promise.all([
      getPolicies(start, end).catch(() => []),
      supabase.from('ricochet_calls').select('day, source').gte('day', start).lte('day', end).limit(20000).then((r) => (r.error ? [] : (r.data as { day: string; source: string | null }[]))),
    ])
    return { sold, calls }
  }, [start, end, tick])
  const cells = Array.from({ length: 14 }, (_, i) => addDays(start, i)).filter((d) => {
    const wd = new Date(d + 'T12:00:00Z').getUTCDay()
    return (wd !== 0 && wd !== 6) || d === day || !!data?.sold.some((r) => r.sale_date === d)
  })
  const k = (v: number) => (v >= 1000 ? '$' + (Math.round(v / 100) / 10).toString().replace(/\.0$/, '') + 'k' : v ? '$' + Math.round(v) : '—')
  return (
    <div className="ts-cal" role="group" aria-label="Calendar">
      <button type="button" className="ts-cal-nav" onClick={() => onPick(addDays(day, -7))} aria-label="Week before">‹</button>
      {cells.map((d) => {
        const dt = new Date(d + 'T12:00:00Z'), prem = (data?.sold || []).filter((r) => r.sale_date === d).reduce((a, r) => a + (Number(r.premium) || 0), 0)
        const n = data ? bestCalls(data.calls.filter((c) => c.day === d)).length : 0
        return (
          <button key={d} type="button" disabled={d > today} onClick={() => onPick(d)} className={'ts-cal-d' + (d === day ? ' on' : '') + (d === today ? ' today' : '')} aria-pressed={d === day}>
            <span>{dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</span>
            <b>{dt.getUTCDate()}</b>
            <em>{d > today ? '' : k(prem)}</em>
            <small>{d > today || !n ? '' : `📞 ${n}`}</small>
          </button>
        )
      })}
      <button type="button" className="ts-cal-nav" disabled={addDays(day, 7) > today && day === today} onClick={() => { const d = addDays(day, 7); onPick(d > today ? today : d) }} aria-label="Week after">›</button>
    </div>
  )
}

/** the board itself: Team Space's, and the top of the owner's Space */
export function TeamBoard() {
  const { me } = useAuth()
  const today = todayPacific()
  const [day, setDay] = useState(today)
  const [tick, setTick] = useState(0)
  const [now, setNow] = useState(clock())
  const [tv, setTv] = useTvMode()
  const { data, error } = useAsync(() => loadBoard(day), [day, tick])
  const news = useBoardNews(day, tick)
  const [at, setAt] = useState('')
  useEffect(() => { if (data) setAt(clock()) }, [data])
  // a fresh read every minute, and the clock
  useEffect(() => {
    const a = setInterval(() => setTick((n) => n + 1), 60_000), b = setInterval(() => setNow(clock()), 15_000)
    return () => { clearInterval(a); clearInterval(b) }
  }, [])

  const isToday = day === today
  // Thanksgiving: the board dresses up from Nov 15 through the day after (the fourth Thursday of November)
  const yr = Number(today.slice(0, 4))
  const tgDay = (() => { const d = new Date(Date.UTC(yr, 10, 1)); const first = (4 - d.getUTCDay() + 7) % 7 + 1; return `${yr}-11-${String(first + 21).padStart(2, '0')}` })()
  const thanksgiving = today >= `${yr}-11-15` && today <= addDays(tgDay, 1)
  const toTg = Math.round((Date.parse(tgDay + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 864e5)
  const fest = thanksgiving ? ' ts-tg' : ''
  const step = (n: number) => { const d = addDays(day, n); setDay(d > today ? today : d) }
  const long = new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
  const head = (
    <div className="ts-head">
      <div><p className="ts-title">{thanksgiving ? '🦃 ' : ''}Team Space</p><p className="ts-date">{long}{isToday ? ` · ${now}` : ''}</p></div>
      <div className="ts-head-r">
        {thanksgiving && <span className="tg-count">{toTg > 0 ? <>🦃 <b>{toTg}</b> {toTg === 1 ? 'day' : 'days'} to Thanksgiving 🥧</> : toTg === 0 ? <>Happy Thanksgiving! 🦃🍂</> : <>Thankful for this team 🧡</>}</span>}
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
  if (!data) return <div className={'ts' + fest}>{head}<p className="ts-wait">{error ? 'Team Space couldn’t load: ' + ((error as Error).message || 'try again') : 'Loading…'}</p></div>
  if (!people) return <div className={'ts' + fest}>{head}<p className="ts-wait">Team Space shows the day once Declara can read it (the owner, admins and whoever runs the work queue).</p></div>
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
  data.calls.forEach((c) => { const t = row(owner(c.agent)?.name || callAgent(c.agent)); if (c.direction === 'inbound') t.inb++; else t.out++ })
  const live = isToday ? data.agents.filter((a) => a.active) : []
  live.forEach((a) => { const n = owner(a.name)?.name || a.name; if (phone(a) || tally.has(n)) row(n).agent = a })
  const board = [...tally.values()].sort((a, b) => b.out + b.inb - (a.out + a.inb) || a.name.localeCompare(b.name))
  const top = Math.max(1, ...board.map((t) => t.out + t.inb))
  const totalOut = data.calls.filter((c) => c.direction !== 'inbound').length, totalIn = data.calls.length - totalOut
  const countNow = (k: Phone['k']) => live.filter((a) => phone(a)?.k === k).length
  const phonesNow = [['call', 'on a call'], ['preview', 'preview dialing'], ['busy', 'busy'], ['avail', 'available']].map(([k, l]) => [countNow(k as Phone['k']), l] as const).filter(([n]) => n)
  const synced = data.agents.reduce((m, a) => (a.updated_at > m ? a.updated_at : m), '')
  const agentOf = (p: TeamPerson) => live.find((a) => p.mine(a.name))
  // the wins: what the team achieved — life sold, the top writer, goals met, most calls, lists finished, tasks closed
  const first = (n: string) => n.split(' ')[0]
  const wins: { i: string; t: string }[] = []
  people.filter((p) => p.life).forEach((p) => wins.push({ i: '🎉', t: `${first(p.name)} sold ${p.life} life polic${p.life === 1 ? 'y' : 'ies'}` }))
  if (need && prem >= need) wins.push({ i: '🎯', t: `The team hit ${isToday ? "today's" : "the day's"} goal: ${money0(prem)} of ${money0(need)}` })
  const topSeller = [...people].sort((a, b) => b.prem - a.prem)[0]
  if (topSeller?.prem) wins.push({ i: '🏆', t: `${first(topSeller.name)} wrote the most: ${money0(topSeller.prem)} (${topSeller.sales} sale${topSeller.sales === 1 ? '' : 's'})` })
  people.filter((p) => p !== topSeller && p.sales).forEach((p) => wins.push({ i: '🧾', t: `${first(p.name)} wrote ${money0(p.prem)} (${p.sales} sale${p.sales === 1 ? '' : 's'})` }))
  const topCaller = board.filter((t) => t.name !== UNANSWERED)[0]
  if (topCaller && topCaller.out + topCaller.inb >= 10) wins.push({ i: '📞', t: `${first(topCaller.name)} made the most calls: ${topCaller.out + topCaller.inb}` })
  people.filter((p) => p.reviews && p.worked >= p.reviews).forEach((p) => wins.push({ i: '🔁', t: `${first(p.name)} worked every renewal review on the list (${p.worked})` }))
  people.filter((p) => p.done + p.logged >= 3).forEach((p) => wins.push({ i: '✅', t: `${first(p.name)} closed ${p.done + p.logged} tasks` }))
  people.filter((p) => p.quotes >= 3).forEach((p) => wins.push({ i: '📝', t: `${first(p.name)} sent ${p.quotes} quotes (${money0(p.qprem)})` }))
  // the folio closing: today, or within two working days
  const closeIn = F && P && isToday ? P.days.filter((s) => s >= today).length : 0
  const closeDay = F ? new Date(F.end_date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'numeric', day: 'numeric', timeZone: 'UTC' }) : ''
  const toGo = Math.max(0, goal - ftd)
  const closing = F && closeIn > 0 && closeIn <= 2 ? (
    <div className={'ts-alert' + (closeIn === 1 ? ' last' : '')} role="status">
      <b>🔔 Folio closes {closeIn === 1 ? 'today' : 'tomorrow'}</b> · {closeDay}
      <span>{money0(ftd)} written{goal ? (toGo ? ` · ${money0(toGo)} to the ${money0(goal)} goal · ${money0(toGo / closeIn)} a day` : ' · goal reached 🎉') : ''} · get every sale entered in AgencyZoom before the close</span>
    </div>
  ) : null

  return (
    <div className={'ts ts-fit' + fest}>
      {thanksgiving && <TgDecor />}
      {head}
      <IncomingCalls on={isToday} />
      <DayStrip day={day} today={today} onPick={setDay} tick={tick} />
      <BreakingNews news={news} pinned={isToday} />
      {closing}
      {/* the top: the charts and who sold what today (the news is only in the red strip) */}
      <div className="ts-top4">
          <div className="ts-feed ts-calls">
            <p className="ts-h">📞 Calls {when} <span>{data.calls.length ? `${data.calls.length} · Ricochet` : 'Ricochet'}{isToday && synced ? ` · synced ${new Date(synced).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })}` : ''}</span></p>
            {board.length ? <HBars keys={[{ k: 'o', label: 'Outbound', color: SERIES.a }, { k: 'i', label: 'Inbound', color: SERIES.b }]} fmt={(n) => String(n)} max={top}
              rows={board.map((t) => { const ph = phone(t.agent); return { label: t.name === UNANSWERED ? t.name : t.name.split(' ')[0], parts: { o: t.out, i: t.inb },
                badge: ph?.k === 'call' ? <span className="ts-dot" title={`On a call · ${mins(t.agent!.status_since)}`} /> : null,
                note: ph ? <span className={'ts-st k-' + ph.k}>{ICON[ph.k]} {ph.label} · {mins(t.agent!.status_since)}</span> : undefined } })} />
              : <p className="ts-none">{data.agents.length ? `No calls in Ricochet ${isToday ? 'yet today' : 'that day'}.` : 'Calls show up here once the Ricochet sync is running.'}</p>}
          </div>
          {/* how close everyone is to their own goals for the day, live */}
          <GoalRace day={day} className="ts-hours" />
          {F && <div className="xd ts-run"><RunningChart title="Running total vs goal" today={day} start={F.start_date} end={F.end_date} goal={goal || null} points={points} clean /></div>}
          <SoldLive sales={sales} people={inToday.map((p) => p.name)} when={when} isToday={isToday} />
      </div>
      <div className="ts-kpis">
        <div className="ts-k hero">
          <span>Written {when}</span><b>{money0(prem)}</b>
          <em>{sales.length} polic{sales.length === 1 ? 'y' : 'ies'}{need ? <> · {money0(need)} needed {isToday ? 'today' : 'that day'} for the goal</> : null}</em>
          {need ? bar(prem, need) : null}
        </div>
        <div className="ts-k"><span>Calls {when}</span><b>{data.calls.length}</b><em>{totalOut} outbound · {totalIn} inbound{isToday && phonesNow.length ? <><br />Now: {phonesNow.map(([n, l]) => `${n} ${l}`).join(' · ')}</> : null}</em></div>
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

      <div className="ts-low">
        <section className="ts-people" aria-label="What everyone is up to">
          <p className="ts-h">What everyone {isToday ? 'is up to' : 'did'} <span>{inToday.length} in{out.length ? ` · ${out.map((p) => p.name.split(' ')[0]).join(' & ')} out` : ''}</span></p>
          <div className="ts-grid">
            {people.map((p) => {
              const t = tally.get(p.name), n = t ? t.out + t.inb : 0, a = agentOf(p), ph = phone(a)
              // the day in chips, not sentences
              const chips = [
                n ? { i: '📞', v: String(n), t: `${n} call${n === 1 ? '' : 's'}` } : null,
                p.sales ? { i: '🧾', v: String(p.sales), t: `${p.sales} sale${p.sales === 1 ? '' : 's'} · ${money0(p.prem)}` } : null,
                p.quotes ? { i: '📝', v: String(p.quotes), t: `${p.quotes} quote${p.quotes === 1 ? '' : 's'} · ${money0(p.qprem)}` } : null,
                p.reviews ? { i: '🔁', v: `${p.worked}/${p.reviews}`, t: `${p.worked} of ${p.reviews} renewal reviews worked · ${p.reached} reached` } : null,
                p.calls ? { i: '☎️', v: String(p.calls), t: `${p.calls} call-list call${p.calls === 1 ? '' : 's'}` } : null,
                p.done + p.logged ? { i: '✅', v: String(p.done + p.logged), t: `${p.done + p.logged} task${p.done + p.logged === 1 ? '' : 's'} done` } : null,
                p.ret ? { i: '📒', v: String(p.ret), t: `${p.ret} retention log entr${p.ret === 1 ? 'y' : 'ies'}` } : null,
                p.notes ? { i: '🗒️', v: String(p.notes), t: `${p.notes} note${p.notes === 1 ? '' : 's'}` } : null,
              ].filter(Boolean) as { i: string; v: string; t: string }[], folio = mineFolio(p.keys)
              return (
                <div key={p.name} className={'ts-p' + (p.out ? ' out' : '') + (p.life ? ' life' : '') + (ph?.k === 'call' ? ' call' : '')}>
                  <div className="ts-top">
                    <span className="ts-av" style={{ background: p.color }}>{p.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
                    <div className="ts-who"><b>{p.name}</b>
                      {edit ? <FocusPick name={p.name} focus={p.focus} onChange={again} className="ts-focus" /> : <span className="ts-focus">{p.focus}</span>}</div>
                    {edit ? <OutToggle day={day} name={p.name} out={p.out} onChange={again} className="ts-out" /> : <span className={'ts-out' + (p.out ? ' on' : '')}>{p.out ? 'Out' : 'In'}</span>}
                  </div>
                  {ph && <div className={'ts-phone k-' + ph.k} title={`Ricochet: ${a!.status}`}>{ph.k === 'call' ? <i aria-hidden="true" /> : <span aria-hidden="true">{ICON[ph.k]}</span>}{ph.label} · {mins(a!.status_since)}</div>}
                  {p.out ? <div className="ts-line muted">Out{isToday ? ' today' : ''}{p.note ? ` · ${p.note}` : ''}</div> : <>
                    {p.sales ? <div className="ts-big">{money0(p.prem)}<span>{when}</span></div> : null}
                    {chips.length || p.life ? <div className="ts-chips">{p.life ? <span className="life">🎉 {p.life} life</span> : null}{chips.map((c) => <span key={c.i} title={c.t}>{c.i} {c.v}</span>)}</div>
                      : <div className="ts-line"><span className="muted">Nothing in Declara {isToday ? 'yet today' : 'that day'}</span></div>}
                  </>}
                  {folio > 0 && <div className="ts-ftd">{money0(folio)} written this folio{isToday ? '' : ` through ${md(day)}`}</div>}
                </div>
              )
            })}
          </div>
        </section>
        <aside className="ts-side">
          {wins.length > 0 && <div className="ts-feed ts-wins">
            <p className="ts-h">🏆 Wins {when}</p>
            <ul>{wins.map((w, i) => <li key={i}><span className="ts-win-i" aria-hidden="true">{w.i}</span><span>{w.t}</span></li>)}</ul>
          </div>}
          <BoardBoost day={day} isToday={isToday} edit={edit} />
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
      <PageHead keep kicker="Workspace" title="Team Space" sub={tab === 'board' ? 'Where the agency is today and what everyone is up to. Put it on the big screen with TV mode.' : 'Team Chat: shared with signed-in staff. Messages older than 30 days are hidden.'}
        right={board && chat ? <div className="ts-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'board'} className={tab === 'board' ? 'on' : ''} onClick={() => go('/team')}>Board</button>
          <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => go('/team/chat')}>Team Chat</button>
        </div> : undefined} />
      {tab === 'board' ? <TeamBoard /> : chat ? <Chat embedded /> : null}
    </>
  )
}

/** Who sold what on the day, live and as a game: each producer's premium and policies, ranked, with medals for the
 *  top three, a flame for three or more policies, a star for the day's first sale, and everyone in today who hasn't
 *  written yet below ("up next"). No client names (walk-ins can see the board). */
function SoldLive({ sales, people, when, isToday }: { sales: { producer: string; line: string | null; carrier: string | null; premium: number }[]; people: string[]; when: string; isToday: boolean }) {
  const by = new Map<string, { name: string; prem: number; n: number; life: number }>()
  sales.forEach((r) => { const k = (r.producer || 'Unassigned').trim(), o = by.get(k) || { name: k, prem: 0, n: 0, life: 0 }; o.prem += Number(r.premium) || 0; o.n++; if (isLife({ line: r.line, carrier: r.carrier })) o.life++; by.set(k, o) })
  const ranked = [...by.values()].sort((a, b) => b.prem - a.prem || b.n - a.n)
  const first = sales[0]?.producer?.trim()
  const firstName = (n: string) => n.split(' ')[0]
  const sold = new Set(ranked.map((r) => firstName(r.name).toLowerCase()))
  const next = people.filter((p) => !sold.has(firstName(p).toLowerCase()))
  const top = Math.max(1, ...ranked.map((r) => r.prem))
  const MEDAL = ['🥇', '🥈', '🥉']
  return (
    <div className="ts-feed ts-sold">
      <p className="ts-h">🏆 Sold {when} <span>{ranked.length ? `${sales.length} polic${sales.length === 1 ? 'y' : 'ies'} · ${money0(sales.reduce((a, r) => a + (Number(r.premium) || 0), 0))}` : isToday ? 'live' : ''}</span></p>
      {ranked.length ? <ol className="ts-sold-list">{ranked.map((r, i) => (
        <li key={r.name} className={i === 0 ? 'lead' : ''}>
          <span className="ts-sold-rank" aria-label={`Rank ${i + 1}`}>{MEDAL[i] || i + 1}</span>
          <span className="ts-sold-who"><b>{firstName(r.name)}</b>{r.n >= 3 && <span title="3+ policies today"> 🔥</span>}{r.name === first && <span title="First sale of the day"> ⭐</span>}{r.life > 0 && <span title="Life sold"> 💚</span>}
            <small>{r.n} polic{r.n === 1 ? 'y' : 'ies'}</small></span>
          <span className="ts-sold-bar"><i style={{ width: (r.prem / top) * 100 + '%' }} /></span>
          <b className="ts-sold-v">{money0(r.prem)}</b>
        </li>
      ))}</ol> : <p className="ts-none">{isToday ? 'No sales yet today. Who’s first? ⭐' : 'Nothing sold that day.'}</p>}
      {isToday && next.length > 0 && <p className="ts-sold-next">🎯 Up next: {next.map(firstName).join(' · ')}</p>}
    </div>
  )
}

/** Thanksgiving dressing for the board: a garland of leaves along the top and a few leaves drifting down behind
 *  everything (never in the way of a click; still for people who prefer reduced motion) */
function TgDecor() {
  const LEAVES = ['🍁', '🍂', '🍁', '🍂', '🍁', '🌾', '🍂', '🍁', '🍂', '🍁']
  return (
    <div className="tg-decor" aria-hidden="true">
      <div className="tg-garland" />
      {LEAVES.map((l, i) => <span key={i} className="tg-leaf" style={{ left: `${4 + i * 9.6}%`, animationDelay: `${(i * 2.3) % 11}s`, animationDuration: `${11 + (i % 4) * 2.5}s`, fontSize: `${18 + (i % 3) * 6}px` }}>{l}</span>)}
    </div>
  )
}
