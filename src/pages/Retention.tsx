import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { useFolio } from '../components/FolioPicker'
import { Empty, ErrorBox, Loading, PageHead, Tile, Tiles } from '../components/ui'
import { GoalCard, Section } from '../components/Report'
import { mdy, money0, todayPacific } from '../lib/format'
import { supabase } from '../lib/supabase'
import { agencyName } from '../lib/data'
import { downloadRetentionPdf } from '../lib/retentionPdf'
import { useAsync } from '../lib/useAsync'
import type { BonusTier } from '../lib/payday'
import { LOSS_REASONS, ROLE_FROM, TARGETS, folioBonus, monthEnd, monthLabel, movement, type RetentionDay, type RetentionEntry, type RetentionMonth } from '../lib/retention'

/** Retention & book growth: the Director of Client Success's daily huddle scorecard. Log the day's numbers, every
 *  documented save, loss, cross-sell and new business, and see Net Book Movement (saved + cross-sell + new business − lost premium), the huddle
 *  talk track filled in, and how the month's bonus gates stand. The person in the role sees their own; admins see it
 *  too (and can pick whose, if more than one person has the role). */

const KIND_LABEL: Record<RetentionEntry['kind'], string> = { save: 'Save', loss: 'Loss', cross_sell: 'Cross-sell', new_business: 'New business', review: 'Service / review' }
const blankDay = (name: string, day: string): RetentionDay => ({ name, day, at_risk_touches: 0, renewal_conversations: 0, escalations: 0, escalations_same_day: 0, open_critical_aged: 0, brokered_current: true, priority: '' })
const weekStart = (day: string) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10) }
const stepWorkday = (day: string, by: 1 | -1) => { const d = new Date(day + 'T12:00:00Z'); do { d.setUTCDate(d.getUTCDate() + by) } while (d.getUTCDay() === 0 || d.getUTCDay() === 6); return d.toISOString().slice(0, 10) }
const prevWorkday = (day: string) => stepWorkday(day, -1)
const longDay = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

export default function Retention() {
  const { me } = useAuth()
  const today = todayPacific()
  const [month, setMonth] = useState(today.slice(0, 7))
  // the day shown in the daily section (switching to a day in another month shows that month)
  const [day, setDay] = useState(today)
  const goDay = (d: string) => { const c = d > today ? today : d < ROLE_FROM ? ROLE_FROM : d; setDay(c); setMonth(c.slice(0, 7)) }
  const [reload, setReload] = useState(0)
  const [adding, setAdding] = useState(false)
  const bump = () => setReload((n) => n + 1)

  // whose report: your own if the role is yours, otherwise (an admin) the people who have it
  const people = useAsync(async () => {
    const { data, error } = await supabase.from('staff_accounts').select('producer_name, access').eq('access->>retention', 'true')
    if (error) throw error
    return (data as { producer_name: string | null }[]).map((r) => r.producer_name).filter(Boolean) as string[]
  }, [])
  const mineRole = !!(me?.access as Record<string, unknown> | undefined)?.retention
  const [picked, setPicked] = useState('')
  const name = mineRole ? (me?.producer_name || me?.display_name || '') : (picked || people.data?.[0] || '')

  // the folio the day falls in (the bonus is measured on folios)
  const { folios } = useFolio()
  const openFolio = folios.find((f) => f.in_progress) || folios.find((f) => f.start_date <= today && f.end_date >= today)
  const folio = folios.find((f) => f.start_date <= day && f.end_date >= day) || openFolio

  // everything from the start of the year (or of the folio, if earlier) through today: the report is small
  const year = day.slice(0, 4)
  const from = folio && folio.start_date < year + '-01-01' ? folio.start_date : year + '-01-01'
  const data = useAsync(async () => {
    if (!name) return null
    const [days, log] = await Promise.all([
      supabase.from('retention_days').select('*').eq('name', name).gte('day', from).lte('day', today).order('day').then((r) => { if (r.error) throw r.error; return r.data as RetentionDay[] }),
      supabase.from('retention_log').select('*').eq('name', name).gte('day', from).lte('day', today).order('day', { ascending: false }).order('id', { ascending: false }).then((r) => { if (r.error) throw r.error; return r.data as RetentionEntry[] }),
    ])
    return { days, log }
  }, [name, from, today, reload])

  const bonus = useAsync(async () => {
    if (!name || !folio) return null
    const [tiers, rec] = await Promise.all([
      supabase.from('hr_staff').select('bonus_tiers').eq('name', name).maybeSingle().then((r) => (r.data as { bonus_tiers: BonusTier[] | null } | null)?.bonus_tiers || null),
      supabase.from('retention_months').select('*').eq('name', name).eq('month', folio.start_date).maybeSingle().then((r) => { if (r.error) throw r.error; return r.data as RetentionMonth | null }),
    ])
    return { ...(await folioBonus(name, tiers, folio, today)), tiers: tiers || [], rec }
  }, [name, folio?.start_date, folio?.end_date, reload])

  const head = <PageHead kicker="Client success" title="Retention & book growth" />
  if (people.error || data.error) return <>{head}<ErrorBox error={people.error || data.error} /></>
  if (!name && people.data) return <>{head}<Empty>No one has the retention role yet. Switch on “Retention scorecard” for them under Settings → Team & access.</Empty></>
  if (!data.data) return <>{head}<Loading what="Loading the report" /></>

  const { days, log } = data.data
  const monthLog = log.filter((e) => e.day.startsWith(month))
  const mv = movement(monthLog)
  const live = month === today.slice(0, 7)
  const saves = log.filter((e) => e.kind === 'save' && e.day >= weekStart(today)).length
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(today.slice(0, 7) + '-15T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - i); return d.toISOString().slice(0, 7) }).filter((m) => m >= '2026-10')
  const agency = agencyName(me)

  // the day, folio, month and year to date as of the day picked
  const rec = days.find((d) => d.day === day), dayLog = log.filter((e) => e.day === day)
  const periods = [
    { label: day === today ? 'Today' : weekday(day), from: day, to: day },
    ...(folio ? [{ label: 'This folio', from: folio.start_date, to: folio.end_date < day ? folio.end_date : day }] : []),
    { label: 'This month', from: day.slice(0, 7) + '-01', to: day },
    { label: 'Year to date', from: year + '-01-01', to: day },
  ]
  const stats = periods.map((p) => {
    const l = log.filter((e) => e.day >= p.from && e.day <= p.to), d = days.filter((x) => x.day >= p.from && x.day <= p.to)
    const sum = (k: keyof RetentionDay) => d.reduce((a, x) => a + Number(x[k] || 0), 0)
    return { mv: movement(l), reviews: l.filter((e) => e.kind === 'review').length, touches: sum('at_risk_touches'), convos: sum('renewal_conversations'),
      esc: sum('escalations'), same: d.reduce((a, x) => a + Math.min(x.escalations_same_day, x.escalations), 0), logged: d.length }
  })
  const mtd = stats[periods.findIndex((p) => p.label === 'This month')]
  const talk = `${day === today ? 'Today' : 'On ' + weekday(day)} I completed ${rec?.at_risk_touches ?? 0} at-risk touches and ${rec?.renewal_conversations ?? 0} live renewal conversations. ` +
    `I saved ${stats[0].mv.saved.n} policies / ${money0(stats[0].mv.saved.p)} premium, lost ${stats[0].mv.lost.n} policies / ${money0(stats[0].mv.lost.p)} premium, and generated ${money0(stats[0].mv.cross.p)} in cross-sell premium and ${money0(stats[0].mv.fresh.p)} in new business. ` +
    `My MTD Net Book Movement is ${money0(mtd.mv.net)}. I have ${rec?.open_critical_aged ?? 0} critical cases open past a day.` + (rec?.priority ? ` My priority: ${rec.priority.replace(/\.$/, '')}.` : '')
  const yearMonths = [...new Set([...log.map((e) => e.day.slice(0, 7)), ...days.map((d) => d.day.slice(0, 7))])].filter((m) => m.startsWith(year)).sort()
  const byMonth = yearMonths.map((m) => ({ m, ...movement(log.filter((e) => e.day.startsWith(m))), notes: log.filter((e) => e.day.startsWith(m) && e.kind === 'review').length }))
  const maxNet = Math.max(1, ...byMonth.map((x) => Math.abs(x.net)))

  return (
    <div className="rp">
      <header className="rp-band">
        <div className="rp-band-l">
          <div className="rp-kick">Retention &amp; Book Growth</div>
          <h1>Performance Report</h1>
          <div className="rp-who">{name} · Director of Client Success, Retention &amp; Book Growth</div>
        </div>
        <div className="rp-band-r">
          <div className="rp-agency">{agency}</div>
          {folio && <div className="rp-folio">Folio {mdy(folio.start_date)} – {mdy(folio.end_date)}</div>}
          <div className="rp-actions">
            {!mineRole && (people.data?.length || 0) > 1 && <select className="fld" value={name} onChange={(e) => setPicked(e.target.value)} aria-label="Person">{people.data!.map((p) => <option key={p}>{p}</option>)}</select>}
            <select className="fld" value={month} onChange={(e) => { const m = e.target.value; setMonth(m); setDay(m === today.slice(0, 7) ? today : monthEnd(m)) }} aria-label="Month">{(months.length ? months : [month]).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
            <HuddleButton className="rp-btn" name={name} day={prevWorkday(today)} agency={agency} label="Huddle PDF" />
            <PdfButton className="rp-btn" name={name} folio={openFolio || null} agency={agency} />
          </div>
        </div>
      </header>

      {/* Net Book Movement and its four parts */}
      <section className="rp-hero">
        <div className="rp-hero-main">
          <div className="rp-k">Net Book Movement · {live ? `${monthLabel(month)} so far` : monthLabel(month)}</div>
          <div className={'rp-big' + (mv.net < 0 ? ' neg' : '')}>{money0(mv.net)}</div>
          <div className="rp-muted">saved + cross-sell + new business − lost premium</div>
        </div>
        <div className="rp-parts">
          {([['Saved', mv.saved, 'save'], ['Cross-sell', mv.cross, 'cross_sell'], ['New business', mv.fresh, 'new_business'], ['Lost', mv.lost, 'loss']] as const).map(([l, x, k]) => (
            <div key={l} className={'rp-part k-' + k}><div className="rp-k">{l}</div><div className="rp-part-v">{money0(x.p)}</div><div className="rp-muted">{x.n} polic{x.n === 1 ? 'y' : 'ies'}</div></div>
          ))}
        </div>
      </section>
      <div className="rp-cards rp-cards-3">
        <GoalCard label="Saves this week" show={`${saves} / ${TARGETS.savesPerWeek}`} pct={saves / TARGETS.savesPerWeek} good={saves >= TARGETS.savesPerWeek} />
        <GoalCard label={`Cancellations · ${monthLabel(month)}`} show={`${mv.lost.n} of ≤${TARGETS.cancellationsMax}`} pct={mv.lost.n / TARGETS.cancellationsMax} good={mv.lost.n <= TARGETS.cancellationsMax} limit />
        <GoalCard label={`Net PIF · ${monthLabel(month)}`} show={`${mv.netPif > 0 ? '+' : ''}${mv.netPif} / ${TARGETS.netPif}`} pct={mv.netPif / TARGETS.netPif} good={mv.netPif >= TARGETS.netPif} />
      </div>

      {/* one day at a time */}
      <Section title={day === today ? 'Today' : `${weekday(day)}’s work`} sub={longDay(day)}
        right={<div className="rt-daynav">
          <button className="btn-ghost" disabled={day <= ROLE_FROM} onClick={() => goDay(stepWorkday(day, -1))} aria-label="Previous day">‹ Prev</button>
          <input type="date" className="fld" value={day} min={ROLE_FROM} max={today} onChange={(e) => goDay(e.target.value || today)} aria-label="Day" />
          <button className="btn-ghost" disabled={day >= today} onClick={() => goDay(stepWorkday(day, 1))} aria-label="Next day">Next ›</button>
          {day !== today && <button className="btn-ghost" onClick={() => goDay(today)}>Today</button>}
          <HuddleButton name={name} day={day} agency={agency} label="PDF for this day" />
        </div>}>
        <div className="rp-cards">
          <GoalCard label="At-risk touches" show={`${rec?.at_risk_touches ?? 0} / ${TARGETS.touches}`} pct={(rec?.at_risk_touches ?? 0) / TARGETS.touches} good={(rec?.at_risk_touches ?? 0) >= TARGETS.touches} />
          <GoalCard label="Renewal conversations" show={`${rec?.renewal_conversations ?? 0} / ${TARGETS.conversations}`} pct={(rec?.renewal_conversations ?? 0) / TARGETS.conversations} good={(rec?.renewal_conversations ?? 0) >= TARGETS.conversations} tone="teal" />
          <GoalCard label="Escalations same day" show={rec?.escalations ? `${Math.min(rec.escalations_same_day, rec.escalations)} / ${rec.escalations}` : 'none'} pct={rec?.escalations ? rec.escalations_same_day / rec.escalations : 0} good={!rec?.escalations || rec.escalations_same_day >= rec.escalations} tone="violet" />
          <GoalCard label="Critical cases aged >1 day" show={String(rec?.open_critical_aged ?? 0)} good={(rec?.open_critical_aged ?? 0) === 0} note={(rec?.open_critical_aged ?? 0) === 0 ? 'goal met' : 'needs an owner'} />
        </div>
        {!rec && <div className="rp-warn">{[0, 6].includes(new Date(day + 'T12:00:00Z').getUTCDay()) ? 'A weekend day — no scorecard due.' : 'The scorecard for this day isn’t logged yet — update it below.'}</div>}
        {rec?.priority && <div className="rp-priority"><span>Priority</span>{rec.priority}</div>}
        <EntryTable entries={dayLog} empty={`Nothing logged on ${mdy(day)}.`} />
        <div className="rp-talk">
          <div className="rp-talk-h"><span>Huddle talk track · for the {mdy(stepWorkday(day, 1))} huddle</span>
            <button className="linkbtn" onClick={() => navigator.clipboard?.writeText(talk).then(() => alert('Copied.'), () => {})}>Copy</button></div>
          <p>“{talk}”</p>
        </div>
      </Section>

      <Section title="At a glance" sub={`${periods[0].label.toLowerCase()} · folio · month · year to date`}>
        <div className="tbl-wrap"><table className="rp-tbl rp-glance">
          <thead><tr><th />{periods.map((p) => <th key={p.label} className="r">{p.label}</th>)}</tr></thead>
          <tbody>
            {([['Net Book Movement', (s) => money0(s.mv.net), 'navy'], ['Saved premium', (s) => `${money0(s.mv.saved.p)} (${s.mv.saved.n})`, 'save'],
              ['Cross-sell premium', (s) => `${money0(s.mv.cross.p)} (${s.mv.cross.n})`, 'cross_sell'], ['New business premium', (s) => `${money0(s.mv.fresh.p)} (${s.mv.fresh.n})`, 'new_business'],
              ['Lost premium', (s) => `${money0(s.mv.lost.p)} (${s.mv.lost.n})`, 'loss'], ['Service / review calls', (s) => String(s.reviews), ''],
              ['At-risk touches', (s) => String(s.touches), ''], ['Live renewal conversations', (s) => String(s.convos), ''],
              ['Escalations contacted same day', (s) => (s.esc ? `${s.same} of ${s.esc}` : '—'), ''], ['Scorecard days logged', (s) => String(s.logged), '']] as [string, (s: (typeof stats)[number]) => string, string][]).map(([l, f, k], i) => (
              <tr key={l} className={i === 0 ? 'rp-strong' : undefined}>
                <td>{k && <i className={'rp-dot k-' + k} />}{l}</td>
                {stats.map((s, j) => <td key={j} className={'r mono' + (i === 0 ? (s.mv.net >= 0 ? ' up' : ' down') : '')}>{f(s)}</td>)}
              </tr>
            ))}
          </tbody>
        </table></div>
      </Section>

      {folio && (
        <Section title="This folio" sub={`${mdy(folio.start_date)} – ${mdy(folio.end_date)} · bonus and its four gates`}>
          {bonus.error ? <ErrorBox error={bonus.error} /> : !bonus.data ? <Loading what="Adding up the folio" /> : <FolioBonus b={bonus.data} name={name} folioStart={folio.start_date} today={today} who={me?.display_name || 'staff'} onSaved={bump} />}
        </Section>
      )}

      <Section title={`${monthLabel(month)} log`} sub={`${monthLog.length} entr${monthLog.length === 1 ? 'y' : 'ies'} · saves, losses, cross-sells, new business and service notes`}
        right={<button className={adding ? 'btn-ghost' : 'btn-primary'} onClick={() => setAdding(!adding)}>{adding ? 'Close' : '+ Add to log'}</button>}>
        {adding && <LogForm name={name} today={today} onSaved={() => { bump(); setAdding(false) }} />}
        <EntryTable entries={monthLog} empty={`Nothing logged for ${monthLabel(month)} yet.`} onRemove={async (e) => { if (!confirm(`Remove this ${KIND_LABEL[e.kind].toLowerCase()} for ${e.client}?`)) return; const { error } = await supabase.from('retention_log').delete().eq('id', e.id); if (error) alert(error.message); else bump() }} />
      </Section>

      <Section title={`${year} month by month`} sub="Net Book Movement each month">
        {byMonth.length ? (<>
          <div className="rp-chart">{byMonth.map((x) => (
            <div key={x.m} className="rp-col">
              <div className={'rp-col-v' + (x.net < 0 ? ' down' : ' up')}>{money0(x.net)}</div>
              <div className="rp-col-track"><div className={'rp-col-bar' + (x.net < 0 ? ' down' : '')} style={{ height: Math.max(3, (Math.abs(x.net) / maxNet) * 100) + '%' }} /></div>
              <div className="rp-col-m">{new Date(x.m + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}</div>
            </div>
          ))}</div>
          <div className="tbl-wrap"><table className="rp-tbl">
            <thead><tr><th>Month</th><th className="r">Saved</th><th className="r">Cross-sell</th><th className="r">New business</th><th className="r">Lost</th><th className="r">Net movement</th><th className="r">Service</th></tr></thead>
            <tbody>{byMonth.map((x) => (
              <tr key={x.m}><td className="strong">{monthLabel(x.m)}</td><td className="r mono c-save">{money0(x.saved.p)} ({x.saved.n})</td><td className="r mono c-cross_sell">{money0(x.cross.p)} ({x.cross.n})</td>
                <td className="r mono c-new_business">{money0(x.fresh.p)} ({x.fresh.n})</td><td className="r mono c-loss">{money0(x.lost.p)} ({x.lost.n})</td>
                <td className={'r mono strong ' + (x.net >= 0 ? 'up' : 'down')}>{money0(x.net)}</td><td className="r mono c-review">{x.notes}</td></tr>
            ))}</tbody>
          </table></div>
        </>) : <div className="rp-empty">Nothing logged this year yet.</div>}
      </Section>

      <DayForm key={name + day} name={name} day={day} days={days} today={today} onSaved={bump} />

      <Section title="How the day runs" sub="The daily rhythm from the plan">
        <details className="rt-rhythm"><summary>Show the schedule and escalation triggers</summary><table className="tbl"><tbody>
          {[['8:30–9:00', 'Review IVR, Service Advantage and open-service queues', 'Prioritized case list and huddle numbers'],
            ['9:00–10:00', 'Scan upcoming renewals, nonpayment and cancellation-risk lists', 'First retention contacts before huddle'],
            ['10:00', 'Huddle: yesterday, month-to-date and open exceptions', 'Today’s saves, calls and resolutions committed'],
            ['10:15–12:00', 'Live renewal, save and escalation conversations', 'Documented outcomes, premium saved or next action'],
            ['1:00–2:30', 'Brokered renewals, remarketing, payment and carrier follow-up', 'Paid, bound and reconciled brokered business'],
            ['2:30–3:30', 'Coverage reviews, cross-sell and producer handoffs', 'Qualified opportunities and incremental premium'],
            ['3:30–4:30', 'Close cases, update SOPs and reconcile the scorecard', 'No unowned critical case; board updated by 4:30']].map(([t, f, o]) => (
            <tr key={t}><td className="mono" style={{ whiteSpace: 'nowrap' }}>{t}</td><td><div className="strong">{f}</div><div className="sub">{o}</div></td></tr>
          ))}
        </tbody></table>
        <div className="sub" style={{ marginTop: 8 }}>Escalate immediately: rate increase or price complaint, cancellation or nonrenewal language, nonpayment or reinstatement risk, coverage reduction because of price, dissatisfaction or complaint, underwriting or missing information, brokered renewal/payment/carrier concern, or a request for a manager. A transfer doesn’t end ownership.</div></details>
      </Section>
    </div>
  )
}

const weekday = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })

/** The log as the PDF's table: day, a colored type pill, client and carrier, premium, notes. */
function EntryTable({ entries, empty, onRemove }: { entries: RetentionEntry[]; empty: string; onRemove?: (e: RetentionEntry) => void }) {
  if (!entries.length) return <div className="rp-empty">{empty}</div>
  return (
    <div className="tbl-wrap"><table className="rp-tbl rp-log">
      <thead><tr><th>Day</th><th>Type</th><th>Client</th><th className="r">Premium</th><th>Notes</th>{onRemove && <th />}</tr></thead>
      <tbody>{entries.map((e) => (
        <tr key={e.id}>
          <td className="mono rp-muted">{mdy(e.day).slice(0, 5)}</td>
          <td><span className={'rp-pill k-' + e.kind}>{e.kind === 'review' ? 'Service' : KIND_LABEL[e.kind]}</span></td>
          <td><div className="strong">{e.client}</div>{e.carrier && <div className="rp-muted">{e.carrier}</div>}</td>
          <td className={'r mono strong ' + (e.kind === 'loss' ? 'down' : e.kind === 'review' ? 'rp-muted' : 'up')}>{e.kind === 'review' ? '—' : (e.kind === 'loss' ? '−' : '+') + money0(Number(e.premium))}</td>
          <td className="rp-notes">{[e.policies > 1 ? `${e.policies} policies` : '', e.reason, e.note].filter(Boolean).join(' · ') || '—'}</td>
          {onRemove && <td><button className="linkbtn" onClick={() => onRemove(e)}>remove</button></td>}
        </tr>
      ))}</tbody>
    </table></div>
  )
}

/** The folio bonus: agency premium written, the tier track, and the four gates (the fourth is the reconciliation mark). */
function FolioBonus({ b, name, folioStart, today, who, onSaved }: { b: Awaited<ReturnType<typeof folioBonus>> & { tiers: BonusTier[]; rec: RetentionMonth | null }; name: string; folioStart: string; today: string; who: string; onSaved: () => void }) {
  const tiers = [...b.tiers].sort((x, y) => Number(x.min) - Number(y.min))
  const top = Number(tiers[tiers.length - 1]?.min || 200000)
  const met = b.gates.filter((g) => g.ok).length
  return (<>
    <div className="rp-bonus">
      <div className="rp-bonus-l">
        <div className="rp-k">Agency premium written</div>
        <div className="rp-bonus-v">{money0(b.premium)}</div>
        <div className={b.tier.amount ? 'up strong' : 'warn strong'}>{b.tier.amount ? `${money0(b.tier.amount)} bonus level reached` : `Bonus starts at ${money0(Number(tiers[0]?.min || 100000))}`}</div>
        <span className={'rp-pill ' + (b.eligible ? 'k-save' : 'k-warn')}>{b.eligible ? 'All 4 gates met' : `${met} of 4 gates met`}</span>
      </div>
      <div className="rp-track">
        <div className="rp-bar big"><i style={{ width: Math.min(100, (b.premium / top) * 100) + '%' }} /></div>
        {tiers.map((t) => { const hit = b.premium >= Number(t.min); return (
          <div key={t.min} className={'rp-tier' + (hit ? ' hit' : '')} style={{ left: Math.min(100, (Number(t.min) / top) * 100) + '%' }}>
            <b>{money0(Number(t.amount))}</b><i /><span>at {money0(Number(t.min)).replace(',000', 'k')}</span>
          </div>) })}
      </div>
    </div>
    <div className="rp-gates">
      {b.gates.slice(0, 3).map((g) => <div key={g.label} className={'rp-gate' + (g.ok ? ' ok' : '')}><i>{g.ok ? '✓' : '!'}</i><div><div className="strong">{g.label}</div><div className="rp-muted">{g.detail}</div></div></div>)}
      <label className={'rp-gate' + (b.rec?.reconciled ? ' ok' : '')}>
        <input type="checkbox" checked={!!b.rec?.reconciled} onChange={async (e) => {
          const { error } = await supabase.from('retention_months').upsert({ name, month: folioStart, reconciled: e.target.checked, reconciled_note: e.target.checked ? `Reconciled ${mdy(today)} by ${who}` : null, updated_at: new Date().toISOString() }, { onConflict: 'agency_id,name,month' })
          if (error) alert(error.message); else onSaved()
        }} />
        <div><div className="strong">Premium reporting reconciled</div><div className="rp-muted">{b.rec?.reconciled ? b.rec.reconciled_note : 'Tick once Farmers and brokered reporting is reconciled and outstanding items have owners.'}</div></div>
      </label>
    </div>
  </>)
}

function DayForm({ name, day, days, today, onSaved }: { name: string; day: string; days: RetentionDay[]; today: string; onSaved: () => void }) {
  const saved = days.find((d) => d.day === day)
  const [draft, setDraft] = useState<RetentionDay>(() => saved || blankDay(name, day))
  const [busy, setBusy] = useState(false)
  const num = (k: keyof RetentionDay, label: string, goal?: string) => (
    <label className="rt-num"><span className="rt-num-l">{label}</span>
      <input className="fld" type="number" min={0} value={Number(draft[k]) || 0} onChange={(e) => setDraft({ ...draft, [k]: Math.max(0, Number(e.target.value) || 0) })} />
      <span className="rt-num-g">{goal || '\u00a0'}</span>
    </label>
  )
  const save = async () => {
    setBusy(true)
    const { error } = await supabase.from('retention_days').upsert({ ...draft, name, day, updated_at: new Date().toISOString() }, { onConflict: 'agency_id,name,day' })
    setBusy(false)
    if (error) alert(error.message); else onSaved()
  }
  return (
    <Section title={day === today ? 'Update today’s scorecard' : `Update the scorecard for ${mdy(day)}`} sub={saved ? 'saved · update it any time · pick the day above' : 'not logged yet · counts toward the 95% bonus gate'}>
      <div className="form-grid rt-day">
        {num('at_risk_touches', 'At-risk touches', `goal ${TARGETS.touches}`)}
        {num('renewal_conversations', 'Live renewal conversations', `goal ${TARGETS.conversations}`)}
        {num('escalations', 'Critical escalations', 'received today')}
        {num('escalations_same_day', 'Contacted same day', 'goal 100%')}
        {num('open_critical_aged', 'Critical cases aged >1 day', 'goal 0')}
        <label className="coi-tick rt-tick"><input type="checkbox" checked={draft.brokered_current} onChange={(e) => setDraft({ ...draft, brokered_current: e.target.checked })} /> Brokered business current</label>
        <label style={{ gridColumn: '1 / -1' }}>Today’s priority<input className="fld" value={draft.priority || ''} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} placeholder="e.g. Martinez renewal +18% — call before noon" /></label>
      </div>
      <div className="row-actions" style={{ marginTop: 12 }}><button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save scorecard'}</button></div>
    </Section>
  )
}

function LogForm({ name, today, onSaved }: { name: string; today: string; onSaved: () => void }) {
  const blank = { kind: 'save' as RetentionEntry['kind'], day: today, client: '', policies: 1, premium: '', carrier: '', reason: '', note: '' }
  const [d, setD] = useState(blank)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!d.client.trim()) return alert('Add the client’s name.')
    if (d.kind === 'loss' && !d.reason) return alert('Pick a reason for the loss.')
    setBusy(true)
    const { error } = await supabase.from('retention_log').insert({ name, kind: d.kind, day: d.day, client: d.client.trim(), policies: Number(d.policies) || 1, premium: d.kind === 'review' ? 0 : Number(d.premium) || 0, carrier: d.carrier || null, reason: d.reason || null, note: d.note || null })
    setBusy(false)
    if (error) alert(error.message); else { setD({ ...blank, kind: d.kind }); onSaved() }
  }
  return (
    <div className="rt-add">
      <div className="row-actions" role="group" aria-label="Type" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        {(['save', 'loss', 'cross_sell', 'new_business', 'review'] as const).map((k) => <button key={k} className={d.kind === k ? 'btn-primary' : 'btn-ghost'} onClick={() => setD({ ...d, kind: k })}>{KIND_LABEL[k]}</button>)}
      </div>
      <div className="form-grid">
        <label style={{ gridColumn: '1 / -1' }}>Client<input className="fld" value={d.client} onChange={(e) => setD({ ...d, client: e.target.value })} /></label>
        <label>Day<input className="fld" type="date" max={today} value={d.day} onChange={(e) => setD({ ...d, day: e.target.value || today })} /></label>
        <label>Policies<input className="fld" type="number" min={1} value={d.policies} onChange={(e) => setD({ ...d, policies: Math.max(1, Number(e.target.value) || 1) })} /></label>
        {d.kind !== 'review' && <label>Annual premium<input className="fld" type="number" min={0} step="1" value={d.premium} onChange={(e) => setD({ ...d, premium: e.target.value })} /></label>}
        <label>Carrier<input className="fld" value={d.carrier} onChange={(e) => setD({ ...d, carrier: e.target.value })} /></label>
        {d.kind === 'loss' && <label>Reason<select className="fld" value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })}><option value="">Pick one</option>{LOSS_REASONS.map((r) => <option key={r}>{r}</option>)}</select></label>}
        <label style={{ gridColumn: '1 / -1' }}>Note<input className="fld" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} /></label>
      </div>
      <div className="row-actions" style={{ marginTop: 12 }}><button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : `Log ${KIND_LABEL[d.kind].toLowerCase()}`}</button></div>
      <div className="sub" style={{ marginTop: 8 }}>A service / review entry is a note only and doesn’t change the totals. Every loss needs a reason.</div>
    </div>
  )
}

/** My Space for the person in the retention role: today's huddle numbers and the month so far, instead of the sales
 *  pipeline (the role takes no new-business leads). */
export function RetentionTiles({ name }: { name: string }) {
  const today = todayPacific(), month = today.slice(0, 7)
  const { data, error } = useAsync(async () => {
    const [days, log] = await Promise.all([
      supabase.from('retention_days').select('*').eq('name', name).gte('day', month + '-01').lte('day', today).then((r) => { if (r.error) throw r.error; return r.data as RetentionDay[] }),
      supabase.from('retention_log').select('*').eq('name', name).gte('day', weekStart(today) < month + '-01' ? weekStart(today) : month + '-01').lte('day', today).then((r) => { if (r.error) throw r.error; return r.data as RetentionEntry[] }),
    ])
    return { days, log }
  }, [name, month, today])
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading what="Loading your scorecard" />
  const td = data.days.find((d) => d.day === today)
  const mv = movement(data.log.filter((e) => e.day >= month + '-01'))
  const saves = data.log.filter((e) => e.kind === 'save' && e.day >= weekStart(today)).length
  return (
    <>
      <Tiles>
        <Tile label="Net Book Movement · MTD" value={money0(mv.net)} sub={`${money0(mv.saved.p)} saved + ${money0(mv.cross.p + mv.fresh.p)} cross-sell & new − ${money0(mv.lost.p)} lost`} tone={mv.net >= 0 ? 'good' : 'warn'} />
        <Tile label="At-risk touches today" value={`${td?.at_risk_touches ?? 0} / ${TARGETS.touches}`} sub={td ? 'from today’s scorecard' : 'today’s scorecard not logged yet'} tone={(td?.at_risk_touches ?? 0) >= TARGETS.touches ? 'good' : undefined} />
        <Tile label="Renewal conversations today" value={`${td?.renewal_conversations ?? 0} / ${TARGETS.conversations}`} sub="live conversations with next actions" tone={(td?.renewal_conversations ?? 0) >= TARGETS.conversations ? 'good' : undefined} />
        <Tile label="Saves this week" value={`${saves} / ${TARGETS.savesPerWeek}`} sub="documented saves since Monday" tone={saves >= TARGETS.savesPerWeek ? 'good' : undefined} />
        <Tile label="Critical cases aged >1 day" value={td?.open_critical_aged ?? 0} sub="goal 0 · owner and deadline on every case" tone={(td?.open_critical_aged ?? 0) > 0 ? 'warn' : 'good'} />
      </Tiles>
      <div className="sub" style={{ margin: '-6px 0 16px' }}><Link to="/retention">Open the retention scorecard →</Link></div>
    </>
  )
}

/** Downloads the daily huddle report for one workday (by default the one before today): that day's numbers, entries
 *  and talk track, with the folio, month and year to date as of that day. */
export function HuddleButton({ name, day, agency, label = 'Huddle PDF', className = 'btn-ghost' }: { name: string; day: string; agency: string; label?: string; className?: string }) {
  const [busy, setBusy] = useState(false)
  const { folios } = useFolio()
  const folio = folios.find((f) => f.start_date <= day && f.end_date >= day) || null
  return (
    <button className={className} disabled={busy || !name} title={`The ${mdy(day)} numbers for the daily huddle`} onClick={async () => {
      setBusy(true)
      try { await downloadRetentionPdf(name, folio, day, agency, true) } catch (e) { alert('The report could not be made: ' + String((e as Error)?.message || e)) } finally { setBusy(false) }
    }}>{busy ? 'Making the PDF…' : label}</button>
  )
}

/** Downloads the PDF report: today, the folio, the month and the year to date. */
export function PdfButton({ name, folio, agency, className = 'btn-ghost' }: { name: string; folio: { start_date: string; end_date: string } | null; agency: string; className?: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <button className={className} disabled={busy || !name} onClick={async () => {
      setBusy(true)
      try { await downloadRetentionPdf(name, folio, todayPacific(), agency) } catch (e) { alert('The report could not be made: ' + String((e as Error)?.message || e)) } finally { setBusy(false) }
    }}>{busy ? 'Making the PDF…' : 'Download PDF report'}</button>
  )
}
