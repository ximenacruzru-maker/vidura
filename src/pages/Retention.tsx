import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { useFolio } from '../components/FolioPicker'
import { Empty, ErrorBox, Loading, PageHead, Panel, Tile, Tiles } from '../components/ui'
import { mdy, money0, todayPacific } from '../lib/format'
import { supabase } from '../lib/supabase'
import { agencyName } from '../lib/data'
import { downloadRetentionPdf } from '../lib/retentionPdf'
import { useAsync } from '../lib/useAsync'
import { LOSS_REASONS, TARGETS, gates, monthEnd, monthLabel, movement, type RetentionDay, type RetentionEntry, type RetentionMonth } from '../lib/retention'

/** Retention & book growth: the Director of Client Success's daily huddle scorecard. Log the day's numbers, every
 *  documented save, loss and cross-sell, and see Net Book Movement (saved + cross-sell − lost premium), the huddle
 *  talk track filled in, and how the month's bonus gates stand. The person in the role sees their own; admins see it
 *  too (and can pick whose, if more than one person has the role). */

const KIND_LABEL: Record<RetentionEntry['kind'], string> = { save: 'Save', loss: 'Loss', cross_sell: 'Cross-sell', review: 'Service / review' }
const blankDay = (name: string, day: string): RetentionDay => ({ name, day, at_risk_touches: 0, renewal_conversations: 0, escalations: 0, escalations_same_day: 0, open_critical_aged: 0, brokered_current: true, priority: '' })
const weekStart = (day: string) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10) }
const prevWorkday = (day: string) => { const d = new Date(day + 'T12:00:00Z'); do { d.setUTCDate(d.getUTCDate() - 1) } while (d.getUTCDay() === 0 || d.getUTCDay() === 6); return d.toISOString().slice(0, 10) }

export default function Retention() {
  const { me } = useAuth()
  const today = todayPacific()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [reload, setReload] = useState(0)
  const [adding, setAdding] = useState(false)
  const bump = () => setReload((n) => n + 1)

  // whose scorecard: your own if the role is yours, otherwise (an admin) the people who have it
  const people = useAsync(async () => {
    const { data, error } = await supabase.from('staff_accounts').select('producer_name, access').eq('access->>retention', 'true')
    if (error) throw error
    return (data as { producer_name: string | null }[]).map((r) => r.producer_name).filter(Boolean) as string[]
  }, [])
  const mineRole = !!(me?.access as Record<string, unknown> | undefined)?.retention
  const [picked, setPicked] = useState('')
  const name = mineRole ? (me?.producer_name || me?.display_name || '') : (picked || people.data?.[0] || '')

  const from = month + '-01', to = monthEnd(month)
  const data = useAsync(async () => {
    if (!name) return null
    const yday = prevWorkday(from <= today && today <= to ? today : to)
    const [days, log, week] = await Promise.all([
      supabase.from('retention_days').select('*').eq('name', name).gte('day', from < yday ? from : yday).lte('day', to).order('day').then((r) => { if (r.error) throw r.error; return r.data as RetentionDay[] }),
      supabase.from('retention_log').select('*').eq('name', name).gte('day', from).lte('day', to).order('day', { ascending: false }).order('id', { ascending: false }).then((r) => { if (r.error) throw r.error; return r.data as RetentionEntry[] }),
      supabase.from('retention_log').select('*').eq('name', name).eq('kind', 'save').gte('day', weekStart(today)).lte('day', today).then((r) => { if (r.error) throw r.error; return r.data as RetentionEntry[] }),
    ])
    return { days, log, week }
  }, [name, from, to, reload])

  // the bonus is measured on folios: the gates show the folio open now, or the one that closed in the month picked
  const { folios } = useFolio()
  const openFolio = folios.find((f) => f.in_progress) || folios.find((f) => f.start_date <= today && f.end_date >= today)
  const gFolio = month === today.slice(0, 7) ? (folios.find((f) => f.in_progress) || folios.find((f) => f.start_date <= today && f.end_date >= today)) : folios.find((f) => f.end_date.slice(0, 7) === month)
  const gate = useAsync(async () => {
    if (!name || !gFolio) return null
    const [days, rec] = await Promise.all([
      supabase.from('retention_days').select('*').eq('name', name).gte('day', gFolio.start_date).lte('day', gFolio.end_date).then((r) => { if (r.error) throw r.error; return r.data as RetentionDay[] }),
      supabase.from('retention_months').select('*').eq('name', name).eq('month', gFolio.start_date).maybeSingle().then((r) => { if (r.error) throw r.error; return r.data as RetentionMonth | null }),
    ])
    return { rec, g: gates(gFolio, days, rec, today) }
  }, [name, gFolio?.start_date, gFolio?.end_date, reload])
  const rec = gate.data?.rec || null, g = gate.data?.g || []

  const head = <PageHead kicker="Client success" title="Retention & book growth" sub="Net Book Movement = saved premium + cross-sell premium − lost premium. Activity explains the result; it doesn’t replace it." />
  if (people.error || data.error) return <>{head}<ErrorBox error={people.error || data.error} /></>
  if (!name && people.data) return <>{head}<Empty>No one has the retention role yet. Switch on “Retention scorecard” for them under Settings → Team & access.</Empty></>
  if (!data.data) return <>{head}<Loading what="Loading the scorecard" /></>

  const { days, log, week } = data.data
  const mv = movement(log)
  const live = month === today.slice(0, 7)
  const tday = days.find((d) => d.day === today)
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(today.slice(0, 7) + '-15T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - i); return d.toISOString().slice(0, 7) }).filter((m) => m >= '2026-10')

  return (
    <>
      <PageHead kicker="Client success" title="Retention & book growth" sub="Net Book Movement = saved premium + cross-sell premium − lost premium. Activity explains the result; it doesn’t replace it."
        right={<div className="filters">
          {!mineRole && (people.data?.length || 0) > 1 && <select value={name} onChange={(e) => setPicked(e.target.value)} aria-label="Person">{people.data!.map((p) => <option key={p}>{p}</option>)}</select>}
          <PdfButton name={name} folio={openFolio || null} agency={agencyName(me)} />
          <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">{(months.length ? months : [month]).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
        </div>} />
      <section className="panel rt-hero">
        <div className="rt-hero-main">
          <div className="pay-k">Net Book Movement · {live ? `${monthLabel(month)} so far` : monthLabel(month)}</div>
          <div className={'pay-amt' + (mv.net < 0 ? ' neg' : '')}>{money0(mv.net)}</div>
          <div className="rt-eq">
            <span><b>{money0(mv.saved.p)}</b> saved ({mv.saved.n})</span><i>+</i>
            <span><b>{money0(mv.cross.p)}</b> cross-sell ({mv.cross.n})</span><i>−</i>
            <span className="bad"><b>{money0(mv.lost.p)}</b> lost ({mv.lost.n})</span>
          </div>
        </div>
        <div className="rt-goals">
          <Goal label="At-risk touches today" now={tday?.at_risk_touches ?? 0} goal={TARGETS.touches} />
          <Goal label="Renewal conversations today" now={tday?.renewal_conversations ?? 0} goal={TARGETS.conversations} />
          <Goal label="Saves this week" now={week.length} goal={TARGETS.savesPerWeek} />
          <Goal label="Cancellations this month" now={mv.lost.n} goal={TARGETS.cancellationsMax} limit />
          <Goal label="Net PIF this month" now={mv.netPif} goal={TARGETS.netPif} />
        </div>
      </section>

      <div className="rt-grid">
        <div>
          <DayForm key={name + today} name={name} days={days} today={today} onSaved={bump} />
          <Panel title={`${monthLabel(month)} log`} sub={`${log.length} entr${log.length === 1 ? 'y' : 'ies'} · saves, losses, cross-sells and service notes`}
            right={<button className={adding ? 'btn-ghost' : 'btn-primary'} onClick={() => setAdding(!adding)}>{adding ? 'Close' : '+ Add to log'}</button>}>
            {adding && <LogForm name={name} today={today} onSaved={() => { bump(); setAdding(false) }} />}
            {log.length ? (
              <div className="rt-log">{log.map((e) => (
                <div key={e.id} className="rt-entry">
                  <span className={'pill ' + (e.kind === 'loss' ? 'pill-bad' : e.kind === 'review' ? 'pill-muted' : 'pill-good')}>{KIND_LABEL[e.kind]}</span>
                  <div className="rt-entry-b">
                    <div className="strong">{e.client}{e.carrier ? <span className="sub"> · {e.carrier}</span> : null}</div>
                    <div className="sub">{mdy(e.day)}{e.policies > 1 ? ` · ${e.policies} policies` : ''}{e.reason ? ` · ${e.reason}` : ''}{e.note ? ` · ${e.note}` : ''}</div>
                  </div>
                  <div className="rt-entry-r">
                    <div className="mono strong">{e.kind === 'review' ? '' : (e.kind === 'loss' ? '−' : '+') + money0(Number(e.premium))}</div>
                    <button className="linkbtn" onClick={async () => { if (!confirm(`Remove this ${KIND_LABEL[e.kind].toLowerCase()} for ${e.client}?`)) return; const { error } = await supabase.from('retention_log').delete().eq('id', e.id); if (error) alert(error.message); else bump() }}>remove</button>
                  </div>
                </div>
              ))}</div>
            ) : !adding && <Empty>Nothing logged for {monthLabel(month)} yet.</Empty>}
          </Panel>
        </div>
        <div>
          <TalkTrack days={days} log={log} today={today} mvNet={mv.net} />
          <Panel title="Bonus gates" sub={gFolio ? `Folio ${mdy(gFolio.start_date)} – ${mdy(gFolio.end_date)} · all four must be met` : 'Folio not set up yet'}>
            {g.slice(0, 3).map((x) => <div key={x.label} className={'gate' + (x.ok ? ' ok' : '')}><span>{x.ok ? '✓' : '•'}</span><div><div className="strong">{x.label}</div><div className="sub">{x.detail}</div></div></div>)}
            {/* gate 4 is the reconciliation mark itself */}
            <label className="check rt-gate4">
              <input type="checkbox" disabled={!gFolio} checked={!!rec?.reconciled} onChange={async (e) => {
                const { error } = await supabase.from('retention_months').upsert({ name, month: gFolio!.start_date, reconciled: e.target.checked, reconciled_note: e.target.checked ? `Reconciled ${mdy(today)} by ${me?.display_name || 'staff'}` : null, updated_at: new Date().toISOString() }, { onConflict: 'agency_id,name,month' })
                if (error) alert(error.message); else bump()
              }} />
              <div><div className="check-t">Premium reporting reconciled</div><div className="sub">{rec?.reconciled ? rec.reconciled_note : 'Tick once Farmers and brokered reporting is reconciled and outstanding items have owners.'}</div></div>
            </label>
          </Panel>
          <Panel title="How the day runs" sub="The daily rhythm from the plan">
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
          </Panel>
        </div>
      </div>
    </>
  )
}

/** One goal with its progress: the number against the goal, and a bar (a limit, like cancellations, warns as it fills). */
function Goal({ label, now, goal, limit }: { label: string; now: number; goal: number; limit?: boolean }) {
  const pct = Math.max(0, Math.min(100, (now / goal) * 100))
  const tone = limit ? (now > goal ? 'bad' : now > goal * 0.8 ? 'warn' : 'good') : now >= goal ? 'good' : ''
  return (
    <div className={'rt-goal ' + tone}>
      <div className="rt-goal-h"><span>{label}</span><b>{now > 0 && label.startsWith('Net') ? '+' : ''}{now}<span className="sub"> {limit ? 'of ≤' : '/ '}{goal}</span></b></div>
      <div className="pay-bar"><div className="pay-fill" style={{ width: pct + '%' }} /></div>
    </div>
  )
}

function DayForm({ name, days, today, onSaved }: { name: string; days: RetentionDay[]; today: string; onSaved: () => void }) {
  const [day, setDay] = useState(today)
  const saved = days.find((d) => d.day === day)
  const [draft, setDraft] = useState<RetentionDay>(() => saved || blankDay(name, day))
  const [busy, setBusy] = useState(false)
  const pick = (d: string) => { setDay(d); setDraft(days.find((x) => x.day === d) || blankDay(name, d)) }
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
    <Panel title={day === today ? 'Today’s scorecard' : `Scorecard for ${mdy(day)}`} sub={saved ? 'Saved · update it any time during the day' : 'Not logged yet · counts toward the 95% bonus gate'}
      right={<input type="date" className="fld" value={day} max={today} onChange={(e) => pick(e.target.value || today)} aria-label="Scorecard day" />}>
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
    </Panel>
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
        {(['save', 'loss', 'cross_sell', 'review'] as const).map((k) => <button key={k} className={d.kind === k ? 'btn-primary' : 'btn-ghost'} onClick={() => setD({ ...d, kind: k })}>{KIND_LABEL[k]}</button>)}
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

/** The huddle talk track from the plan, filled in from yesterday's scorecard and log and the month so far. */
function TalkTrack({ days, log, today, mvNet }: { days: RetentionDay[]; log: RetentionEntry[]; today: string; mvNet: number }) {
  const y = prevWorkday(today)
  const yd = days.find((d) => d.day === y), td = days.find((d) => d.day === today)
  const ylog = useMemo(() => movement(log.filter((e) => e.day === y)), [log, y])
  const text = `Yesterday I completed ${yd?.at_risk_touches ?? 0} at-risk touches and ${yd?.renewal_conversations ?? 0} live renewal conversations. ` +
    `I saved ${ylog.saved.n} policies / ${money0(ylog.saved.p)} premium, lost ${ylog.lost.n} policies / ${money0(ylog.lost.p)} premium, and generated ${money0(ylog.cross.p)} in cross-sell premium. ` +
    `My MTD Net Book Movement is ${money0(mvNet)}. I have ${td?.open_critical_aged ?? yd?.open_critical_aged ?? 0} critical cases open past a day. ` +
    `Today’s priority is ${td?.priority || yd?.priority || '—'}.`
  return (
    <Panel title="Huddle talk track" sub={`10:00 huddle · from ${mdy(y)}’s scorecard and the month so far`}
      right={<button className="btn-ghost" onClick={() => navigator.clipboard?.writeText(text).then(() => alert('Copied.'), () => {})}>Copy</button>}>
      <p className="talk-track">“{text}”</p>
    </Panel>
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
        <Tile label="Net Book Movement · MTD" value={money0(mv.net)} sub={`${money0(mv.saved.p)} saved + ${money0(mv.cross.p)} cross-sell − ${money0(mv.lost.p)} lost`} tone={mv.net >= 0 ? 'good' : 'warn'} />
        <Tile label="At-risk touches today" value={`${td?.at_risk_touches ?? 0} / ${TARGETS.touches}`} sub={td ? 'from today’s scorecard' : 'today’s scorecard not logged yet'} tone={(td?.at_risk_touches ?? 0) >= TARGETS.touches ? 'good' : undefined} />
        <Tile label="Renewal conversations today" value={`${td?.renewal_conversations ?? 0} / ${TARGETS.conversations}`} sub="live conversations with next actions" tone={(td?.renewal_conversations ?? 0) >= TARGETS.conversations ? 'good' : undefined} />
        <Tile label="Saves this week" value={`${saves} / ${TARGETS.savesPerWeek}`} sub="documented saves since Monday" tone={saves >= TARGETS.savesPerWeek ? 'good' : undefined} />
        <Tile label="Critical cases aged >1 day" value={td?.open_critical_aged ?? 0} sub="goal 0 · owner and deadline on every case" tone={(td?.open_critical_aged ?? 0) > 0 ? 'warn' : 'good'} />
      </Tiles>
      <div className="sub" style={{ margin: '-6px 0 16px' }}><Link to="/retention">Open the retention scorecard →</Link></div>
    </>
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
