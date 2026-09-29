import { useMemo, useState } from 'react'
import { todayPacific } from '../../lib/format'
import { money0 } from '../../lib/perf/executive'
import { change, loadYoy, yoyFigures, type Sum } from '../../lib/perf/yoy'
import { useSyncStamp } from '../../lib/syncEvents'
import { useAsync } from '../../lib/useAsync'
import { ICO, ScoreCard } from './parts'
import './yoy.css'

/* Remembered while the session lasts, as the dashboard's other filters are. */
let saved = { producer: 'all', measure: 'premium' as 'premium' | 'policies', dropCancelled: false }

/** This year against the same dates last year: month, quarter and year to date, last month, the last 12 months,
 *  and month by month — from AgencyZoom's policies by the day each was sold. */
export default function VsLastYear() {
  const today = todayPacific()
  const synced = useSyncStamp()
  const { data, error } = useAsync(() => loadYoy(today), [today, synced])
  const [o, setO] = useState(saved)
  const set = (patch: Partial<typeof o>) => setO((x) => (saved = { ...x, ...patch }))
  const F = useMemo(() => (data ? yoyFigures(data, today, o) : null), [data, today, o])
  const v = (s: Sum) => (o.measure === 'premium' ? s.premium : s.policies)
  const show = (n: number) => (o.measure === 'premium' ? money0(n) : n.toLocaleString('en-US'))

  const head = (
    <div className="panel-h">
      <div><div className="panel-t">This year vs last year</div>
        <div className="panel-s">AgencyZoom policies by the day they were sold &middot; every figure against the same dates a year earlier</div></div>
      {data?.loaded && <div className="fbar" style={{ margin: 0 }}>
        <div className="fb-g"><label className="fl">Producer</label>
          <select className="f" value={o.producer} onChange={(e) => set({ producer: e.target.value })}>
            <option value="all">All producers</option>{data.producers.map((p) => <option key={p}>{p}</option>)}
          </select></div>
        <div className="segt" role="group" aria-label="Measure">
          <button className={'segt-b' + (o.measure === 'premium' ? ' on' : '')} onClick={() => set({ measure: 'premium' })}>Premium $</button>
          <button className={'segt-b' + (o.measure === 'policies' ? ' on' : '')} onClick={() => set({ measure: 'policies' })}>Policies</button>
        </div>
        <label className="yoy-chk"><input type="checkbox" checked={o.dropCancelled} onChange={(e) => set({ dropCancelled: e.target.checked })} />Leave out policies since cancelled</label>
      </div>}
    </div>
  )
  if (error) return <div className="panel" style={{ marginBottom: 16 }}>{head}<div className="panel-b"><div className="empty">Last year's figures couldn't be loaded: {String((error as Error)?.message || error)}</div></div></div>
  if (!data || !F) return <div className="panel" style={{ marginBottom: 16 }}>{head}<div className="panel-b"><div className="empty">Loading last year's figures…</div></div></div>
  if (!data.loaded) return (
    <div className="panel" style={{ marginBottom: 16 }}>{head}
      <div className="panel-b"><div className="empty">No AgencyZoom policy history yet. It fills in from AgencyZoom (every customer's policies, with the day each was sold); once it has, this section compares this year with last.</div></div>
    </div>
  )

  // AgencyZoom's history starts on its earliest sale; a period reaching back before it has no full last-year figure
  const first = data.first
  const gap = (from: string) => !!first && from < first
  const top = Math.max(1, ...F.months.flatMap((m) => [m.now ? v(m.now) : 0, v(m.prior)]))
  const cur = F.months.find((m) => m.partial)
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      {head}
      <div className="panel-b">
        <div className="scg yoy-cards">
          {F.compares.map((c) => {
            const n = v(c.now), p = v(c.prior), up = n >= p, partial = gap(c.priorFrom)
            return (
              <div key={c.key} className="yoy-card"><ScoreCard icon={c.key === 'lm' ? ICO.cal : c.key === 't12' ? ICO.trend : ICO.bars} iconClass={up ? 'i-green' : 'i-red'} label={c.label}
                value={n} display={show(n)} goalLine={'Last year ' + show(p)} pct={p ? Math.min(100, (n / p) * 100) : n ? 100 : 0} tone={up ? 'good' : 'bad'}
                delta={partial ? { tone: 'flat', arrow: '', value: 'partial' } : { tone: up ? 'up' : 'down', arrow: p ? (up ? '▲' : '▼') : '', value: change(n, p) }}
                goalNote={partial ? 'last year incomplete' : 'vs last year'} />
                <div className="yoy-range">{c.range}</div></div>
            )
          })}
        </div>

        {first && gap(`${F.year - 1}-01-01`) && <div className="rb-band-note yoy-note">AgencyZoom's policy history starts {new Date(first + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}, so last year before then has no sales to compare with. Those months and any period reaching back before it are marked.</div>}
        <div className="panel yoy-months">
          <div className="panel-h"><div><div className="panel-t">Month by month</div>
            <div className="panel-s">{F.year} against {F.year - 1}{cur ? ` · ${cur.label} is to date` : ''}{o.producer !== 'all' ? ' · ' + o.producer : ''}</div></div>
            <div className="lgnd"><span className="lgnd-i"><i className="yoy-k-now" />{F.year}</span><span className="lgnd-i"><i className="yoy-k-prior" />{F.year - 1}</span></div>
          </div>
          <div className="panel-b">
            <div className="yoy-chart" role="img" aria-label={`${o.measure === 'premium' ? 'Premium' : 'Policies'} by month, ${F.year} against ${F.year - 1}`}>
              {F.months.map((m) => (
                <div key={m.month} className="yoy-col" title={`${m.label}: ${F.year} ${m.now ? show(v(m.now)) : '—'} · ${F.year - 1} ${show(v(m.prior))}`}>
                  <div className="yoy-bars">
                    <i className="yoy-b yoy-b-prior" style={{ height: (v(m.prior) / top) * 100 + '%' }} />
                    <i className={'yoy-b yoy-b-now' + (m.partial ? ' yoy-part' : '')} style={{ height: m.now ? (v(m.now) / top) * 100 + '%' : 0 }} />
                  </div>
                  <div className="yoy-lbl">{m.label}</div>
                </div>
              ))}
            </div>
            <table className="yoy-tbl">
              <thead><tr><th>Month</th><th className="tr">{F.year}</th><th className="tr">{F.year - 1}</th><th className="tr">Change</th></tr></thead>
              <tbody>
                {F.months.map((m) => {
                  const n = m.now ? v(m.now) : null, p = v(m.prior), p2 = m.priorToDate ? v(m.priorToDate) : null
                  const missing = gap(`${F.year - 1}-${String(m.month).padStart(2, '0')}-01`)
                  return (
                    <tr key={m.month} className={m.now ? '' : 'yoy-future'}>
                      <td>{m.label}{m.partial ? ' (to date)' : ''}</td>
                      <td className="tr mono">{n == null ? '—' : show(n)}</td>
                      <td className="tr mono">{show(p)}{p2 != null && <div className="yoy-sub">{show(p2)} to the same day</div>}{missing && <div className="yoy-sub">before AgencyZoom's history</div>}</td>
                      <td className={'tr mono ' + (n == null || missing ? '' : (p2 ?? p) && n < (p2 ?? p) ? 'yoy-down' : 'yoy-up')}>{n == null ? '' : missing ? '—' : change(n, p2 ?? p)}</td>
                    </tr>
                  )
                })}
              </tbody>
              {(() => {
                const ytd = F.compares.find((c) => c.key === 'ytd')!, n = v(ytd.now), p = v(ytd.prior)
                return <tfoot><tr><td>Year to date</td>
                  <td className="tr mono">{show(n)}</td>
                  <td className="tr mono">{show(p)}<div className="yoy-sub">{show(F.months.reduce((a, m) => a + v(m.prior), 0))} full year</div></td>
                  <td className={'tr mono ' + (gap(ytd.priorFrom) ? '' : p && n < p ? 'yoy-down' : 'yoy-up')}>{gap(ytd.priorFrom) ? 'partial' : change(n, p)}</td></tr></tfoot>
              })()}
            </table>
            <div className="mix-note">Counted from every policy on every AgencyZoom customer, by its sold date and current premium{o.dropCancelled ? ', leaving out policies cancelled since' : ', including policies cancelled since (written business)'}. The current month is compared with last year to the same day.</div>
          </div>
        </div>
      </div>
    </div>
  )
}
