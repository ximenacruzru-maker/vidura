// Client success for a day: the retention scorecard (at-risk touches, renewal conversations, escalations), the
// retention log (saves, losses, cross-sells, new business, service notes) and the renewal reviews worked — a
// reinstatement or a negative/commercial renewal worked is an at-risk touch, and one reached is a renewal conversation,
// so a day of working the reinstatement list counts even before the scorecard is filled in (the scorecard wins when
// it's higher). Shown on the Daily Huddle Report (board look) and at the bottom of Retention (page look).
import { GoalCard } from './Report'
import { Ring } from './BoardCharts'
import { mdy, money0 } from '../lib/format'
import { movement, TARGETS, type RetentionDay, type RetentionEntry } from '../lib/retention'
import { supabase } from '../lib/supabase'

interface Review { name: string; kind: string; spoke: boolean; call1: string | null; call2: string | null; findings: string | null; notes: string | null }
export type ClientDay = Awaited<ReturnType<typeof loadClientSuccess>>
const RET_KIND: Record<RetentionEntry['kind'], string> = { save: 'Save', loss: 'Loss', cross_sell: 'Cross-sell', new_business: 'New business', review: 'Service' }

/** the day's scorecard, log and renewal reviews (everyone's, or one person's) */
export async function loadClientSuccess(day: string, name?: string) {
  const days = supabase.from('retention_days').select('*').eq('day', day), log = supabase.from('retention_log').select('*').eq('day', day).order('id')
  const rev = supabase.from('renewal_reviews').select('name, kind, spoke, call1, call2, findings, notes').eq('day', day)
  const [d, l, r] = await Promise.all([
    (name ? days.eq('name', name) : days).then((x) => (x.error ? [] : (x.data as RetentionDay[]))),
    (name ? log.eq('name', name) : log).then((x) => (x.error ? [] : (x.data as RetentionEntry[]))),
    (name ? rev.eq('name', name) : rev).then((x) => (x.error ? [] : (x.data as Review[]))),
  ])
  const worked = r.filter((x) => (x.findings || '').trim() || (x.notes || '').trim())
  const reached = worked.filter((x) => x.spoke || x.call1 === 'reached' || x.call2 === 'reached').length
  const atRisk = worked.filter((x) => x.kind === 'reinstatement' || x.kind === 'negative' || x.kind === 'commercial').length
  const sum = (k: keyof RetentionDay) => d.reduce((a, x) => a + Number(x[k] || 0), 0)
  const rein = r.filter((x) => x.kind === 'reinstatement'), reinWorked = rein.filter((x) => worked.includes(x)).length
  return {
    d, l, logged: d.length > 0,
    touches: Math.max(sum('at_risk_touches'), atRisk), convos: Math.max(sum('renewal_conversations'), reached),
    esc: sum('escalations'), escSame: sum('escalations_same_day'),
    reviews: r.length, worked: worked.length, reached, rein: rein.length, reinWorked,
    mv: movement(l), service: l.filter((e) => e.kind === 'review').length,
  }
}

export function ClientSuccessView({ c, day, look }: { c: ClientDay; day: string; look: 'board' | 'page' }) {
  if (!c.d.length && !c.l.length && !c.reviews) return look === 'board' ? <p className="ts-none">Nothing logged on {mdy(day)}.</p> : <div className="rp-empty">Nothing logged on {mdy(day)}.</div>
  const fromReviews = !c.logged && c.worked > 0
  const tiles = [
    { k: 'At-risk touches', v: `${c.touches} / ${TARGETS.touches}`, pct: c.touches / TARGETS.touches, good: c.touches >= TARGETS.touches, note: fromReviews ? 'from the renewal reviews worked' : undefined },
    { k: 'Renewal conversations', v: `${c.convos} / ${TARGETS.conversations}`, pct: c.convos / TARGETS.conversations, good: c.convos >= TARGETS.conversations, note: fromReviews ? 'clients reached' : undefined },
    ...(c.rein ? [{ k: 'Reinstatements worked', v: `${c.reinWorked} / ${c.rein}`, pct: c.reinWorked / c.rein, good: c.reinWorked >= c.rein, note: undefined as string | undefined }] : []),
    { k: 'Renewal reviews worked', v: `${c.worked} / ${c.reviews}`, pct: c.reviews ? c.worked / c.reviews : 0, good: c.reviews > 0 && c.worked >= c.reviews, note: `${c.reached} reached` },
    { k: 'Net book movement', v: money0(c.mv.net), pct: 0, good: c.mv.net >= 0, note: `${c.mv.saved.n} saved · ${c.mv.cross.n} cross-sell · ${c.mv.fresh.n} new · ${c.mv.lost.n} lost` },
    { k: 'Service calls', v: String(c.service), pct: 0, good: true, note: c.esc ? `${Math.min(c.escSame, c.esc)} of ${c.esc} escalations same day` : 'no escalations' },
  ]
  const log = c.l.length > 0 && (
    <div className="tbl-wrap"><table className={look === 'board' ? 'hd-tbl' : 'rp-tbl rp-log'}>
      <thead><tr><th>Who</th><th>Type</th><th>Client</th><th className="r">Premium</th><th>Notes</th></tr></thead>
      <tbody>{c.l.map((e) => (
        <tr key={e.id}><td className={look === 'board' ? 'muted' : 'rp-muted'}>{e.name.split(' ')[0]}</td><td><span className={(look === 'board' ? 'hd-pill' : 'rp-pill') + ' k-' + e.kind}>{RET_KIND[e.kind]}</span></td><td className="strong">{e.client}</td>
          <td className={'r mono strong ' + (e.kind === 'loss' ? 'down' : e.kind === 'review' ? (look === 'board' ? 'muted' : 'rp-muted') : 'up')}>{e.kind === 'review' ? '—' : (e.kind === 'loss' ? '−' : '+') + money0(Number(e.premium))}</td>
          <td className={look === 'board' ? 'hd-notes' : 'rp-notes'}>{[e.reason, e.note].filter(Boolean).join(' · ') || '—'}</td></tr>
      ))}</tbody>
    </table></div>
  )
  // the board: rings toward each goal, then the movement and service as two small tiles
  if (look === 'board') return (<>
    <div className="bc-rings">
      <Ring label="At-risk touches" value={c.touches} max={TARGETS.touches} />
      <Ring label="Conversations" value={c.convos} max={TARGETS.conversations} />
      {c.rein > 0 && <Ring label="Reinstatements" value={c.reinWorked} max={c.rein} show={`${c.reinWorked}/${c.rein}`} />}
      <Ring label="Reviews worked" value={c.worked} max={c.reviews} show={`${c.worked}/${c.reviews}`} />
    </div>
    <div className="hd-mini">{tiles.slice(-2).map((t) => <div key={t.k} className={t.good ? 'good' : 'warn'}><span>{t.k}</span><b>{t.v}</b>{t.note ? <em>{t.note}</em> : null}</div>)}</div>
    {log}
  </>)
  return (<>
    <div className="rp-cards">{tiles.map((t) => <GoalCard key={t.k} label={t.k} show={t.v} pct={t.pct} good={t.good} note={t.note} />)}</div>
    {log}
  </>)
}
