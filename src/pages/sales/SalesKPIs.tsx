import { useEffect, useMemo, useRef, useState } from 'react'
import { ErrorBox, Loading } from '../../components/ui'
import { loadPerfData, wbFolioKeys, type PerfData } from '../../lib/perf/data'
import { money0, today } from '../../lib/perf/executive'
import { computeSales, cusRange } from '../../lib/perf/sales'
import { useAsync } from '../../lib/useAsync'
import { Bars, ICO, RenewalChart, ScoreCard } from '../executive/parts'
import { useDarkFix, useFitFigures, useLegacyLook } from '../executive/look'
import '../executive/executive.css'
import './sales.css'

/** The period and chart survive leaving and coming back within a session, as they did in the original screens. */
let saved: { period: string; chart: string; from: string; to: string } | null = null

export default function SalesKPIs() {
  const { data, error } = useAsync(loadPerfData, [])
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading what="Loading sales" />
  return <Sales D={data} />
}

/** Sales KPIs: every policy written in the period from the AgencyZoom sales ledger, by producer, line and book. */
export function Sales({ D }: { D: PerfData }) {
  const root = useRef<HTMLDivElement>(null)
  const S = D.S || {}
  const [f, setF] = useState(saved || { period: S.salesPeriod || 'folio', chart: S.salesChart || 'prem', from: S.cusFrom || '', to: S.cusTo || '' })
  useEffect(() => { saved = f }, [f])
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))
  const x = useMemo(() => computeSales(D, f.period, { from: f.from, to: f.to }), [D, f.period, f.from, f.to])
  const look = useLegacyLook(D)
  useFitFigures(root)
  useDarkFix(root, look.dark)
  const [cFrom, cTo] = cusRange(f.from, f.to)
  const nowLabel = today().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const periods: [string, string][] = [
    ...Object.entries(D.SALES_PERIODS || {}).map(([k, v]) => [k, v.label] as [string, string]),
    ...wbFolioKeys(D).map((k) => [k, 'Folio ' + D.WB_DATA.folio[k].label.replace(' (in progress)', '')] as [string, string]),
  ]
  const chart = f.chart === 'count' ? 'count' : 'prem'

  return (
    <div ref={root} className="xd" style={look.style} data-mode={look.dark ? 'dark' : 'light'}>
      <div className="pagehead">
        <div className="hd-titles">
          <p className="eyebrow">Performance</p>
          <p className="ptitle">Sales KPIs</p>
          <p className="psrc">{x.written.length} policies written · {money0(x.total)} · {x.range.label}</p>
        </div>
        {/* Temporary, while the rebuilt screen is checked: the original stays one click away to compare figures. */}
        <a className="psrc" href="#/legacy-sales" style={{ alignSelf: 'center', fontWeight: 700 }}>Compare with the original Sales KPIs ›</a>
      </div>
      <div className="wrap">
        <div className="svtabs">
          <button className="svtab on">Sales KPIs</button>
          <a className="svtab" href="#/huddle">Daily Huddle Report</a>
        </div>
        <div className="exhd">
          <div><div className="exhd-s">{x.written.length} policies written &middot; {money0(x.total)} &middot; {x.range.label}</div></div>
          <div className="exhd-u">{ICO.cal}<span>Updated {nowLabel}</span></div>
        </div>
        <div className="fbar">
          <div className="fb-g"><label className="fl">Period</label>
            <select className="f" value={f.period} onChange={(e) => set('period', e.target.value)}>
              {periods.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              <option value="custom">Custom range</option>
            </select></div>
          {f.period === 'custom' && <>
            <div className="fb-g"><label className="fl">From</label><input type="date" className="f" value={cFrom} max={cTo} onChange={(e) => set('from', e.target.value)} /></div>
            <div className="fb-g"><label className="fl">To</label><input type="date" className="f" value={cTo} min={cFrom} onChange={(e) => set('to', e.target.value)} /></div>
          </>}
          <div className="fb-u">{ICO.doc}<span>AgencyZoom sales ledger by sold date — written business only, no leads or quotes</span></div>
        </div>

        <div className="scg scg-nd" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <ScoreCard icon={ICO.dollar} iconClass="i-blue" label="Written premium" value={x.total} display={money0(x.total)} goalLine={x.range.label} pct={null} goalNote={x.written.length + ' policies'} />
          <ScoreCard icon={ICO.bars} iconClass="i-amber" label="Policies written" value={x.written.length} display={String(x.written.length)} goalLine={x.clients + ' clients'} pct={null} goalNote="in this period" />
          <ScoreCard icon={ICO.trend} iconClass="i-green" label="Average premium" value={x.avg} display={money0(x.avg)} goalLine="per policy written" pct={null} goalNote="across all lines" />
          <ScoreCard icon={ICO.users} iconClass="i-amber" label="Policies per new client" value={x.ppc} display={x.ppc.toFixed(2)} goalLine={x.clients + ' clients written'} pct={null} goalNote="bundling on new business" />
        </div>

        <div className="panel">
          <div className="panel-h">
            <div><div className="panel-t">Written by {x.range.buckets === 'day' ? 'day' : 'month'}</div><div className="panel-s">Each policy counted on its AgencyZoom sold date</div></div>
            <div className="segt" role="group">
              <button className={'segt-b' + (chart !== 'count' ? ' on' : '')} onClick={() => set('chart', 'prem')}>Premium $</button>
              <button className={'segt-b' + (chart === 'count' ? ' on' : '')} onClick={() => set('chart', 'count')}>Policy Count</button>
            </div>
          </div>
          <div className="panel-b">
            <div className="lgnd lgnd-c">
              {(['Commercial', 'Farmers', 'Retail'] as const).map((bk) => <span key={bk} className="lgnd-i"><i style={{ background: D.CHART[bk] }} />{D.BOOK_NAME[bk]}</span>)}
              <span className="lgnd-i"><i className="lgnd-line" />Priced (%)</span>
            </div>
            {x.written.length ? <RenewalChart months={x.months} mode={chart} colors={D.CHART} bookName={D.BOOK_NAME} /> : <div className="empty">No policies were sold in this period.</div>}
          </div>
        </div>

        <div className="p2">
          <div className="panel">
            <div className="panel-h"><div><div className="panel-t">By producer</div><div className="panel-s">Who wrote it</div></div></div>
            <div className="panel-b">
              {x.hasProducer ? <Bars items={x.byProducer} emphasis /> : (
                <div className="ph"><div className="ph-card"><span className="ph-tag">Needs a producer field</span><h2>No producer on these policies</h2>
                  <p>The carrier lists in this file do not name who wrote each policy. Import an AgencyZoom export with a Producer column, or set it per policy, and this splits the whole board by person.</p></div></div>
              )}
            </div>
          </div>
          <div className="panel">
            <div className="panel-h"><div><div className="panel-t">By line</div><div className="panel-s">Written premium by product line</div></div></div>
            <div className="panel-b">{x.byLine.length ? <Bars items={x.byLine.slice(0, 10)} emphasis /> : <div className="empty">Nothing yet.</div>}</div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-h"><div><div className="panel-t">By book</div><div className="panel-s">Where the new business came from</div></div></div>
          <div className="panel-b">{x.byBook.length ? <Bars items={x.byBook} emphasis /> : <div className="empty">Nothing yet.</div>}</div>
        </div>

        <div className="panel">
          <div className="panel-h"><div><div className="panel-t">Policies sold</div><div className="panel-s">{x.written.length} in this period, newest first</div></div></div>
          <div className="panel-b" style={{ overflowX: 'auto', maxHeight: 480, overflowY: 'auto' }}>
            {x.written.length ? (
              <table className="dect">
                <thead><tr><th>Date</th><th>Customer</th><th>Producer</th><th>Line</th><th>Carrier</th><th className="tr">Premium</th></tr></thead>
                <tbody>{x.written.map((r, i) => (
                  <tr key={r.day + r.client + i}><td className="mono">{r.day}</td><td style={{ fontWeight: 600, color: 'var(--bistre)' }}>{r.client}</td>
                    <td>{r.producer}</td><td>{r.kind}</td><td>{r.carrier}</td><td className="tr mono">{money0(r.prem)}</td></tr>
                ))}</tbody>
              </table>
            ) : <div className="empty">Nothing sold in this period.</div>}
          </div>
        </div>

        {x.undated.length > 0 && (
          <div className="lic-alert">{ICO.warn}<div><b>{x.undated.length} policies have no effective date on file.</b> They cannot be counted into any month, so they sit outside every figure on this screen. An AgencyZoom export carries effective dates and fills them in.</div></div>
        )}
      </div>
    </div>
  )
}
