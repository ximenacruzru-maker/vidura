import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth'
import { ErrorBox, Loading } from '../../components/ui'
import { agencyName } from '../../lib/data'
import { mdy, money0, todayPacific } from '../../lib/format'
import { loadPerfData, type PerfData } from '../../lib/perf/data'
import { isFarmersCarrier } from '../../lib/perf/executive'
import { movement, type RetentionDay, type RetentionEntry } from '../../lib/retention'
import { supabase } from '../../lib/supabase'
import { useSyncStamp } from '../../lib/syncEvents'
import { tidyName } from '../../lib/teamToday'
import { useAsync } from '../../lib/useAsync'

/** Daily Huddle Report: one page with the previous workday's performance for the 10:00 huddle — what was written and
 *  quoted, phone activity from Ricochet, by producer, the policies and quotes themselves, SDR transfers and client
 *  success — with the month and folio so far, laid out like Team Space. Any earlier day can be picked. Written business is the AgencyZoom sales ledger by sold date; quotes
 *  are AgencyZoom quoted leads by quote day. */

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const step = (day: string, by: 1 | -1) => { const d = new Date(day + 'T12:00:00Z'); do { d.setUTCDate(d.getUTCDate() + by) } while (d.getUTCDay() === 0 || d.getUTCDay() === 6); return d.toISOString().slice(0, 10) }
const longDay = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const weekday = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
const isFarmers = (s: Json) => isFarmersCarrier(s.carrier) || isFarmersCarrier(s.source)
const RET_KIND: Record<RetentionEntry['kind'], string> = { save: 'Save', loss: 'Loss', cross_sell: 'Cross-sell', new_business: 'New business', review: 'Service' }

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

  // client success: the retention scorecard and log for the day
  const ret = useAsync(async () => {
    const [d, l] = await Promise.all([
      supabase.from('retention_days').select('*').eq('day', day).then((r) => (r.error ? [] : (r.data as RetentionDay[]))),
      supabase.from('retention_log').select('*').eq('day', day).order('id').then((r) => (r.error ? [] : (r.data as RetentionEntry[]))),
    ])
    return { d, l }
  }, [day])

  // phone activity: every call Ricochet reported for the day (ricochet-sync, or the webhook)
  const calls = useAsync(async () => {
    const { data, error } = await supabase.from('ricochet_calls').select('agent, direction, duration_sec, talk_sec, disposition').eq('day', day)
    return error ? [] : (data as Call[])
  }, [day])

  const agency = agencyName(me)
  const callRows = calls.data || []
  const firstName = (n: string) => n.trim().replace(/\s+/g, ' ').split(' ')[0]
  /** a producer's calls: Ricochet names matched to AgencyZoom producer names (full name, or first name) */
  const callsOf = (producer: string) => {
    const k = tidyName(producer), f = k.split(' ')[0]
    return callRows.filter((c) => { const a = tidyName(c.agent); return a === k || (!!f && a.split(' ')[0] === f) }).length
  }
  const dials = callRows.filter((c) => c.direction !== 'inbound').length
  const colors = ['#4d60ff', '#01BCAF', '#F79009', '#12B76A', '#8b5cf6', '#FE454E', '#0ea5e9', '#d946ef']
  const short = (iso: string) => mdy(iso).slice(0, 5)
  /** a two-part bar: Farmers, then brokered */
  const split = (f: number, all: number) => all ? <span className="hd-split" title={`${Math.round((f / all) * 100)}% Farmers`}><i style={{ width: (f / all) * 100 + '%' }} /></span> : null

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
        </div>
      </div>

      <div className="ts-kpis">
        <div className="ts-k hero"><span>Premium written · {weekday(day)}</span><b>{money0(written)}</b><em>{sales.length} polic{sales.length === 1 ? 'y' : 'ies'} · {customers} customer{customers === 1 ? '' : 's'}{sales.length ? ` · ${money0(written / sales.length)} average` : ''}</em></div>
        <div className="ts-k"><span>Farmers vs brokered · {weekday(day)}</span><b>{money0(farmersDay)}</b><em>Farmers · {money0(written - farmersDay)} brokered{written ? ` · ${Math.round((farmersDay / written) * 100)}% Farmers` : ''}</em>{split(farmersDay, written)}</div>
        <div className="ts-k"><span>Quotes</span><b>{quotes.length}</b><em>{money0(quoted)} quoted</em></div>
        <div className="ts-k"><span>Quote to sale</span><b>{quotes.length ? Math.round((customers / quotes.length) * 100) + '%' : '—'}</b><em>customers written ÷ leads quoted</em></div>
        <div className="ts-k"><span>Calls · Ricochet</span><b>{callRows.length}</b><em>{dials} dials · {callRows.length - dials} inbound</em></div>
        <div className="ts-k"><span>SDR transfers</span><b>{transfers.length}</b><em>{transfers.filter((t) => t.azQualifies).length} qualified · {transfers.filter((t) => t.bound).length} bound</em></div>
        <div className="ts-k"><span>Month to date · through {short(day)}</span><b>{money0(mtd.p)}</b><em>{mtd.n} policies · {left} working day{left === 1 ? '' : 's'} left<br />{money0(mtd.f)} Farmers · {money0(mtd.p - mtd.f)} brokered</em>{split(mtd.f, mtd.p)}</div>
        <div className="ts-k"><span>{folio ? `Folio to date · ${short(folio.start)} – ${short(folio.end)}` : 'Folio to date'}</span><b>{ftd ? money0(ftd.p) : '—'}</b><em>{ftd ? <>{ftd.n} policies<br />{money0(ftd.f)} Farmers · {money0(ftd.p - ftd.f)} brokered</> : 'no folio on file'}</em>{ftd ? split(ftd.f, ftd.p) : null}</div>
      </div>

      <div className="ts-main">
        <section className="hd-left">
          <p className="ts-h">By producer <span>{weekday(day)} · and the {folio ? `folio to date (${short(folio.start)} – ${short(day)})` : 'month to date'}</span></p>
          {producers.length ? <div className="ts-grid">
            {producers.map(([n, r], i) => {
              const c = callsOf(n)
              const bits = [`${r.n} polic${r.n === 1 ? 'y' : 'ies'}`, r.prem ? `${money0(r.farm)} Farmers · ${money0(r.prem - r.farm)} brokered` : '', r.q ? `${r.q} quote${r.q === 1 ? '' : 's'} · ${money0(r.qp)}` : '', c ? `📞 ${c} call${c === 1 ? '' : 's'}` : ''].filter(Boolean)
              return (
                <div key={n} className="ts-p">
                  <div className="ts-top">
                    <span className="ts-av" style={{ background: colors[i % colors.length] }}>{n.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
                    <div className="ts-who"><b>{n}</b></div>
                  </div>
                  <div className="ts-big">{money0(r.prem)}<span>{weekday(day).slice(0, 3)}</span></div>
                  <div className="ts-line">{bits.join(' · ')}</div>
                  <div className="ts-ftd">{money0(r.ftd)} {folio ? 'folio to date' : 'month to date'}</div>
                </div>
              )
            })}
          </div> : <p className="ts-none">No quotes or sales on {mdy(day)}.</p>}
          <p className="hd-total">Total: {quotes.length} quotes · {money0(quoted)} quoted · {sales.length} policies · <b>{money0(written)}</b> written · {money0((ftd || mtd).p)} {folio ? 'folio to date' : 'month to date'}</p>

          <div className="ts-feed">
            <p className="ts-h">Policies written <span>{sales.length} on {mdy(day)}</span></p>
            {sales.length ? <div className="tbl-wrap"><table className="hd-tbl">
              <thead><tr><th>Customer</th><th>Producer</th><th>Line</th><th>Carrier</th><th className="r">Premium</th></tr></thead>
              <tbody>{sales.map((s, i) => (
                <tr key={(s.id || s.name) + i}><td className="strong">{s.name}</td><td>{s.producer}</td><td>{s.policyType}</td><td>{s.carrier} <span className={'hd-pill ' + (isFarmers(s) ? 'k-farmers' : 'k-brokered')}>{isFarmers(s) ? 'Farmers' : 'Brokered'}</span></td><td className="r mono strong">{money0(Number(s.premium) || 0)}</td></tr>
              ))}</tbody>
            </table></div> : <p className="ts-none">Nothing written on {mdy(day)}.</p>}
          </div>

          <div className="ts-feed">
            <p className="ts-h">Quotes <span>{quotes.length} leads quoted · by producer</span></p>
            {quotes.length ? <div className="tbl-wrap"><table className="hd-tbl">
              <thead><tr><th>Lead</th><th>Producer</th><th>Lines</th><th>Source</th><th className="r">Quoted</th></tr></thead>
              <tbody>{quotes.map((q, i) => (
                <tr key={(q.leadId || q.name) + i}><td className="strong">{q.name}</td><td>{q.producer}</td>
                  <td>{Array.isArray(q.lines) ? q.lines.join(', ') : q.lines || (q.quotes || []).map((x: Json) => x.product).filter(Boolean).join(', ')}</td>
                  <td className="muted">{q.leadSource || ''}</td><td className="r mono strong">{money0(Number(q.quotedPremium) || 0)}</td></tr>
              ))}</tbody>
            </table></div> : <p className="ts-none">No quotes on {mdy(day)}.</p>}
          </div>
        </section>

        <aside className="ts-side">
          <div className="ts-feed ts-calls">
            <p className="ts-h">📞 Phone activity <span>Ricochet · calls made and taken, by person</span></p>
            {!calls.data ? <p className="ts-none">Loading calls…</p> : <PhoneActivity calls={callRows} day={day} />}
          </div>

          <div className="ts-feed">
            <p className="ts-h">The month by day <span>premium written each workday · {new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })}</span></p>
            <div className="hd-chart">{byDay.map((x) => (
              <button key={x.d} type="button" className={'hd-col' + (x.d === day ? ' on' : '')} onClick={() => go(x.d)} title={`${mdy(x.d)} · ${money0(x.p)}`}>
                <span className="hd-col-v">{x.p ? '$' + Math.round(x.p / 1000) + 'k' : ''}</span>
                <span className="hd-col-track"><i style={{ height: Math.max(x.p ? 3 : 0, (x.p / maxDay) * 100) + '%' }} /></span>
                <span className="hd-col-m">{x.d.slice(8)}</span>
              </button>
            ))}</div>
          </div>

          <div className="ts-feed">
            <p className="ts-h">SDR transfers <span>{transfers.length} on {mdy(day)}</span></p>
            {transfers.length ? <ul>{transfers.map((t) => (
              <li key={t.leadId}><b>{firstName(String(t.sdr || '—'))}</b><span>{t.client} → {firstName(String(t.producer || '—'))} · {t.status}</span>
                <em>{t.bound ? 'Bound' : t.azQualifies ? 'Qualified' : 'Not yet'}</em></li>
            ))}</ul> : <p className="ts-none">No SDR transfers on {mdy(day)}.</p>}
          </div>

          <div className="ts-feed">
            <p className="ts-h">Client success <span>retention scorecard and log · <Link to="/retention">Open Retention ›</Link></span></p>
            {!ret.data ? <p className="ts-none">Loading…</p> : <ClientSuccess d={ret.data.d} l={ret.data.l} day={day} />}
          </div>
        </aside>
      </div>
      <p className="hd-foot"><Link to="/sales-kpis">Full Sales KPIs by period ›</Link> · Written business is the AgencyZoom sales ledger by sold date; quotes are AgencyZoom quoted leads by quote day.</p>
    </div>
  )
}

interface Call { agent: string | null; direction: string | null; duration_sec: number | null; talk_sec: number | null; disposition: string | null }
const hm = (s: number) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m` }

function PhoneActivity({ calls, day }: { calls: Call[]; day: string }) {
  if (!calls.length) return <p className="ts-none">No calls from Ricochet on {mdy(day)}.</p>
  // calls read over Ricochet's API (ricochet-sync) carry no talk time; webhook calls may
  const timed = calls.some((c) => c.talk_sec != null || c.duration_sec != null)
  const by: Record<string, { dials: number; inbound: number; contacts: number; talk: number }> = {}
  const tot = { dials: 0, inbound: 0, contacts: 0, talk: 0 }
  calls.forEach((c) => {
    const k = (c.agent || 'Unassigned').trim().replace(/\s+/g, ' ')
    const r = (by[k] = by[k] || { dials: 0, inbound: 0, contacts: 0, talk: 0 })
    const talk = Number(c.talk_sec ?? c.duration_sec ?? 0)
    for (const x of [r, tot]) { if (c.direction === 'inbound') x.inbound++; else x.dials++; if (talk >= 30) x.contacts++; x.talk += talk }
  })
  const rows = Object.entries(by).sort((a, b) => b[1].dials + b[1].inbound - (a[1].dials + a[1].inbound))
  const top = Math.max(1, ...rows.map(([, r]) => r.dials + r.inbound))
  return (<>
    <p className="hd-sum">{calls.length} calls · {tot.dials} dials · {tot.inbound} inbound{timed ? ` · ${tot.contacts} contacts (30s+) · ${hm(tot.talk)} talk time` : ''} · {rows.length} on the phones</p>
    <ul>{rows.map(([n, r]) => (
      <li key={n}>
        <b>{n.split(' ')[0]}</b>
        <span className="ts-cbar"><i style={{ width: ((r.dials + r.inbound) / top) * 100 + '%' }} /></span>
        <em>{r.dials + r.inbound}</em>
        <small>{r.dials} dials · {r.inbound} inbound{timed ? ` · ${r.contacts} contacts · ${hm(r.talk)}` : ''}</small>
      </li>
    ))}</ul>
  </>)
}

function ClientSuccess({ d, l, day }: { d: RetentionDay[]; l: RetentionEntry[]; day: string }) {
  const mv = movement(l)
  const sum = (k: keyof RetentionDay) => d.reduce((a, x) => a + Number(x[k] || 0), 0)
  if (!d.length && !l.length) return <p className="ts-none">Nothing logged on {mdy(day)}.</p>
  const tiles = [
    { k: 'At-risk touches', v: `${sum('at_risk_touches')} / 15`, good: sum('at_risk_touches') >= 15 },
    { k: 'Renewal conversations', v: `${sum('renewal_conversations')} / 5`, good: sum('renewal_conversations') >= 5 },
    { k: 'Net book movement', v: money0(mv.net), good: mv.net >= 0, note: `${mv.saved.n} saved · ${mv.cross.n} cross-sell · ${mv.fresh.n} new · ${mv.lost.n} lost` },
    { k: 'Service calls', v: String(l.filter((e) => e.kind === 'review').length), good: true, note: `${sum('escalations_same_day')} of ${sum('escalations')} escalations same day` },
  ]
  return (<>
    <div className="hd-mini">{tiles.map((t) => <div key={t.k} className={t.good ? 'good' : 'warn'}><span>{t.k}</span><b>{t.v}</b>{t.note ? <em>{t.note}</em> : null}</div>)}</div>
    {l.length > 0 && <div className="tbl-wrap"><table className="hd-tbl">
      <thead><tr><th>Who</th><th>Type</th><th>Client</th><th className="r">Premium</th><th>Notes</th></tr></thead>
      <tbody>{l.map((e) => (
        <tr key={e.id}><td className="muted">{e.name.split(' ')[0]}</td><td><span className={'hd-pill k-' + e.kind}>{RET_KIND[e.kind]}</span></td><td className="strong">{e.client}</td>
          <td className={'r mono strong ' + (e.kind === 'loss' ? 'down' : e.kind === 'review' ? 'muted' : 'up')}>{e.kind === 'review' ? '—' : (e.kind === 'loss' ? '−' : '+') + money0(Number(e.premium))}</td>
          <td className="hd-notes">{[e.reason, e.note].filter(Boolean).join(' · ') || '—'}</td></tr>
      ))}</tbody>
    </table></div>}
  </>)
}
