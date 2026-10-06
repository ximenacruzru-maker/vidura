import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { Empty, ErrorBox, Loading, PageHead, Panel, Tile, Tiles } from '../components/ui'
import { mdy, money0, todayPacific } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'
import { LOSS_REASONS, TARGETS, gates, monthEnd, monthLabel, movement, type RetentionDay, type RetentionEntry, type RetentionMonth } from '../lib/retention'

/** Retention & book growth: the Director of Client Success's daily huddle scorecard. Log the day's numbers, every
 *  documented save, loss and cross-sell, and see Net Book Movement (saved + cross-sell − lost premium), the huddle
 *  talk track filled in, and how the month's bonus gates stand. The person in the role sees their own; admins see it
 *  too (and can pick whose, if more than one person has the role). */

const KIND_LABEL: Record<RetentionEntry['kind'], string> = { save: 'Save', loss: 'Loss', cross_sell: 'Cross-sell' }
const blankDay = (name: string, day: string): RetentionDay => ({ name, day, at_risk_touches: 0, renewal_conversations: 0, escalations: 0, escalations_same_day: 0, open_critical_aged: 0, brokered_current: true, priority: '' })
const weekStart = (day: string) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10) }
const prevWorkday = (day: string) => { const d = new Date(day + 'T12:00:00Z'); do { d.setUTCDate(d.getUTCDate() - 1) } while (d.getUTCDay() === 0 || d.getUTCDay() === 6); return d.toISOString().slice(0, 10) }

export default function Retention() {
  const { me } = useAuth()
  const today = todayPacific()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [reload, setReload] = useState(0)
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
    const [days, log, rec, week] = await Promise.all([
      supabase.from('retention_days').select('*').eq('name', name).gte('day', from < yday ? from : yday).lte('day', to).order('day').then((r) => { if (r.error) throw r.error; return r.data as RetentionDay[] }),
      supabase.from('retention_log').select('*').eq('name', name).gte('day', from).lte('day', to).order('day', { ascending: false }).order('id', { ascending: false }).then((r) => { if (r.error) throw r.error; return r.data as RetentionEntry[] }),
      supabase.from('retention_months').select('*').eq('name', name).eq('month', month).maybeSingle().then((r) => { if (r.error) throw r.error; return r.data as RetentionMonth | null }),
      supabase.from('retention_log').select('*').eq('name', name).eq('kind', 'save').gte('day', weekStart(today)).lte('day', today).then((r) => { if (r.error) throw r.error; return r.data as RetentionEntry[] }),
    ])
    return { days, log, rec, week }
  }, [name, from, to, reload])

  const head = <PageHead kicker="Client success" title="Retention & book growth" sub="Net Book Movement = saved premium + cross-sell premium − lost premium. Activity explains the result; it doesn’t replace it." />
  if (people.error || data.error) return <>{head}<ErrorBox error={people.error || data.error} /></>
  if (!name && people.data) return <>{head}<Empty>No one has the retention role yet. Switch on “Retention scorecard” for them under Settings → Team & access.</Empty></>
  if (!data.data) return <>{head}<Loading what="Loading the scorecard" /></>

  const { days, log, rec, week } = data.data
  const monthDays = days.filter((d) => d.day >= from)
  const mv = movement(log)
  const g = gates(month, monthDays, rec, today)
  const live = month === today.slice(0, 7)
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(today.slice(0, 7) + '-15T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - i); return d.toISOString().slice(0, 7) }).filter((m) => m >= '2026-10')

  return (
    <>
      <PageHead kicker="Client success" title="Retention & book growth" sub="Net Book Movement = saved premium + cross-sell premium − lost premium. Activity explains the result; it doesn’t replace it."
        right={<div className="filters">
          {!mineRole && (people.data?.length || 0) > 1 && <select value={name} onChange={(e) => setPicked(e.target.value)} aria-label="Person">{people.data!.map((p) => <option key={p}>{p}</option>)}</select>}
          <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">{(months.length ? months : [month]).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
        </div>} />
      <Tiles>
        <Tile label={`Net Book Movement · ${live ? 'MTD' : monthLabel(month)}`} value={money0(mv.net)} sub={`${money0(mv.saved.p)} saved + ${money0(mv.cross.p)} cross-sell − ${money0(mv.lost.p)} lost`} tone={mv.net >= 0 ? 'good' : 'warn'} />
        <Tile label="Saved" value={money0(mv.saved.p)} sub={`${mv.saved.n} polic${mv.saved.n === 1 ? 'y' : 'ies'} protected`} tone="good" />
        <Tile label="Lost" value={money0(mv.lost.p)} sub={`${mv.lost.n} of ≤${TARGETS.cancellationsMax} cancellations this month`} tone={mv.lost.n > TARGETS.cancellationsMax ? 'warn' : undefined} />
        <Tile label="Cross-sell" value={money0(mv.cross.p)} sub={`${mv.cross.n} polic${mv.cross.n === 1 ? 'y' : 'ies'} added`} />
        <Tile label="Saves this week" value={`${week.length} / ${TARGETS.savesPerWeek}`} sub={`${money0(week.reduce((a, e) => a + Number(e.premium), 0))} protected since ${mdy(weekStart(today))}`} tone={week.length >= TARGETS.savesPerWeek ? 'good' : undefined} />
        <Tile label="Net PIF (logged)" value={(mv.netPif > 0 ? '+' : '') + mv.netPif} sub={`cross-sell − lost policies · target +${TARGETS.netPif}`} tone={mv.netPif >= TARGETS.netPif ? 'good' : undefined} />
      </Tiles>

      <div className="grid2">
        <DayForm key={name + today} name={name} days={days} today={today} onSaved={bump} />
        <LogForm name={name} today={today} onSaved={bump} />
      </div>

      <TalkTrack days={days} log={log} today={today} mvNet={mv.net} />

      <Panel title={`${monthLabel(month)} log`} sub={`${log.length} entr${log.length === 1 ? 'y' : 'ies'} · every save, loss and cross-sell with its annual premium`}>
        {log.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Day</th><th>Type</th><th>Client</th><th className="r">Policies</th><th className="r">Premium</th><th>Carrier</th><th>Reason / note</th><th /></tr></thead>
              <tbody>{log.map((e) => (
                <tr key={e.id}><td>{mdy(e.day)}</td><td><span className={'pill ' + (e.kind === 'loss' ? 'pill-bad' : 'pill-good')}>{KIND_LABEL[e.kind]}</span></td><td>{e.client}</td>
                  <td className="r">{e.policies}</td><td className="r mono">{e.kind === 'loss' ? '−' : ''}{money0(Number(e.premium))}</td><td>{e.carrier}</td><td className="sub">{[e.reason, e.note].filter(Boolean).join(' · ')}</td>
                  <td className="r"><button className="linkbtn" onClick={async () => { if (!confirm(`Remove this ${KIND_LABEL[e.kind].toLowerCase()} for ${e.client}?`)) return; const { error } = await supabase.from('retention_log').delete().eq('id', e.id); if (error) alert(error.message); else bump() }}>remove</button></td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty>Nothing logged for {monthLabel(month)} yet.</Empty>}
      </Panel>

      <Panel title="Bonus gates" sub={`${monthLabel(month)} · the monthly bonus pays only when all four are met`}>
        {g.map((x) => <div key={x.label} className={'gate' + (x.ok ? ' ok' : '')}><span>{x.ok ? '✓' : '•'}</span><div><div className="strong">{x.label}</div><div className="sub">{x.detail}</div></div></div>)}
        <label className="check" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={!!rec?.reconciled} onChange={async (e) => {
            const { error } = await supabase.from('retention_months').upsert({ name, month, reconciled: e.target.checked, reconciled_note: e.target.checked ? `Reconciled ${mdy(today)} by ${me?.display_name || 'staff'}` : null, updated_at: new Date().toISOString() }, { onConflict: 'agency_id,name,month' })
            if (error) alert(error.message); else bump()
          }} />
          <div><div className="check-t">Farmers and brokered premium reporting is reconciled for {monthLabel(month)}</div><div className="sub">Known outstanding payments and carrier items have owners and next actions.</div></div>
        </label>
      </Panel>

      <Panel title="How the day runs">
        <table className="tbl"><tbody>
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
        <div className="sub" style={{ marginTop: 8 }}>Escalate immediately: rate increase or price complaint, cancellation or nonrenewal language, nonpayment or reinstatement risk, coverage reduction because of price, dissatisfaction or complaint, underwriting or missing information, brokered renewal/payment/carrier concern, or a request for a manager. A transfer doesn’t end ownership.</div>
      </Panel>
    </>
  )
}

function DayForm({ name, days, today, onSaved }: { name: string; days: RetentionDay[]; today: string; onSaved: () => void }) {
  const [day, setDay] = useState(today)
  const saved = days.find((d) => d.day === day)
  const [draft, setDraft] = useState<RetentionDay>(() => saved || blankDay(name, day))
  const [busy, setBusy] = useState(false)
  const pick = (d: string) => { setDay(d); setDraft(days.find((x) => x.day === d) || blankDay(name, d)) }
  const num = (k: keyof RetentionDay, label: string, goal?: string) => (
    <label>{label}{goal && <span className="sub" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}> · {goal}</span>}
      <input className="fld" type="number" min={0} value={Number(draft[k]) || 0} onChange={(e) => setDraft({ ...draft, [k]: Math.max(0, Number(e.target.value) || 0) })} />
    </label>
  )
  const save = async () => {
    setBusy(true)
    const { error } = await supabase.from('retention_days').upsert({ ...draft, name, day, updated_at: new Date().toISOString() }, { onConflict: 'agency_id,name,day' })
    setBusy(false)
    if (error) alert(error.message); else onSaved()
  }
  return (
    <Panel title="Daily scorecard" sub={saved ? `Saved for ${mdy(day)} · update it any time` : `Not logged for ${mdy(day)} yet`}
      right={<input type="date" className="fld" value={day} max={today} onChange={(e) => pick(e.target.value || today)} aria-label="Scorecard day" />}>
      <div className="form-grid">
        {num('at_risk_touches', 'At-risk touches', `goal ${TARGETS.touches}`)}
        {num('renewal_conversations', 'Live renewal conversations', `goal ${TARGETS.conversations}`)}
        {num('escalations', 'Critical escalations')}
        {num('escalations_same_day', 'Contacted same day', 'goal 100%')}
        {num('open_critical_aged', 'Critical cases aged >1 day', 'goal 0')}
        <label className="coi-tick"><input type="checkbox" checked={draft.brokered_current} onChange={(e) => setDraft({ ...draft, brokered_current: e.target.checked })} /> Brokered business current</label>
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
    const { error } = await supabase.from('retention_log').insert({ name, kind: d.kind, day: d.day, client: d.client.trim(), policies: Number(d.policies) || 1, premium: Number(d.premium) || 0, carrier: d.carrier || null, reason: d.reason || null, note: d.note || null })
    setBusy(false)
    if (error) alert(error.message); else { setD({ ...blank, kind: d.kind }); onSaved() }
  }
  return (
    <Panel title="Log a save, loss or cross-sell" sub="Annual premium protected, lost or added. Every loss gets a reason.">
      <div className="row-actions" role="group" aria-label="Type" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        {(['save', 'loss', 'cross_sell'] as const).map((k) => <button key={k} className={d.kind === k ? 'btn-primary' : 'btn-ghost'} onClick={() => setD({ ...d, kind: k })}>{KIND_LABEL[k]}</button>)}
      </div>
      <div className="form-grid">
        <label style={{ gridColumn: '1 / -1' }}>Client<input className="fld" value={d.client} onChange={(e) => setD({ ...d, client: e.target.value })} /></label>
        <label>Day<input className="fld" type="date" max={today} value={d.day} onChange={(e) => setD({ ...d, day: e.target.value || today })} /></label>
        <label>Policies<input className="fld" type="number" min={1} value={d.policies} onChange={(e) => setD({ ...d, policies: Math.max(1, Number(e.target.value) || 1) })} /></label>
        <label>Annual premium<input className="fld" type="number" min={0} step="1" value={d.premium} onChange={(e) => setD({ ...d, premium: e.target.value })} /></label>
        <label>Carrier<input className="fld" value={d.carrier} onChange={(e) => setD({ ...d, carrier: e.target.value })} /></label>
        {d.kind === 'loss' && <label>Reason<select className="fld" value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })}><option value="">Pick one</option>{LOSS_REASONS.map((r) => <option key={r}>{r}</option>)}</select></label>}
        <label style={{ gridColumn: '1 / -1' }}>Note<input className="fld" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} /></label>
      </div>
      <div className="row-actions" style={{ marginTop: 12 }}><button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : `Log ${KIND_LABEL[d.kind].toLowerCase()}`}</button></div>
    </Panel>
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
