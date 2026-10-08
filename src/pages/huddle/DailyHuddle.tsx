import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth'
import { GoalCard, Section } from '../../components/Report'
import { ErrorBox, Loading } from '../../components/ui'
import { agencyName } from '../../lib/data'
import { mdy, money0, todayPacific } from '../../lib/format'
import { loadPerfData, type PerfData } from '../../lib/perf/data'
import { movement, type RetentionDay, type RetentionEntry } from '../../lib/retention'
import { supabase } from '../../lib/supabase'
import { useSyncStamp } from '../../lib/syncEvents'
import { useAsync } from '../../lib/useAsync'

/** Daily Huddle Report: one page with the previous workday's performance for the 10:00 huddle — what was written and
 *  quoted, phone activity from Ricochet, by producer, the policies and quotes themselves, SDR transfers and client
 *  success — with the month and
 *  folio so far. Any earlier day can be picked. Written business is the AgencyZoom sales ledger by sold date; quotes
 *  are AgencyZoom quoted leads by quote day. */

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const step = (day: string, by: 1 | -1) => { const d = new Date(day + 'T12:00:00Z'); do { d.setUTCDate(d.getUTCDate() + by) } while (d.getUTCDay() === 0 || d.getUTCDay() === 6); return d.toISOString().slice(0, 10) }
const longDay = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const weekday = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
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
  const quotes: Json[] = useMemo(() => [...((quotesByDay[day] || {}).leads || [])].sort((a, b) => (b.quotedPremium || 0) - (a.quotedPremium || 0)), [quotesByDay, day])
  const written = sales.reduce((s, r) => s + (Number(r.premium) || 0), 0)
  const quoted = quotes.reduce((s, r) => s + (Number(r.quotedPremium) || 0), 0)
  const customers = new Set(sales.map((r) => r.customerId || r.name)).size

  // the month and folio through the day
  const sumDays = (from: string, to: string) => Object.entries(daily).filter(([d]) => d >= from && d <= to).reduce((a, [, v]) => ({ p: a.p + (Number(v.total) || 0), n: a.n + (v.sales || []).length }), { p: 0, n: 0 })
  const monthFrom = day.slice(0, 7) + '-01'
  const mtd = sumDays(monthFrom, day)
  const folio = Object.values(D.WB_DATA.folio || {}).find((f: Json) => f.start <= day && f.end >= day) as Json | undefined
  const ftd = folio ? sumDays(folio.start, day) : null
  const [y, m] = day.split('-').map(Number)
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  let left = 0; for (let d = step(day, 1); d <= monthEnd; d = step(d, 1)) left++

  // by producer: the day's quotes and sales, and the month to date
  const producers = useMemo(() => {
    const p: Record<string, { q: number; qp: number; n: number; prem: number; mtd: number }> = {}
    const row = (k: string) => (p[k || 'Unassigned'] = p[k || 'Unassigned'] || { q: 0, qp: 0, n: 0, prem: 0, mtd: 0 })
    quotes.forEach((q) => { const r = row(q.producer); r.q++; r.qp += Number(q.quotedPremium) || 0 })
    sales.forEach((s) => { const r = row(s.producer); r.n++; r.prem += Number(s.premium) || 0 })
    Object.entries(daily).filter(([d]) => d >= monthFrom && d <= day).forEach(([, v]) => (v.sales || []).forEach((s: Json) => { row(s.producer).mtd += Number(s.premium) || 0 }))
    return Object.entries(p).sort((a, b) => b[1].prem - a[1].prem || b[1].mtd - a[1].mtd)
  }, [quotes, sales, daily, monthFrom, day])

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

  // phone activity: every call Ricochet reported for the day (ricochet-webhook)
  const calls = useAsync(async () => {
    const { data, error } = await supabase.from('ricochet_calls').select('agent, direction, duration_sec, talk_sec, disposition').eq('day', day)
    return error ? [] : (data as Call[])
  }, [day])

  const agency = agencyName(me)
  return (
    <div className="rp">
      <header className="rp-band">
        <div className="rp-band-l">
          <div className="rp-kick">Performance</div>
          <h1>Daily Huddle Report</h1>
          <div className="rp-who">{longDay(day)} · for the {mdy(step(day, 1))} huddle</div>
        </div>
        <div className="rp-band-r">
          <div className="rp-agency">{agency}</div>
          {folio && <div className="rp-folio">Folio {mdy(folio.start)} – {mdy(folio.end)}</div>}
          <div className="rp-actions">
            <button className="rp-btn" onClick={() => go(step(day, -1))} aria-label="Previous day">‹ Prev</button>
            <input type="date" className="fld" value={day} max={step(today, -1)} onChange={(e) => go(e.target.value || step(today, -1))} aria-label="Day" />
            <button className="rp-btn" disabled={day >= step(today, -1)} onClick={() => go(step(day, 1))} aria-label="Next day">Next ›</button>
            {day !== step(today, -1) && <button className="rp-btn" onClick={() => setDay(step(today, -1))}>Yesterday</button>}
          </div>
        </div>
      </header>

      <section className="rp-hero">
        <div className="rp-hero-main">
          <div className="rp-k">Premium written · {weekday(day)}</div>
          <div className="rp-big">{money0(written)}</div>
          <div className="rp-muted">{sales.length} polic{sales.length === 1 ? 'y' : 'ies'} · {customers} customer{customers === 1 ? '' : 's'} · AgencyZoom sales ledger</div>
        </div>
        <div className="rp-parts">
          <div className="rp-part k-save"><div className="rp-k">Policies written</div><div className="rp-part-v">{sales.length}</div><div className="rp-muted">{sales.length ? money0(written / sales.length) + ' average' : 'none'}</div></div>
          <div className="rp-part k-cross_sell"><div className="rp-k">Quotes</div><div className="rp-part-v">{quotes.length}</div><div className="rp-muted">leads quoted</div></div>
          <div className="rp-part k-new_business"><div className="rp-k">Quoted premium</div><div className="rp-part-v">{money0(quoted)}</div><div className="rp-muted">across {quotes.length} quote{quotes.length === 1 ? '' : 's'}</div></div>
          <div className="rp-part k-review"><div className="rp-k">SDR transfers</div><div className="rp-part-v">{transfers.length}</div><div className="rp-muted">{transfers.filter((t) => t.azQualifies).length} qualified · {transfers.filter((t) => t.bound).length} bound</div></div>
        </div>
      </section>
      <div className="rp-cards rp-cards-3">
        <GoalCard label={`Month to date · through ${mdy(day).slice(0, 5)}`} show={money0(mtd.p)} note={`${mtd.n} policies · ${left} working day${left === 1 ? '' : 's'} left`} good={false} neutral />
        <GoalCard label={folio ? `Folio to date · ${mdy(folio.start).slice(0, 5)} – ${mdy(folio.end).slice(0, 5)}` : 'Folio to date'} show={ftd ? money0(ftd.p) : '—'} note={ftd ? `${ftd.n} policies` : 'no folio on file'} good={false} neutral />
        <GoalCard label="Quote to sale" show={quotes.length ? Math.round((customers / quotes.length) * 100) + '%' : '—'} note="customers written ÷ leads quoted that day" good={false} neutral />
      </div>

      <Section title="Phone activity" sub={`Ricochet · ${mdy(day)} · a contact is a call with 30+ seconds of talk time`}>
        {!calls.data ? <Loading what="Loading calls" /> : <PhoneActivity calls={calls.data} day={day} />}
      </Section>

      <Section title="By producer" sub={`${weekday(day)} · and the month to date`}>
        {producers.length ? (
          <div className="tbl-wrap"><table className="rp-tbl">
            <thead><tr><th>Producer</th><th className="r">Quotes</th><th className="r">Quoted $</th><th className="r">Policies</th><th className="r">Premium written</th><th className="r">MTD premium</th></tr></thead>
            <tbody>
              {producers.map(([n, r]) => (
                <tr key={n}><td className="strong">{n}</td><td className="r mono">{r.q}</td><td className="r mono">{money0(r.qp)}</td><td className="r mono">{r.n}</td>
                  <td className={'r mono strong' + (r.prem ? ' up' : '')}>{money0(r.prem)}</td><td className="r mono">{money0(r.mtd)}</td></tr>
              ))}
              <tr className="rp-strong"><td>Total</td><td className="r mono">{quotes.length}</td><td className="r mono">{money0(quoted)}</td><td className="r mono">{sales.length}</td><td className="r mono up">{money0(written)}</td><td className="r mono">{money0(mtd.p)}</td></tr>
            </tbody>
          </table></div>
        ) : <div className="rp-empty">No quotes or sales on {mdy(day)}.</div>}
      </Section>

      <Section title="Policies written" sub={`${sales.length} on ${mdy(day)}`}>
        {sales.length ? (
          <div className="tbl-wrap"><table className="rp-tbl">
            <thead><tr><th>Customer</th><th>Producer</th><th>Line</th><th>Carrier</th><th className="r">Premium</th></tr></thead>
            <tbody>{sales.map((s, i) => (
              <tr key={(s.id || s.name) + i}><td className="strong">{s.name}</td><td>{s.producer}</td><td>{s.policyType}</td><td>{s.carrier}</td><td className="r mono strong up">{money0(Number(s.premium) || 0)}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <div className="rp-empty">Nothing written on {mdy(day)}.</div>}
      </Section>

      <Section title="Quotes" sub={`${quotes.length} leads quoted on ${mdy(day)}`}>
        {quotes.length ? (
          <div className="tbl-wrap"><table className="rp-tbl">
            <thead><tr><th>Lead</th><th>Producer</th><th>Lines</th><th>Source</th><th className="r">Quoted</th></tr></thead>
            <tbody>{quotes.map((q, i) => (
              <tr key={(q.leadId || q.name) + i}><td className="strong">{q.name}</td><td>{q.producer}</td>
                <td>{Array.isArray(q.lines) ? q.lines.join(', ') : q.lines || (q.quotes || []).map((x: Json) => x.product).filter(Boolean).join(', ')}</td>
                <td className="rp-muted">{q.leadSource || ''}</td><td className="r mono strong">{money0(Number(q.quotedPremium) || 0)}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <div className="rp-empty">No quotes on {mdy(day)}.</div>}
      </Section>

      <Section title="SDR transfers" sub={`${transfers.length} on ${mdy(day)}`}>
        {transfers.length ? (
          <div className="tbl-wrap"><table className="rp-tbl">
            <thead><tr><th>SDR</th><th>Client</th><th>Producer</th><th>Status</th><th>Qualified</th><th>Bound</th></tr></thead>
            <tbody>{transfers.map((t) => (
              <tr key={t.leadId}><td className="strong">{t.sdr}</td><td>{t.client}</td><td>{t.producer}</td><td>{t.status}</td>
                <td>{t.azQualifies ? <span className="rp-pill k-save">Yes</span> : <span className="rp-muted">Not yet</span>}</td>
                <td>{t.bound ? <span className="rp-pill k-save">Bound</span> : ''}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <div className="rp-empty">No SDR transfers on {mdy(day)}.</div>}
      </Section>

      <Section title="Client success" sub={`retention scorecard and log · ${mdy(day)}`} right={<Link className="linkbtn" to="/retention">Open Retention ›</Link>}>
        {!ret.data ? <Loading what="Loading client success" /> : <ClientSuccess d={ret.data.d} l={ret.data.l} day={day} />}
      </Section>

      <Section title="The month by day" sub={`premium written each workday · ${new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`}>
        <div className="rp-chart">{byDay.map((x) => (
          <button key={x.d} className={'rp-col rp-col-btn' + (x.d === day ? ' on' : '')} onClick={() => go(x.d)} title={`${mdy(x.d)} · ${money0(x.p)}`}>
            <div className="rp-col-v up">{x.p ? money0(x.p).replace(/,\d{3}$/, 'k') : ''}</div>
            <div className="rp-col-track"><div className="rp-col-bar" style={{ height: Math.max(x.p ? 3 : 0, (x.p / maxDay) * 100) + '%' }} /></div>
            <div className="rp-col-m">{x.d.slice(8)}</div>
          </button>
        ))}</div>
      </Section>

      <div className="rp-muted" style={{ marginTop: 18 }}><Link to="/sales-kpis">Full Sales KPIs by period ›</Link></div>
    </div>
  )
}

interface Call { agent: string | null; direction: string | null; duration_sec: number | null; talk_sec: number | null; disposition: string | null }
const hm = (s: number) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m` }

function PhoneActivity({ calls, day }: { calls: Call[]; day: string }) {
  if (!calls.length) return <div className="rp-empty">No calls from Ricochet on {mdy(day)}. Calls show up here once Ricochet's call webhook is sending them.</div>
  const by: Record<string, { dials: number; inbound: number; contacts: number; talk: number }> = {}
  const tot = { dials: 0, inbound: 0, contacts: 0, talk: 0 }
  calls.forEach((c) => {
    const r = (by[c.agent || 'Unassigned'] = by[c.agent || 'Unassigned'] || { dials: 0, inbound: 0, contacts: 0, talk: 0 })
    const talk = Number(c.talk_sec ?? c.duration_sec ?? 0)
    for (const x of [r, tot]) { if (c.direction === 'inbound') x.inbound++; else x.dials++; if (talk >= 30) x.contacts++; x.talk += talk }
  })
  const rows = Object.entries(by).sort((a, b) => b[1].dials + b[1].inbound - (a[1].dials + a[1].inbound))
  return (<>
    <div className="rp-cards">
      <GoalCard label="Dials" show={String(tot.dials)} note="outbound calls" good={false} neutral />
      <GoalCard label="Inbound calls" show={String(tot.inbound)} note="answered or missed" good={false} neutral />
      <GoalCard label="Contacts" show={String(tot.contacts)} note={tot.dials + tot.inbound ? Math.round((tot.contacts / (tot.dials + tot.inbound)) * 100) + '% of calls' : ''} good={false} neutral />
      <GoalCard label="Talk time" show={hm(tot.talk)} note={`${calls.length} calls`} good={false} neutral />
    </div>
    <div className="tbl-wrap"><table className="rp-tbl">
      <thead><tr><th>Agent</th><th className="r">Dials</th><th className="r">Inbound</th><th className="r">Contacts</th><th className="r">Talk time</th></tr></thead>
      <tbody>{rows.map(([n, r]) => (
        <tr key={n}><td className="strong">{n}</td><td className="r mono">{r.dials}</td><td className="r mono">{r.inbound}</td><td className="r mono">{r.contacts}</td><td className="r mono">{hm(r.talk)}</td></tr>
      ))}</tbody>
    </table></div>
  </>)
}

function ClientSuccess({ d, l, day }: { d: RetentionDay[]; l: RetentionEntry[]; day: string }) {
  const mv = movement(l)
  const sum = (k: keyof RetentionDay) => d.reduce((a, x) => a + Number(x[k] || 0), 0)
  if (!d.length && !l.length) return <div className="rp-empty">Nothing logged on {mdy(day)}.</div>
  return (<>
    <div className="rp-cards">
      <GoalCard label="At-risk touches" show={`${sum('at_risk_touches')} / 15`} pct={sum('at_risk_touches') / 15} good={sum('at_risk_touches') >= 15} />
      <GoalCard label="Renewal conversations" show={`${sum('renewal_conversations')} / 5`} pct={sum('renewal_conversations') / 5} good={sum('renewal_conversations') >= 5} tone="teal" />
      <GoalCard label="Net Book Movement" show={money0(mv.net)} note={`${mv.saved.n} saved · ${mv.cross.n} cross-sell · ${mv.fresh.n} new · ${mv.lost.n} lost`} good={mv.net >= 0} />
      <GoalCard label="Service calls" show={String(l.filter((e) => e.kind === 'review').length)} note={`${sum('escalations_same_day')} of ${sum('escalations')} escalations same day`} good />
    </div>
    {l.length > 0 && (
      <div className="tbl-wrap"><table className="rp-tbl rp-log">
        <thead><tr><th>Who</th><th>Type</th><th>Client</th><th className="r">Premium</th><th>Notes</th></tr></thead>
        <tbody>{l.map((e) => (
          <tr key={e.id}><td className="rp-muted">{e.name.split(' ')[0]}</td><td><span className={'rp-pill k-' + e.kind}>{RET_KIND[e.kind]}</span></td><td className="strong">{e.client}</td>
            <td className={'r mono strong ' + (e.kind === 'loss' ? 'down' : e.kind === 'review' ? 'rp-muted' : 'up')}>{e.kind === 'review' ? '—' : (e.kind === 'loss' ? '−' : '+') + money0(Number(e.premium))}</td>
            <td className="rp-notes">{[e.reason, e.note].filter(Boolean).join(' · ') || '—'}</td></tr>
        ))}</tbody>
      </table></div>
    )}
  </>)
}
