import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth'
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
import { Donut, HBars, HourChart, SERIES } from '../../components/BoardCharts'

/** Daily Huddle Report: one page with the previous workday's performance for the 10:00 huddle — what was written and
 *  quoted, phone activity from Ricochet, by producer, the policies and quotes themselves, SDR transfers and client
 *  success — with the month and folio so far, laid out like Team Space. Any earlier day can be picked. Written business is the AgencyZoom sales ledger by sold date; quotes
 *  are AgencyZoom quoted leads by quote day. */

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const step = (day: string, by: 1 | -1) => { const d = new Date(day + 'T12:00:00Z'); do { d.setUTCDate(d.getUTCDate() + by) } while (d.getUTCDay() === 0 || d.getUTCDay() === 6); return d.toISOString().slice(0, 10) }
const longDay = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const weekday = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
const isFarmers = (s: Json) => isFarmersCarrier(s.carrier) || isFarmersCarrier(s.source)

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
  const go = (d: string) => setDay(d >= today ? step(today, -1) : d)
  const daily: Record<string, Json> = D.WB_EXTRA.daily || {}
  const quotesByDay: Record<string, Json> = (D.WB_EXTRA.quotes || {}).byDay || {}

  // the day
  const sales: Json[] = useMemo(() => [...((daily[day] || {}).sales || [])].sort((a, b) => (b.premium || 0) - (a.premium || 0)), [daily, day])
  // quotes grouped by producer (A–Z), largest quote first within each producer
  const quotes: Json[] = useMemo(() => [...((quotesByDay[day] || {}).leads || [])].sort((a, b) => String(a.producer || 'Unassigned').localeCompare(String(b.producer || 'Unassigned')) || (b.quotedPremium || 0) - (a.quotedPremium || 0)), [quotesByDay, day])
  const written = sales.reduce((s, r) => s + (Number(r.premium) || 0), 0)
  // Farmers vs brokered: the Executive Dashboard's rule (a Farmers carrier, by name or source)
  const farmersDay = sales.filter(isFarmers).reduce((s, r) => s + (Number(r.premium) || 0), 0)
  const quoted = quotes.reduce((s, r) => s + (Number(r.quotedPremium) || 0), 0)
  const customers = new Set(sales.map((r) => r.customerId || r.name)).size

  // the month and folio through the day
  const sumDays = (from: string, to: string) => Object.entries(daily).filter(([d]) => d >= from && d <= to).reduce((a, [, v]) => ({ p: a.p + (Number(v.total) || 0), n: a.n + (v.sales || []).length,
    f: a.f + (v.sales || []).filter(isFarmers).reduce((t: number, x: Json) => t + (Number(x.premium) || 0), 0) }), { p: 0, n: 0, f: 0 })
  const monthFrom = day.slice(0, 7) + '-01'
  const mtd = sumDays(monthFrom, day)
  const folio = Object.values(D.WB_DATA.folio || {}).find((f: Json) => f.start <= day && f.end >= day) as Json | undefined
  const ftd = folio ? sumDays(folio.start, day) : null
  const [y, m] = day.split('-').map(Number)
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  let left = 0; for (let d = step(day, 1); d <= monthEnd; d = step(d, 1)) left++

  // by producer: the day's quotes and sales, and the folio to date (the month to date when no folio covers the day)
  const ftdFrom = folio ? folio.start : monthFrom
  const producers = useMemo(() => {
    const p: Record<string, { q: number; qp: number; n: number; prem: number; farm: number; ftd: number }> = {}
    const row = (k: string) => (p[k || 'Unassigned'] = p[k || 'Unassigned'] || { q: 0, qp: 0, n: 0, prem: 0, farm: 0, ftd: 0 })
    quotes.forEach((q) => { const r = row(q.producer); r.q++; r.qp += Number(q.quotedPremium) || 0 })
    sales.forEach((s) => { const r = row(s.producer); r.n++; r.prem += Number(s.premium) || 0; if (isFarmers(s)) r.farm += Number(s.premium) || 0 })
    Object.entries(daily).filter(([d]) => d >= ftdFrom && d <= day).forEach(([, v]) => (v.sales || []).forEach((s: Json) => { row(s.producer).ftd += Number(s.premium) || 0 }))
    return Object.entries(p).sort((a, b) => b[1].prem - a[1].prem || b[1].ftd - a[1].ftd)
  }, [quotes, sales, daily, ftdFrom, day])

  // the month by day
  const days = Object.keys(daily).filter((d) => d >= monthFrom && d <= day)
  const byDay: { d: string; p: number }[] = []
  for (let d = new Date(monthFrom + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= day; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10), wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6 || days.includes(iso)) byDay.push({ d: iso, p: Number((daily[iso] || {}).total) || 0 })
  }
  const maxDay = Math.max(1, ...byDay.map((x) => x.p))

  const transfers: Json[] = ((D.WB_EXTRA.sdr || {}).transfers || []).filter((t: Json) => t.dateTime === day)

  // client success: the scorecard, the log and the renewal reviews worked (reinstatements included)
  const ret = useAsync(() => loadClientSuccess(day), [day])

  // phone activity: the day's calls (the call webhook's when it sent any, else the API sync's), texts and voicemails
  const phone = useAsync(async () => {
    const [c, t, v] = await Promise.all([
      supabase.from('ricochet_calls').select('agent, direction, duration_sec, talk_sec, disposition, source, started_at').eq('day', day).limit(5000).then((r) => (r.error ? [] : bestCalls(r.data as Call[]))),
      supabase.from('ricochet_texts').select('agent, direction').eq('day', day).then((r) => (r.error ? [] : (r.data as { agent: string | null; direction: string | null }[]))),
      supabase.from('ricochet_voicemails').select('for_user, heard').eq('day', day).then((r) => (r.error ? [] : (r.data as { for_user: string | null; heard: boolean | null }[]))),
    ])
    return { c, t, v }
  }, [day])
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
  const pctGoal = (v: number) => (dayGoal ? Math.round((v / dayGoal) * 100) : 0)
  // the folio closing: within two working days of today
  let closeIn = 0
  if (folio && folio.end >= today) for (let d = today; d <= folio.end; d = addDays(d, 1)) { const wd = new Date(d + 'T12:00:00Z').getUTCDay(); if (wd !== 0 && wd !== 6) closeIn++ }
  const ftdNow = folio ? sumDays(folio.start, today) : null
  const tabs = [
    { k: 'policies' as const, l: `Policies written · ${sales.length}` },
    { k: 'quotes' as const, l: `Quotes · ${quotes.length}` },
    { k: 'sdr' as const, l: `SDR transfers · ${transfers.length}` },
    { k: 'client' as const, l: 'Client success' },
    { k: 'month' as const, l: 'The month' },
  ]

  return (
    <div className="ts hd">
      <div className="ts-head">
        <div>
          <p className="hd-kick">Performance · {agency}</p>
          <p className="hd-title">Daily Huddle Report</p>
          <p className="ts-date">{longDay(day)} · for the {mdy(step(day, 1))} huddle{folio ? ` · folio ${short(folio.start)} – ${short(folio.end)}` : ''}</p>
        </div>
        <div className="ts-head-r">
          <div className="ts-days" role="group" aria-label="Day">
            <button type="button" onClick={() => go(step(day, -1))} aria-label="Previous day">‹ Prev</button>
            <input type="date" value={day} max={step(today, -1)} onChange={(e) => go(e.target.value || step(today, -1))} aria-label="Day" />
            <button type="button" disabled={day >= step(today, -1)} onClick={() => go(step(day, 1))} aria-label="Next day">Next ›</button>
            {day !== step(today, -1) && <button type="button" className="on" onClick={() => setDay(step(today, -1))}>Yesterday</button>}
          </div>
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
        <div className="ts-k hero"><span>Premium written · {weekday(day)}</span><b>{money0(written)}</b>
          <em>{dayGoal ? <><b className="hd-pct">{pctGoal(written)}%</b> of the {money0(dayGoal)} daily goal · </> : null}{sales.length} polic{sales.length === 1 ? 'y' : 'ies'} · {customers} customer{customers === 1 ? '' : 's'}</em>
          {dayGoal ? <span className="ts-bar"><i style={{ width: Math.min(100, pctGoal(written)) + '%' }} /></span> : null}</div>
        <div className="ts-k hd-donut-k"><span>Farmers vs brokered</span>
          {written ? <Donut parts={[{ label: `Farmers ${money0(farmersDay)}`, v: farmersDay, color: SERIES.a }, { label: `Brokered ${money0(written - farmersDay)}`, v: written - farmersDay, color: SERIES.b }]} center={Math.round((farmersDay / written) * 100) + '%'} sub="Farmers" /> : <em>nothing written</em>}</div>
        <div className="ts-k"><span>Quotes</span><b>{quotes.length}</b><em>{money0(quoted)} · {quotes.length ? Math.round((customers / quotes.length) * 100) + '% to sale' : '—'}</em></div>
        <div className="ts-k"><span>Calls</span><b>{callRows.length}</b><em>{dials} out · {callRows.length - dials} in</em><div className="ts-chips"><span>💬 {texts.length}</span><span>📮 {vms.length}</span></div></div>
        <div className="ts-k"><span>SDR transfers</span><b>{transfers.length}</b><em>{transfers.filter((t) => t.azQualifies).length} qualified · {transfers.filter((t) => t.bound).length} bound</em></div>
        <div className="ts-k"><span>Month to date</span><b>{money0(mtd.p)}</b><em>{mtd.n} policies · {left} day{left === 1 ? '' : 's'} left</em>{split(mtd.f, mtd.p)}</div>
        <div className="ts-k"><span>Folio to date</span><b>{ftd ? money0(ftd.p) : '—'}</b><em>{ftd ? <>{ftd.n} policies{goalPrem ? ` · ${Math.round((ftd.p / goalPrem) * 100)}% of goal` : ''}</> : 'no folio on file'}</em>{ftd ? split(ftd.f, ftd.p) : null}</div>
      </div>

      <div className="hd-grid">
        <section className="hd-col1">
          <div className="ts-feed">
            <p className="ts-h">Premium by producer <span>{weekday(day)}</span></p>
            {producers.some(([, r]) => r.prem) ? <HBars keys={[{ k: 'f', label: 'Farmers', color: SERIES.a }, { k: 'b', label: 'Brokered', color: SERIES.b }]} fmt={money0}
              rows={producers.filter(([, r]) => r.prem || r.q).map(([n, r]) => { const c = callsOf(n); return { label: n, parts: { f: r.farm, b: r.prem - r.farm }, note: [`${r.n} pol`, r.q ? `${r.q} quote${r.q === 1 ? '' : 's'}` : '', c ? `📞 ${c}` : ''].filter(Boolean).join(' · ') } })} />
              : <p className="ts-none">Nothing written on {mdy(day)}.</p>}
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
            {!phone.data ? <p className="ts-none">Loading calls…</p> : <PhoneActivity calls={callRows} texts={texts} vms={vms} day={day} />}
          </div>
          {callRows.some((c) => c.started_at) && <div className="ts-feed"><p className="ts-h">Calls by hour</p><HourChart calls={callRows} /></div>}
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
            </table></div> : <p className="ts-none">Nothing written on {mdy(day)}.</p>)}
            {tab === 'quotes' && quotes.length > 0 && <div className="hd-tabchart"><HBars legend={false} keys={[{ k: 'q', label: 'Quoted', color: SERIES.c }]} fmt={money0}
              rows={producers.filter(([, r]) => r.q).sort((x, y) => y[1].qp - x[1].qp).map(([n, r]) => ({ label: n, parts: { q: r.qp }, note: `${r.q} quote${r.q === 1 ? '' : 's'}` }))} /></div>}
            {tab === 'quotes' && (quotes.length ? <div className="tbl-wrap"><table className="hd-tbl">
              <thead><tr><th>Lead</th><th>Producer</th><th>Lines</th><th className="r">Quoted</th></tr></thead>
              <tbody>{quotes.map((q, i) => (
                <tr key={(q.leadId || q.name) + i}><td className="strong">{q.name}<div className="muted">{q.leadSource || ''}</div></td><td>{firstName(String(q.producer || '—'))}</td>
                  <td>{Array.isArray(q.lines) ? q.lines.join(', ') : q.lines || (q.quotes || []).map((x: Json) => x.product).filter(Boolean).join(', ')}</td>
                  <td className="r mono strong">{money0(Number(q.quotedPremium) || 0)}</td></tr>
              ))}</tbody>
            </table></div> : <p className="ts-none">No quotes on {mdy(day)}.</p>)}
            {tab === 'sdr' && (transfers.length ? <div className="tbl-wrap"><table className="hd-tbl">
              <thead><tr><th>SDR</th><th>Client</th><th>Producer</th><th>Status</th></tr></thead>
              <tbody>{transfers.map((t) => (
                <tr key={t.leadId}><td className="strong">{firstName(String(t.sdr || '—'))}</td><td>{t.client}</td><td>{firstName(String(t.producer || '—'))}</td>
                  <td>{t.status} {t.bound ? <span className="hd-pill k-save">Bound</span> : t.azQualifies ? <span className="hd-pill k-save">Qualified</span> : null}</td></tr>
              ))}</tbody>
            </table></div> : <p className="ts-none">No SDR transfers on {mdy(day)}.</p>)}
            {tab === 'month' && <div className="hd-month">
            <p className="ts-h">The month by day <span>premium written · % of the daily goal{dayGoal ? ` (${money0(dayGoal)})` : ''}</span></p>
            <div className="hd-chart">{byDay.map((x) => (
              <button key={x.d} type="button" className={'hd-col' + (x.d === day ? ' on' : '') + (dayGoal && x.p >= dayGoal ? ' hit' : '')} onClick={() => go(x.d)} title={`${mdy(x.d)} · ${money0(x.p)}${dayGoal ? ` · ${pctGoal(x.p)}% of goal` : ''}`}>
                <span className="hd-col-v">{x.p ? '$' + Math.round(x.p / 1000) + 'k' : ''}</span>
                <span className="hd-col-track">{dayGoal ? <u style={{ bottom: Math.min(100, (dayGoal / Math.max(maxDay, dayGoal)) * 100) + '%' }} /> : null}<i style={{ height: Math.max(x.p ? 3 : 0, (x.p / Math.max(maxDay, dayGoal || 0)) * 100) + '%' }} /></span>
                <span className="hd-col-m">{x.d.slice(8)}</span>
                {dayGoal ? <span className="hd-col-p">{pctGoal(x.p)}%</span> : null}
              </button>
            ))}</div>
            </div>}
            {tab === 'client' && (!ret.data ? <p className="ts-none">Loading…</p> : <><ClientSuccessView c={ret.data} day={day} look="board" /><p className="hd-foot"><Link to="/retention">Open Retention ›</Link></p></>)}
          </div>
        </section>
      </div>
      <p className="hd-foot"><Link to="/sales-kpis">Full Sales KPIs by period ›</Link> · Written business is the AgencyZoom sales ledger by sold date; quotes are AgencyZoom quoted leads by quote day.</p>
    </div>
  )
}

interface Call { agent: string | null; direction: string | null; duration_sec: number | null; talk_sec: number | null; disposition: string | null; source?: string | null; started_at?: string | null }
const hm = (s: number) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m` }

function PhoneActivity({ calls, texts, vms, day }: { calls: Call[]; texts: { agent: string | null; direction: string | null }[]; vms: { for_user: string | null; heard: boolean | null }[]; day: string }) {
  const sent = texts.filter((t) => t.direction !== 'inbound').length, unheard = vms.filter((v) => v.heard === false).length
  const chips = <div className="ts-chips hd-phone-chips"><span title={`${sent} sent · ${texts.length - sent} received`}>💬 {texts.length} text{texts.length === 1 ? '' : 's'}</span><span title={unheard ? `${unheard} not heard yet` : ''}>📮 {vms.length} voicemail{vms.length === 1 ? '' : 's'}{unheard ? ` · ${unheard} new` : ''}</span></div>
  if (!calls.length) return <><p className="ts-none">No calls from Ricochet on {mdy(day)}.</p>{chips}</>
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
