import { Link } from 'react-router-dom'
import { useAuth } from '../../auth'
import { useFolio } from '../../components/FolioPicker'
import { agencyName } from '../../lib/data'
import { PdfButton } from '../Retention'
import { supabase } from '../../lib/supabase'
import { useAsync } from '../../lib/useAsync'
import { useSyncStamp } from '../../lib/syncEvents'
import { TARGETS, movement, type RetentionDay, type RetentionEntry } from '../../lib/retention'
import { money0 } from '../../lib/perf/executive'
import { todayPacific } from '../../lib/format'
import { ICO, ScoreCard } from './parts'

/** The retention & book growth report on the Executive Dashboard: what the Director of Client Success has done this
 *  month — Net Book Movement (saved + cross-sell − lost premium), today's huddle numbers and every logged save, loss,
 *  cross-sell and service / review. Shown to everyone who has the dashboard (owner and admins). */

const KIND: Record<RetentionEntry['kind'], string> = { save: 'Save', loss: 'Loss', cross_sell: 'Cross-sell', review: 'Service / review' }
const us = (iso: string) => iso.slice(5, 7) + '/' + iso.slice(8, 10) + '/' + iso.slice(0, 4)

export default function RetentionReport() {
  const { me } = useAuth()
  const { folios } = useFolio()
  const synced = useSyncStamp()
  const day = todayPacific(), month = day.slice(0, 7)
  const { data } = useAsync(async () => {
    const who = await supabase.from('staff_accounts').select('producer_name').eq('access->>retention', 'true')
    const names = ((who.data || []) as { producer_name: string | null }[]).map((r) => r.producer_name).filter(Boolean) as string[]
    if (!names.length) return null
    const [days, log] = await Promise.all([
      supabase.from('retention_days').select('*').in('name', names).gte('day', month + '-01').lte('day', day).then((r) => (r.error ? [] : r.data as RetentionDay[])),
      supabase.from('retention_log').select('*').in('name', names).gte('day', month + '-01').lte('day', day).order('day', { ascending: false }).order('id', { ascending: false }).then((r) => (r.error ? [] : r.data as RetentionEntry[])),
    ])
    return { names, days, log }
  }, [month, day, synced])
  if (!data) return null

  const mv = movement(data.log)
  const td = data.days.filter((d) => d.day === day)
  const sum = (k: keyof RetentionDay) => td.reduce((a, d) => a + Number(d[k] || 0), 0)
  const esc = data.days.reduce((a, d) => a + d.escalations, 0), same = data.days.reduce((a, d) => a + Math.min(d.escalations_same_day, d.escalations), 0)
  const who = data.names.join(', ')
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-h">
        <div><div className="panel-t">Retention &amp; book growth</div>
          <div className="panel-s">{who} &middot; month to date &middot; Net Book Movement = saved + cross-sell &minus; lost premium</div></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <PdfButton className="yoy-csv" name={data.names[0]} folio={folios.find((f) => f.in_progress) || folios.find((f) => f.start_date <= day && f.end_date >= day) || null} agency={agencyName(me)} />
          <Link className="yoy-csv" to="/retention">Open the full report</Link>
        </div>
      </div>
      <div className="panel-b">
        <div className="scg" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          <ScoreCard icon={ICO.trend} iconClass={mv.net >= 0 ? 'i-green' : 'i-red'} label="Net Book Movement · MTD" value={mv.net} display={money0(mv.net)}
            goalLine={`${money0(mv.saved.p)} saved + ${money0(mv.cross.p)} cross-sell`} pct={null} tone={mv.net >= 0 ? 'good' : 'bad'}
            delta={{ tone: 'flat', arrow: '', value: '−' + money0(mv.lost.p) }} goalNote="lost" />
          <ScoreCard icon={ICO.shield} iconClass="i-green" label="Saves & cross-sell" value={mv.saved.n + mv.cross.n} display={`${mv.saved.n} / ${mv.cross.n}`}
            goalLine={`${mv.saved.n} saved · ${mv.cross.n} cross-sold`} pct={null} tone="good"
            delta={{ tone: 'flat', arrow: '', value: String(data.log.filter((e) => e.kind === 'review').length) }} goalNote="service / reviews" />
          <ScoreCard icon={ICO.warn} iconClass={mv.lost.n > TARGETS.cancellationsMax ? 'i-red' : 'i-amber'} label="Losses · MTD" value={mv.lost.n} display={String(mv.lost.n)}
            goalLine={`Limit ${TARGETS.cancellationsMax} a month`} pct={Math.min(100, (mv.lost.n / TARGETS.cancellationsMax) * 100)} tone={mv.lost.n > TARGETS.cancellationsMax ? 'bad' : 'good'}
            delta={{ tone: 'flat', arrow: '', value: money0(mv.lost.p) }} goalNote="premium lost" />
          <ScoreCard icon={ICO.check} iconClass="i-blue" label="Today's huddle numbers" value={sum('at_risk_touches')} display={`${sum('at_risk_touches')} / ${TARGETS.touches}`}
            goalLine={`at-risk touches · ${sum('renewal_conversations')} of ${TARGETS.conversations} renewal conversations`} pct={Math.min(100, (sum('at_risk_touches') / TARGETS.touches) * 100)} tone={sum('at_risk_touches') >= TARGETS.touches ? 'good' : 'warn'}
            delta={{ tone: 'flat', arrow: '', value: esc ? `${same}/${esc}` : '0' }} goalNote="escalations same day (MTD)" />
        </div>
        <div className="ch-tbl">
          {data.log.length ? (
            <table>
              <thead><tr><th>Day</th><th>Type</th><th>Client</th><th style={{ textAlign: 'right' }}>Premium</th><th>Notes</th></tr></thead>
              <tbody>{data.log.slice(0, 12).map((e) => (
                <tr key={e.id}><td>{us(e.day)}</td><td>{KIND[e.kind]}</td><td>{e.client}</td>
                  <td style={{ textAlign: 'right' }}>{e.kind === 'review' ? '—' : (e.kind === 'loss' ? '−' : '') + money0(Number(e.premium))}</td>
                  <td>{[e.reason, e.note].filter(Boolean).join(' · ')}</td></tr>
              ))}</tbody>
            </table>
          ) : <div className="empty">Nothing logged this month yet.</div>}
          {data.log.length > 12 && <div className="panel-s" style={{ marginTop: 6 }}>Showing the latest 12 of {data.log.length}. <Link to="/retention">See them all</Link></div>}
        </div>
      </div>
    </div>
  )
}
