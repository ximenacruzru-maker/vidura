import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth'
import { can } from '../../lib/access'
import { ErrorBox, Loading } from '../../components/ui'
import { agencyName } from '../../lib/data'
import { addDays, mdy, money0, todayPacific } from '../../lib/format'
import { loadPerfData, type PerfData } from '../../lib/perf/data'
import { isFarmersCarrier } from '../../lib/perf/executive'
import { supabase } from '../../lib/supabase'
import { useSyncStamp } from '../../lib/syncEvents'
import { tidyName } from '../../lib/teamToday'
import { useAsync } from '../../lib/useAsync'
import { bestCalls, callAgent, UNANSWERED } from '../../lib/ricochet'
import { useTvMode } from '../../lib/tvMode'
import { ClientSuccessView, loadClientSuccess } from '../../components/ClientSuccess'
import { Donut, HBars, SERIES } from '../../components/BoardCharts'
import { getDailyGoals, samePerson } from '../../lib/goals'
import GoalRace from '../../components/GoalRace'

/** Daily Huddle Report: one page with the previous workday's performance for the 10:00 huddle — what was written and
 *  quoted, phone activity from Ricochet, by producer, the policies and quotes themselves, SDR transfers and client
 *  success — with the month and folio so far, laid out like Team Space. Any earlier day can be picked. Written business is the AgencyZoom sales ledger by sold date; quotes
 *  are AgencyZoom quoted leads by quote day. */

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const step = (day: string, by: 1 | -1) => { const d = new Date(day + 'T12:00:00Z'); do { d.setUTCDate(d.getUTCDate() + by) } while (d.getUTCDay() === 0 || d.getUTCDay() === 6); return d.toISOString().slice(0, 10) }
const longDay = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const weekday = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
const isFarmers = (s: Json) => isFarmersCarrier(s.carrier) || isFarmersCarrier(s.source)
/** the Monday of the week holding a day */
const mondayOf = (iso: string) => addDays(iso, -((new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7))
const datesFrom = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out }

export default function DailyHuddle() {
  const synced = useSyncStamp() // reload when an AgencyZoom sync finishes
  const { data, error } = useAsync(loadPerfData, [synced])
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading what="Loading the huddle report" />
  return <Huddle D={data} />
}

function Huddle({ D }: { D: PerfData }) {
  const { me } = useAuth()
  const today = todayPacific()
  const [day, setDay] = useState(() => step(today, -1))
  // a week (its Monday) instead of a day: on Mondays the huddle opens on the week before, Monday to Sunday
  const [week, setWeek] = useState<string | null>(() => (new Date(today + 'T12:00:00Z').getUTCDay() === 1 ? addDays(mondayOf(today), -7) : null))
  const go = (d: string) => { setWeek(null); setDay(d >= today ? step(today, -1) : d) }
  const lastWeek = addDays(mondayOf(today), -7)
  const from = week || day, to = week ? addDays(week, 6) : day
  const span = datesFrom(from, to)
  const when = week ? (week === lastWeek ? 'last week' : `week of ${mdy(week).slice(0, 5)}`) : weekday(day)
  const whenDate = week ? `${mdy(from).slice(0, 5)} – ${mdy(to).slice(0, 5)}` : mdy(day)
  const daily: Record<string, Json> = D.WB_EXTRA.daily || {}
  const quotesByDay: Record<string, Json> = (D.WB_EXTRA.quotes || {}).byDay || {}

  // the day (or the week)
  const sales: Json[] = useMemo(() => span.flatMap((d) => (daily[d] || {}).sales || []).sort((a, b) => (b.premium || 0) - (a.premium || 0)), [daily, from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  // quotes grouped by producer (A–Z), largest quote first within each producer
  const quotes: Json[] = useMemo(() => span.flatMap((d) => (quotesByDay[d] || {}).leads || []).sort((a, b) => String(a.producer || 'Unassigned').localeCompare(String(b.producer || 'Unassigned')) || (b.quotedPremium || 0) - (a.quotedPremium || 0)), [quotesByDay, from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  const written = sales.reduce((s, r) => s + (Number(r.premium) || 0), 0)
  // Farmers vs brokered: the Executive Dashboard's rule (a Farmers carrier, by name or source)
  const farmersDay = sales.filter(isFarmers).reduce((s, r) => s + (Number(r.premium) || 0), 0)
  const quoted = quotes.reduce((s, r) => s + (Number(r.quotedPremium) || 0), 0)
  const customers = new Set(sales.map((r) => r.customerId || r.name)).size

  // the month and folio through the day
  const sumDays = (from: string, to: string) => Object.entries(daily).filter(([d]) => d >= from && d <= to).reduce((a, [, v]) => ({ p: a.p + (Number(v.total) || 0), n: a.n + (v.sales || []).length,
    f: a.f + (v.sales || []).filter(isFarmers).reduce((t: number, x: Json) => t + (Number(x.premium) || 0), 0), fn: a.fn + (v.sales || []).filter(isFarmers).length }), { p: 0, n: 0, f: 0, fn: 0 })
  const monthFrom = to.slice(0, 7) + '-01'
  const folio = Object.values(D.WB_DATA.folio || {}).find((f: Json) => f.start <= to && f.end >= to) as Json | undefined
  const ftd = folio ? sumDays(folio.start, to) : null
  // Farmers and brokered premium: the folio to date (the month to date when no folio covers the day)
  const mix = ftd || sumDays(monthFrom, to), mixWhen = folio ? 'folio to date' : 'month to date'

  // by producer: the day's quotes and sales, and the folio to date (the month to date when no folio covers the day)
  const ftdFrom = folio ? folio.start : monthFrom
  const producers = useMemo(() => {
    const p: Record<string, { q: number; qp: number; n: number; prem: number; farm: number; ftd: number }> = {}
    const row = (k: string) => (p[k || 'Unassigned'] = p[k || 'Unassigned'] || { q: 0, qp: 0, n: 0, prem: 0, farm: 0, ftd: 0 })
    quotes.forEach((q) => { const r = row(q.producer); r.q++; r.qp += Number(q.quotedPremium) || 0 })
    sales.forEach((s) => { const r = row(s.producer); r.n++; r.prem += Number(s.premium) || 0; if (isFarmers(s)) r.farm += Number(s.premium) || 0 })
    Object.entries(daily).filter(([d]) => d >= ftdFrom && d <= to).forEach(([, v]) => (v.sales || []).forEach((s: Json) => { row(s.producer).ftd += Number(s.premium) || 0 }))
    return Object.entries(p).sort((a, b) => b[1].prem - a[1].prem || b[1].ftd - a[1].ftd)
  }, [quotes, sales, daily, ftdFrom, to])

  // the month by day
  const days = Object.keys(daily).filter((d) => d >= monthFrom && d <= to)
  const byDay: { d: string; p: number }[] = []
  for (let d = new Date(monthFrom + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10), wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6 || days.includes(iso)) byDay.push({ d: iso, p: Number((daily[iso] || {}).total) || 0 })
  }
  const maxDay = Math.max(1, ...byDay.map((x) => x.p))

  const transfers: Json[] = ((D.WB_EXTRA.sdr || {}).transfers || []).filter((t: Json) => t.dateTime >= from && t.dateTime <= to)

  // client success: the scorecard, the log and the renewal reviews worked (reinstatements included)
  const ret = useAsync(() => loadClientSuccess(day), [day])

  // phone activity: the day's calls (the call webhook's when it sent any, else the API sync's), texts and voicemails
  const phone = useAsync(async () => {
    const [c, t, v] = await Promise.all([
      supabase.from('ricochet_calls').select('agent, direction, duration_sec, talk_sec, disposition, source, started_at').gte('day', from).lte('day', to).limit(20000).then((r) => (r.error ? [] : bestCalls(r.data as Call[]))),
      supabase.from('ricochet_texts').select('agent, direction').gte('day', from).lte('day', to).then((r) => (r.error ? [] : (r.data as { agent: string | null; direction: string | null }[]))),
      supabase.from('ricochet_voicemails').select('for_user, heard').gte('day', from).lte('day', to).then((r) => (r.error ? [] : (r.data as { for_user: string | null; heard: boolean | null }[]))),
    ])
    return { c, t, v }
  }, [from, to])
  // each person's own goals for the day (or the week's days), set in their Space
  const goals = useAsync(() => getDailyGoals(from, to).catch(() => []), [from, to])
  const [tab, setTab] = useState<'policies' | 'quotes' | 'sdr' | 'client' | 'month'>('policies')
  const [tv, setTv] = useTvMode()

  const agency = agencyName(me)
  const callRows = phone.data?.c || [], texts = phone.data?.t || [], vms = phone.data?.v || []
  const firstName = (n: string) => n.trim().replace(/\s+/g, ' ').split(' ')[0]
  /** a producer's calls: Ricochet names matched to AgencyZoom producer names (full name, or first name) */
  const callsOf = (producer: string) => {
    const k = tidyName(producer), f = k.split(' ')[0]
    return callRows.filter((c) => { const a = tidyName(c.agent); return a === k || (!!f && a.split(' ')[0] === f) }).length
  }
  const dials = callRows.filter((c) => c.direction !== 'inbound').length
  const short = (iso: string) => mdy(iso).slice(0, 5)
  /** a two-part bar: Farmers, then brokered */
  const split = (f: number, all: number) => all ? <span className="hd-split" title={`${Math.round((f / all) * 100)}% Farmers`}><i style={{ width: (f / all) * 100 + '%' }} /></span> : null
  // the daily goal: the folio's premium goal spread over its working days
  const goalPrem = Number(D.GOALS?.premium) || 0
  let folioDays = 0
  if (folio) for (let d = new Date(folio.start + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= folio.end; d.setUTCDate(d.getUTCDate() + 1)) { const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) folioDays++ }
  const dayGoal = goalPrem && folioDays ? goalPrem / folioDays : 0
  // the goal for what's shown: a day's share, or a week's (its weekdays)
  const workdays = span.filter((d) => { const wd = new Date(d + 'T12:00:00Z').getUTCDay(); return wd !== 0 && wd !== 6 }).length || 1
  const periodGoal = dayGoal * (week ? workdays : 1)
  const pctGoal = (v: number) => (dayGoal ? Math.round((v / dayGoal) * 100) : 0)
  const pctPeriod = (v: number) => (periodGoal ? Math.round((v / periodGoal) * 100) : 0)
  // the folio closing: within two working days of today
  let closeIn = 0
  if (folio && folio.end >= today) for (let d = today; d <= folio.end; d = addDays(d, 1)) { const wd = new Date(d + 'T12:00:00Z').getUTCDay(); if (wd !== 0 && wd !== 6) closeIn++ }
  const ftdNow = folio ? sumDays(folio.start, today) : null
  const tabs = [
    { k: 'policies' as const, l: `Policies written · ${sales.length}` },
    { k: 'quotes' as const, l: `Quotes · ${quotes.length}` },
    { k: 'sdr' as const, l: `SDR transfers · ${transfers.length}` },
    ...(week ? [] : [{ k: 'client' as const, l: 'Client success' }]),
    { k: 'month' as const, l: 'The month' },
  ]

  return (
    <div className="ts hd">
      <div className="ts-head">
        <div>
          <p className="hd-kick">Performance · {agency}</p>
          <p className="hd-title">Daily Huddle Report</p>
          <p className="ts-date">{week ? <>Week of {longDay(from).replace(/^\w+, /, '')} – {short(to)} · {when === 'last week' ? 'how we did last week' : 'the week'}</> : <>{longDay(day)} · for the {mdy(step(day, 1))} huddle</>}{folio ? ` · folio ${short(folio.start)} – ${short(folio.end)}` : ''}</p>
        </div>
        <div className="ts-head-r">
          <div className="ts-days" role="group" aria-label="Day or week">
            <button type="button" className={week ? '' : 'on'} aria-pressed={!week} onClick={() => setWeek(null)}>Day</button>
            <button type="button" className={week ? 'on' : ''} aria-pressed={!!week} onClick={() => setWeek(week || lastWeek)}>Week</button>
          </div>
          {week ? (
            <div className="ts-days" role="group" aria-label="Week">
              <button type="button" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">‹ Prev</button>
              <span className="hd-week">{short(from)} – {short(to)}</span>
              <button type="button" disabled={week >= lastWeek} onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">Next ›</button>
              {week !== lastWeek && <button type="button" className="on" onClick={() => setWeek(lastWeek)}>Last week</button>}
            </div>
          ) : (
          <div className="ts-days" role="group" aria-label="Day">
            <button type="button" onClick={() => go(step(day, -1))} aria-label="Previous day">‹ Prev</button>
            <input type="date" value={day} max={step(today, -1)} onChange={(e) => go(e.target.value || step(today, -1))} aria-label="Day" />
            <button type="button" disabled={day >= step(today, -1)} onClick={() => go(step(day, 1))} aria-label="Next day">Next ›</button>
            {day !== step(today, -1) && <button type="button" className="on" onClick={() => setDay(step(today, -1))}>Yesterday</button>}
          </div>
          )}
          <button type="button" className="ts-tv" onClick={() => setTv(!tv)}>{tv ? '✕ Exit TV mode' : '📺 TV mode'}</button>
        </div>
      </div>

      {folio && closeIn > 0 && closeIn <= 2 && (
        <div className={'ts-alert' + (closeIn === 1 ? ' last' : '')} role="status">
          <b>🔔 Folio closes {closeIn === 1 ? 'today' : 'tomorrow'}</b> · {new Date(folio.end + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'numeric', day: 'numeric', timeZone: 'UTC' })}
          <span>{ftdNow ? `${money0(ftdNow.p)} written` : ''}{goalPrem && ftdNow ? (goalPrem > ftdNow.p ? ` · ${money0(goalPrem - ftdNow.p)} to the ${money0(goalPrem)} goal` : ' · goal reached 🎉') : ''} · get every sale entered in AgencyZoom before the close</span>
        </div>
      )}

      <div className="ts-kpis">
        <div className="ts-k hero"><span>Premium written · {when}</span><b>{money0(written)}</b>
          <em>{periodGoal ? <><b className="hd-pct">{pctPeriod(written)}%</b> of the {money0(periodGoal)} {week ? 'weekly' : 'daily'} goal · </> : null}{sales.length} polic{sales.length === 1 ? 'y' : 'ies'} · {customers} customer{customers === 1 ? '' : 's'}</em>
          {periodGoal ? <span className="ts-bar"><i style={{ width: Math.min(100, pctPeriod(written)) + '%' }} /></span> : null}</div>
        <div className="ts-k hd-donut-k"><span>Farmers vs brokered</span>
          {written ? <Donut parts={[{ label: `Farmers ${money0(farmersDay)}`, v: farmersDay, color: SERIES.a }, { label: `Brokered ${money0(written - farmersDay)}`, v: written - farmersDay, color: SERIES.b }]} center={Math.round((farmersDay / written) * 100) + '%'} sub="Farmers" /> : <em>nothing written</em>}</div>
        <div className="ts-k"><span>Quotes</span><b>{quotes.length}</b><em>{money0(quoted)} · {quotes.length ? Math.round((customers / quotes.length) * 100) + '% to sale' : '—'}</em></div>
        <div className="ts-k"><span>Calls</span><b>{callRows.length}</b><em>{dials} out · {callRows.length - dials} in</em><div className="ts-chips"><span>💬 {texts.length}</span><span>📮 {vms.length}</span></div></div>
        <div className="ts-k"><span>SDR transfers</span><b>{transfers.length}</b><em>{transfers.filter((t) => t.azQualifies).length} qualified · {transfers.filter((t) => t.bound).length} bound</em></div>
        <div className="ts-k hd-mix f"><span>Farmers premium · {mixWhen}</span><b>{money0(mix.f)}</b><em>{mix.fn} polic{mix.fn === 1 ? 'y' : 'ies'}{mix.p ? ` · ${Math.round((mix.f / mix.p) * 100)}% of written` : ''} · {money0(farmersDay)} {when}</em></div>
        <div className="ts-k hd-mix b"><span>Brokered premium · {mixWhen}</span><b>{money0(mix.p - mix.f)}</b><em>{mix.n - mix.fn} polic{mix.n - mix.fn === 1 ? 'y' : 'ies'}{mix.p ? ` · ${Math.round(((mix.p - mix.f) / mix.p) * 100)}% of written` : ''} · {money0(written - farmersDay)} {when}</em></div>
        <div className="ts-k"><span>Folio to date</span><b>{ftd ? money0(ftd.p) : '—'}</b><em>{ftd ? <>{ftd.n} policies{goalPrem ? ` · ${Math.round((ftd.p / goalPrem) * 100)}% of goal` : ''}</> : 'no folio on file'}</em>{ftd ? split(ftd.f, ftd.p) : null}</div>
      </div>

      <div className="hd-grid">
        <section className="hd-col1">
          <div className="ts-feed">
            <p className="ts-h">Premium by producer <span>{when}</span></p>
            {producers.some(([, r]) => r.prem) ? <HBars keys={[{ k: 'f', label: 'Farmers', color: SERIES.a }, { k: 'b', label: 'Brokered', color: SERIES.b }]} fmt={money0}
              rows={producers.filter(([, r]) => r.prem || r.q).map(([n, r]) => { const c = callsOf(n); return { label: n, parts: { f: r.farm, b: r.prem - r.farm }, note: [`${r.n} pol`, r.q ? `${r.q} quote${r.q === 1 ? '' : 's'}` : '', c ? `📞 ${c}` : ''].filter(Boolean).join(' · ') } })} />
              : <p className="ts-none">Nothing written {week ? whenDate : 'on ' + whenDate}.</p>}
          </div>
          <div className="ts-feed">
            <p className="ts-h">Quotes by producer <span>{when} · {quotes.length} quote{quotes.length === 1 ? '' : 's'} · {money0(quoted)}</span></p>
            {quotes.length ? <HBars legend={false} keys={[{ k: 'q', label: 'Quotes', color: SERIES.c }]} fmt={(n) => String(n)}
              rows={producers.filter(([, r]) => r.q).sort((x, y) => y[1].q - x[1].q || y[1].qp - x[1].qp).map(([n, r]) => ({ label: n, parts: { q: r.q }, note: `${money0(r.qp)} quoted${r.n ? ` · ${r.n} sold` : ''}` }))} />
              : <p className="ts-none">No quotes {week ? whenDate : 'on ' + whenDate}.</p>}
          </div>
          <div className="ts-feed">
            <p className="ts-h">{folio ? 'Folio to date' : 'Month to date'} by producer <span>{folio ? `${short(folio.start)} – ${short(day)}` : ''}</span></p>
            <HBars legend={false} keys={[{ k: 't', label: folio ? 'Folio to date' : 'Month to date', color: SERIES.a }]} fmt={money0}
              rows={producers.filter(([, r]) => r.ftd).sort((x, y) => y[1].ftd - x[1].ftd).map(([n, r]) => ({ label: n, parts: { t: r.ftd } }))} />
          </div>
        </section>

        <section className="hd-col2">
          <div className="ts-feed ts-calls">
            <p className="ts-h">📞 Phone activity <span>Ricochet{callRows.length && !callRows.some((c) => c.source === 'webhook') ? ' · from lead activity' : ''}</span></p>
            {!phone.data ? <p className="ts-none">Loading calls…</p> : <PhoneActivity calls={callRows} texts={texts} vms={vms} label={week ? whenDate : 'on ' + whenDate} />}
          </div>
          {!week ? <GoalRace day={day} title={day === today ? 'Goal race' : 'How everyone did on their goals'} /> : <GoalsBoard goals={goals.data || []} callsOf={callsOf} revenueOf={(n) => sales.filter((x) => samePerson(x.producer, n)).reduce((t, x) => t + (Number(x.premium) || 0), 0)}
            label={whenDate} week loading={!goals.data || !phone.data} />}
          {week && <div className="ts-feed">
            <p className="ts-h">The week by day <span>premium written · quotes</span></p>
            <HBars keys={[{ k: 'f', label: 'Farmers', color: SERIES.a }, { k: 'b', label: 'Brokered', color: SERIES.b }]} fmt={money0}
              rows={span.filter((d) => { const wd = new Date(d + 'T12:00:00Z').getUTCDay(); return (wd !== 0 && wd !== 6) || (daily[d] || {}).total }).map((d) => {
                const ss: Json[] = (daily[d] || {}).sales || [], f = ss.filter(isFarmers).reduce((t, x) => t + (Number(x.premium) || 0), 0), all = ss.reduce((t, x) => t + (Number(x.premium) || 0), 0)
                const q = ((quotesByDay[d] || {}).leads || []).length
                return { label: new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' }), parts: { f, b: all - f }, note: `${ss.length} pol · ${q} quote${q === 1 ? '' : 's'}` }
              })} />
          </div>}
        </section>

        <section className="hd-col3 ts-feed">
          <div className="hd-tabs" role="tablist">{tabs.map((t) => <button key={t.k} type="button" role="tab" aria-selected={tab === t.k} className={tab === t.k ? 'on' : ''} onClick={() => setTab(t.k)}>{t.l}</button>)}</div>
          <div className="hd-scroll">
            {tab === 'policies' && (sales.length ? <div className="tbl-wrap"><table className="hd-tbl">
              <thead><tr><th>Customer</th><th>Producer</th><th>Line · carrier</th><th className="r">Premium</th></tr></thead>
              <tbody>{sales.map((s, i) => (
                <tr key={(s.id || s.name) + i}><td className="strong">{s.name}</td><td>{firstName(String(s.producer || '—'))}</td>
                  <td>{[s.policyType, s.carrier].filter(Boolean).join(' · ')} <span className={'hd-pill ' + (isFarmers(s) ? 'k-farmers' : 'k-brokered')}>{isFarmers(s) ? 'Farmers' : 'Brokered'}</span></td>
                  <td className="r mono strong">{money0(Number(s.premium) || 0)}</td></tr>
              ))}</tbody>
            </table></div> : <p className="ts-none">Nothing written {week ? whenDate : 'on ' + whenDate}.</p>)}
            {tab === 'quotes' && (quotes.length ? <div className="tbl-wrap"><table className="hd-tbl">
              <thead><tr><th>Lead</th><th>Producer</th><th>Lines</th><th className="r">Quoted</th></tr></thead>
              <tbody>{quotes.map((q, i) => (
                <tr key={(q.leadId || q.name) + i}><td className="strong">{q.name}<div className="muted">{q.leadSource || ''}</div></td><td>{firstName(String(q.producer || '—'))}</td>
                  <td>{Array.isArray(q.lines) ? q.lines.join(', ') : q.lines || (q.quotes || []).map((x: Json) => x.product).filter(Boolean).join(', ')}</td>
                  <td className="r mono strong">{money0(Number(q.quotedPremium) || 0)}</td></tr>
              ))}</tbody>
            </table></div> : <p className="ts-none">No quotes {week ? whenDate : 'on ' + whenDate}.</p>)}
            {tab === 'sdr' && (transfers.length ? <div className="tbl-wrap"><table className="hd-tbl">
              <thead><tr><th>SDR</th><th>Client</th><th>Producer</th><th>Status</th></tr></thead>
              <tbody>{transfers.map((t) => (
                <tr key={t.leadId}><td className="strong">{firstName(String(t.sdr || '—'))}</td><td>{t.client}</td><td>{firstName(String(t.producer || '—'))}</td>
                  <td>{t.status} {t.bound ? <span className="hd-pill k-save">Bound</span> : t.azQualifies ? <span className="hd-pill k-save">Qualified</span> : null}</td></tr>
              ))}</tbody>
            </table></div> : <p className="ts-none">No SDR transfers {week ? whenDate : 'on ' + whenDate}.</p>)}
            {tab === 'month' && <div className="hd-month">
            <p className="ts-h">The month by day <span>premium written · % of the daily goal{dayGoal ? ` (${money0(dayGoal)})` : ''}</span></p>
            <div className="hd-chart">{byDay.map((x) => (
              <button key={x.d} type="button" className={'hd-col' + (x.d >= from && x.d <= to ? ' on' : '') + (dayGoal && x.p >= dayGoal ? ' hit' : '')} onClick={() => go(x.d)} title={`${mdy(x.d)} · ${money0(x.p)}${dayGoal ? ` · ${pctGoal(x.p)}% of goal` : ''}`}>
                <span className="hd-col-v">{x.p ? '$' + Math.round(x.p / 1000) + 'k' : ''}</span>
                <span className="hd-col-track">{dayGoal ? <u style={{ bottom: Math.min(100, (dayGoal / Math.max(maxDay, dayGoal)) * 100) + '%' }} /> : null}<i style={{ height: Math.max(x.p ? 3 : 0, (x.p / Math.max(maxDay, dayGoal || 0)) * 100) + '%' }} /></span>
                <span className="hd-col-m">{x.d.slice(8)}</span>
                {dayGoal ? <span className="hd-col-p">{pctGoal(x.p)}%</span> : null}
              </button>
            ))}</div>
            </div>}
            {tab === 'client' && (!ret.data ? <p className="ts-none">Loading…</p> : <><ClientSuccessView c={ret.data} day={day} look="board" />{can(me, 'retention') && <p className="hd-foot"><Link to="/retention">Open Retention ›</Link></p>}</>)}
          </div>
        </section>
      </div>
      <p className="hd-foot">{can(me, 'performance') && <><Link to="/sales-kpis">Full Sales KPIs by period ›</Link> · </>}Written business is the AgencyZoom sales ledger by sold date; quotes are AgencyZoom quoted leads by quote day.</p>
    </div>
  )
}

interface Call { agent: string | null; direction: string | null; duration_sec: number | null; talk_sec: number | null; disposition: string | null; source?: string | null; started_at?: string | null }
const hm = (s: number) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m` }

function PhoneActivity({ calls, texts, vms, label }: { calls: Call[]; texts: { agent: string | null; direction: string | null }[]; vms: { for_user: string | null; heard: boolean | null }[]; label: string }) {
  const sent = texts.filter((t) => t.direction !== 'inbound').length, unheard = vms.filter((v) => v.heard === false).length
  const chips = <div className="ts-chips hd-phone-chips"><span title={`${sent} sent · ${texts.length - sent} received`}>💬 {texts.length} text{texts.length === 1 ? '' : 's'}</span><span title={unheard ? `${unheard} not heard yet` : ''}>📮 {vms.length} voicemail{vms.length === 1 ? '' : 's'}{unheard ? ` · ${unheard} new` : ''}</span></div>
  if (!calls.length) return <><p className="ts-none">No calls from Ricochet {label}.</p>{chips}</>
  // calls read over Ricochet's API carry no talk time; the call webhook's do
  const timed = calls.some((c) => c.talk_sec != null || c.duration_sec != null)
  const by: Record<string, { out: number; inb: number; talk: number }> = {}
  let talk = 0
  calls.forEach((c) => {
    const k = callAgent(c.agent), r = (by[k] = by[k] || { out: 0, inb: 0, talk: 0 }), t = Number(c.talk_sec ?? c.duration_sec ?? 0)
    if (c.direction === 'inbound') r.inb++; else r.out++
    r.talk += t; talk += t
  })
  const rows = Object.entries(by).sort((a, b) => (a[0] === UNANSWERED ? 1 : 0) - (b[0] === UNANSWERED ? 1 : 0) || b[1].out + b[1].inb - (a[1].out + a[1].inb))
  return (<>
    {chips}
    {timed && <p className="hd-sum">{hm(talk)} talk time</p>}
    <HBars keys={[{ k: 'o', label: 'Outbound', color: SERIES.a }, { k: 'i', label: 'Inbound', color: SERIES.b }]} fmt={(n) => String(n)}
      rows={rows.map(([n, r]) => ({ label: n === UNANSWERED ? n : n.split(' ')[0], parts: { o: r.out, i: r.inb }, note: timed ? `${hm(r.talk)} talk` : undefined }))} />
  </>)
}

/** Daily goals: for each person who set them, their calls and premium written against their own goals, and whether
 *  they reached each (for a week, the goals of the days they set added up against the week's totals) */
function GoalsBoard({ goals, callsOf, revenueOf, label, week, loading }: {
  goals: { name: string; day: string; calls: number | null; revenue: number | null }[]; callsOf: (n: string) => number; revenueOf: (n: string) => number; label: string; week: boolean; loading: boolean
}) {
  const by = new Map<string, { calls: number | null; revenue: number | null; days: number }>()
  goals.forEach((g) => { const x = by.get(g.name) || { calls: null, revenue: null, days: 0 }; x.days++
    if (g.calls != null) x.calls = (x.calls || 0) + g.calls; if (g.revenue != null) x.revenue = (x.revenue || 0) + Number(g.revenue); by.set(g.name, x) })
  const rows = [...by.entries()].map(([n, g]) => ({ n, g, c: callsOf(n), r: revenueOf(n) }))
    .map((x) => ({ ...x, okC: x.g.calls == null ? null : x.c >= x.g.calls, okR: x.g.revenue == null ? null : x.r >= x.g.revenue }))
    .sort((a, b) => Number(b.okC !== false && b.okR !== false) - Number(a.okC !== false && a.okR !== false) || a.n.localeCompare(b.n))
  const cell = (ok: boolean | null, v: string, goal: string | null) => goal == null ? <span className="sub">no goal</span>
    : <span className={'hd-goal ' + (ok ? 'hit' : 'miss')}>{ok ? '✅' : '❌'} {v} <small>/ {goal}</small></span>
  return (
    <div className="ts-feed">
      <p className="ts-h">🎯 Daily goals <span>{week ? 'the week\u2019s goals added up · ' : ''}{rows.filter((x) => x.okC !== false && x.okR !== false).length} of {rows.length} reached</span></p>
      {loading ? <p className="ts-none">Loading goals…</p> : !rows.length ? <p className="ts-none">Nobody set goals {label}. Each person sets theirs in their Space.</p>
        : <div className="tbl-wrap"><table className="hd-tbl hd-goals">
          <thead><tr><th>Who</th><th>📞 Calls</th><th>💵 Premium written</th></tr></thead>
          <tbody>{rows.map((x) => (
            <tr key={x.n}><td className="strong">{x.n.split(' ')[0]}{week ? <div className="muted">{x.g.days} day{x.g.days === 1 ? '' : 's'} set</div> : null}</td>
              <td>{cell(x.okC, String(x.c), x.g.calls == null ? null : String(x.g.calls))}</td>
              <td>{cell(x.okR, money0(x.r), x.g.revenue == null ? null : money0(x.g.revenue))}</td></tr>
          ))}</tbody>
        </table></div>}
    </div>
  )
}
