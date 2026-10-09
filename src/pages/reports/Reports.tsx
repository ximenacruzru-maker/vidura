import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ErrorBox, Loading } from '../../components/ui'
import { useAuth } from '../../auth'
import { loadPerfData, wbFolioKeys, type Json, type PerfData } from '../../lib/perf/data'
import { useSyncStamp } from '../../lib/syncEvents'
import { money0 } from '../../lib/perf/executive'
import { azSyncWhen, computeDaily, computeWritten, metricValue, reportFolioKey, wbFolioLabel } from '../../lib/perf/reports'
import { useAsync } from '../../lib/useAsync'
import { Gauge, ICO } from '../executive/parts'
import { useDarkFix, useFitFigures, useLegacyLook } from '../executive/look'
import { ReportsDash, type DashState } from './ReportsDash'
import { Commissions } from './Commissions'
import { Sdr } from './Sdr'
import { agencyShort } from '../../lib/data'
import '../executive/executive.css'
import './reports.css'

/** Tabs that still open the original screens (they are rebuilt separately). */
const ELSEWHERE: Record<string, string> = { annual: '/year-end' }

interface View extends DashState { mode: 'dash' | 'details'; tab: string; sdrMonth: string | null; folio: string | null; kind: string | null; who: string | null; day: string | null; carrier: string; biz: string; metric: string }
/** Choices survive leaving and coming back within a session, as they did in the original screen. */
let saved: View | null = null

/** open: a Details tab to show on arrival (the /commissions address opens the Commissions tab). */
export default function Reports({ open }: { open?: string }) {
  const synced = useSyncStamp() // reload when an AgencyZoom sync finishes
  const { data, error } = useAsync(loadPerfData, [synced])
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading what="Loading reports" />
  return <ReportsView D={data} open={open} />
}

export function ReportsView({ D, open }: { D: PerfData; open?: string }) {
  const root = useRef<HTMLDivElement>(null)
  const go = useNavigate()
  const { me } = useAuth()
  const agency = me?.agency?.name || 'Your agency'
  const S = D.S || {}
  const [v, setV] = useState<View>(saved || { mode: (S.view || {}).reports === 'details' ? 'details' : 'dash',
    sdrMonth: S.repSdrMonth || null, win: S.repWin || 'folio', book: S.repBook || 'all', line: S.repLine || 'all', goals: !!S.exGoals, from: S.cusFrom || '', to: S.cusTo || '', tab: S.repTab || 'scorecard', folio: S.repFolio || null, kind: S.repKind || null, who: S.repProducer || null,
    day: null, carrier: S.repCarrier || 'all', biz: S.repBizType || 'all', metric: S.repMetric || 'premium' })
  useEffect(() => { if (open) setV((x) => ({ ...x, mode: 'details', tab: open })) }, [open])
  useEffect(() => { saved = v }, [v])
  const set = (p: Partial<View>) => setV((x) => ({ ...x, ...p }))
  const setFolio = (folio: string) => set({ folio, carrier: 'all', kind: null, who: null })
  const drill = (kind: string | null, who: string | null) => setV((x) => (x.kind === kind && x.who === who ? { ...x, kind: null, who: null } : { ...x, kind, who }))

  const look = useLegacyLook(D)
  useFitFigures(root)
  useDarkFix(root, look.dark)

  const tabs = D.REPORT_TABS || []
  const tab = tabs.some((t) => t.key === v.tab) ? v.tab : tabs[0]?.key || 'scorecard'
  const fk = reportFolioKey(D, v.folio)
  const R: Json = D.AZ_REPORTS[fk] || {}
  const has = !!R.generatedAt
  const flt = R.filters || {}
  const openTab = (k: string) => (ELSEWHERE[k] ? go(ELSEWHERE[k]) : set({ tab: k, mode: 'details' }))

  const bars = (items: Json[] | undefined, clickable?: boolean, kind?: 'producer' | 'carrier') =>
    <RepBars items={items} detail={clickable ? (kind === 'carrier' ? R.carrierDetail : R.producerDetail) : null} onGo={(label) => drill(kind || 'producer', label)} />
  const detailPanel = (kind: string) => (v.kind === kind ? <DrillPanel R={R} kind={kind} who={v.who} onClose={() => drill(null, null)} /> : null)

  let body: ReactNode
  if (!has) body = <ReportEmpty />
  else if (tab === 'scorecard') {
    body = <>
      <div className="scgrid">{(D.METRIC_ORDER || []).map((k) => <MetricCard key={k} D={D} R={R} k={k} />)}</div>
      {(R.byMonth || []).length > 0 && (
        <div className="panel">
          <div className="panel-h"><div><div className="panel-t">Written by folio</div><div className="panel-s">AgencyZoom Monthly Sales Summary (Farmers folio calendar) · click a folio to analyze it</div></div></div>
          <div className="panel-b">
            <table className="dect"><thead><tr><th>Folio</th><th className="tr">Premium</th><th className="tr">Policies</th></tr></thead>
              <tbody>{R.byMonth.map((m: Json) => (
                <tr key={m.key} style={m.key === fk ? { background: 'var(--paper)', fontWeight: 700 } : undefined}>
                  <td><a href="#" onClick={(e) => { e.preventDefault(); setFolio(m.key) }} style={{ color: 'var(--bistre)', fontWeight: 600 }}>{m.label} {String(m.year || '')}</a></td>
                  <td className="tr mono">{money0(m.premium || 0)}</td><td className="tr mono">{m.policies || 0}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
      {(R.notes || []).length > 0 && <div className="lic-alert">{ICO.warn}<div><b>From the pull:</b> {R.notes.join(' ')}</div></div>}
    </>
  } else if (tab === 'producer') {
    body = <>
      <div className="panel">
        <div className="panel-h"><div><div className="panel-t">By producer</div><div className="panel-s">Written premium per person{R.producerDetail ? ' · click a name for the policies behind it' : ''}</div></div></div>
        <div className="panel-b">{bars(R.byProducer, true, 'producer')}</div>
      </div>
      {detailPanel('producer')}
    </>
  } else if (tab === 'folio') {
    body = <>
      <div className="p2">
        <div className="panel">
          <div className="panel-h"><div><div className="panel-t">By line</div><div className="panel-s">Written premium by product line</div></div></div>
          <div className="panel-b">{bars(R.byLine)}</div>
        </div>
        <div className="panel">
          <div className="panel-h"><div><div className="panel-t">By carrier</div><div className="panel-s">Where it was placed{R.carrierDetail ? ' · click a carrier for the policies behind it' : ''}</div></div></div>
          <div className="panel-b">{bars(R.byCarrier, true, 'carrier')}</div>
        </div>
      </div>
      {detailPanel('carrier')}
      <div className="panel">
        <div className="panel-h"><div><div className="panel-t">Upcoming renewals</div><div className="panel-s">From the same pull</div></div></div>
        <div className="panel-b">
          {(R.renewals || []).length ? (
            <table className="dect"><thead><tr><th>Client</th><th>Policy</th><th>Line</th><th>Renews</th><th className="tr">Premium</th></tr></thead>
              <tbody>{R.renewals.slice(0, 40).map((r: Json, i: number) => (
                <tr key={i}><td style={{ fontWeight: 600, color: 'var(--bistre)' }}>{r.client}</td><td className="mono">{r.policyNumber || ''}</td><td>{r.line || ''}</td><td>{r.when || ''}</td><td className="tr mono">{money0(r.premium || 0)}</td></tr>
              ))}</tbody>
            </table>
          ) : <div className="empty">Not in this pull.</div>}
        </div>
      </div>
    </>
  } else if (tab === 'commissions') body = <Commissions D={D} folio={v.folio} setFolio={setFolio} agency={agency} agencyShort={agencyShort(me)} />
  else if (tab === 'sdr') body = <Sdr D={D} month={v.sdrMonth} setMonth={(sdrMonth) => set({ sdrMonth })} agency={agency} />
  else if (tab === 'written') body = <Written D={D} v={v} set={set} setFolio={setFolio} />
  else if (tab === 'daily') body = <Daily D={D} chosen={v.day} setDay={(day) => set({ day })} />
  else {
    body = (
      <div className="panel"><div className="panel-b"><div className="ph"><div className="ph-card"><span className="ph-tag">No data</span>
        <h2>{(tabs.find((t) => t.key === tab) || { label: '' }).label}</h2>
        <p>AgencyZoom does not expose this through its API. It stays empty rather than showing a figure that cannot be traced back to a source.</p>
      </div></div></div></div>
    )
  }

  return (
    <div ref={root} className="xd" style={look.style} data-mode={look.dark ? 'dark' : 'light'}>
      <div className="pagehead">
        <div className="hd-titles"><p className="eyebrow">Performance</p><p className="ptitle">Reports</p>
          <p className="psrc">{has ? (R.source || 'AgencyZoom') + ' · pulled ' + R.generatedAt : 'No report loaded'}</p></div>
        <div className="ptabs">
          <button className={'ptab' + (v.mode === 'dash' ? ' on' : '')} onClick={() => set({ mode: 'dash' })}>Dashboard</button>
          <button className={'ptab' + (v.mode === 'details' ? ' on' : '')} onClick={() => set({ mode: 'details' })}>Details</button>
        </div>
      </div>
      {v.mode === 'dash' ? <ReportsDash D={D} st={v} set={set} onGo={(g) => ('tab' in g ? openTab(g.tab) : go(g.path))} /> :
      <div className="wrap">
        <div className="schead">
          <div className="schead-l">
            <div className="schead-a">{agency}</div>
            <h1 className="schead-t">Executive Scorecard</h1>
            <div className="schead-u">{has ? 'Last updated ' + R.generatedAt : 'No report loaded'}</div>
          </div>
          <div className="schead-tabs">
            {tabs.map((t) => <button key={t.key} className={'schead-tab' + (t.key === tab ? ' on' : '')} onClick={() => openTab(t.key)}>{t.label}</button>)}
          </div>
        </div>
        <div className="scbar">
          <span className="scbar-i">{ICO.bars}</span>
          <div className="scbar-t">Executive Scorecard<em>{R.period || 'No period'}</em></div>
          <div className="scbar-f">
            <label className="scbar-g"><span>Folio</span>
              <select className="f" style={{ fontWeight: 700, maxWidth: 230 }} value={fk} onChange={(e) => setFolio(e.target.value)}>
                {wbFolioKeys(D).map((k) => <option key={k} value={k}>{wbFolioLabel(D, k)}</option>)}
              </select>
            </label>
            {([['Period', R.periodLabel || '—'], ['Producer', flt.producer || 'All'], ['Product', flt.product || 'All']] as const).map(([l, x]) => (
              <label key={l} className="scbar-g"><span>{l}</span><b>{x}</b></label>
            ))}
          </div>
          <div className="scbar-u">{has ? 'Updated ' + R.generatedAt : ''}</div>
        </div>
        {body}
      </div>}
    </div>
  )
}

function ReportEmpty() {
  return (
    <div className="panel"><div className="panel-b"><div className="mail-cta"><div className="mail-cta-i">{ICO.bars}</div><div className="mail-cta-b">
      <b>This scorecard fills itself from AgencyZoom</b>
      <p>It reads one block in this file called <code>AZ_REPORT</code>, between the <code>AZ_REPORT_START</code> and <code>AZ_REPORT_END</code> markers. Anything with access to the account — Claude Code running the AgencyZoom skill on your machine — can write that block and every card below appears. Nothing else in the file changes.</p>
      <p style={{ marginBottom: 0 }}>Until then it stays empty rather than showing numbers nobody can trace back to a source.</p>
    </div></div></div></div>
  )
}

function MetricCard({ D, R, k }: { D: PerfData; R: Json; k: string }) {
  const m = (R.metrics || {})[k]
  if (!m) return null
  const icon = ICO[D.METRIC_ICON?.[k]] || ICO.doc
  if (m.noData) {
    return (
      <div className="sccard sccard-nd">
        <div className="sccard-h"><span className="sccard-i nd">{icon}</span><span className="sccard-tag">No data</span></div>
        <div className="sccard-l">{m.label}</div><div className="sccard-v nd">—</div><div className="sccard-s">{m.why || ''}</div>
      </div>
    )
  }
  const pct = m.pct != null ? m.pct : m.goal ? Math.min(100, (m.value / m.goal) * 100) : null
  return (
    <div className="sccard">
      <div className="sccard-h"><span className={'sccard-i ' + (D.METRIC_TONE?.[k] || 'i-blue')}>{icon}</span></div>
      <div className="sccard-l">{m.label}</div>
      <div className="sccard-v">{metricValue(m)}</div>
      <div className="sccard-s">{m.goal != null ? 'Goal: ' + (m.money ? money0(m.goal) : m.goal) : m.sub || ''}</div>
      {pct != null && <div className="sccard-g"><Gauge pct={pct} tone={pct >= 100 ? 'good' : pct >= 60 ? 'warn' : 'bad'} /><span className="sccard-d">—</span></div>}
    </div>
  )
}

/** Horizontal bars (engine.js reportBars): the top ten, and a click-through where the pull has the policies. */
function RepBars({ items, detail, onGo }: { items?: Json[]; detail?: Record<string, Json> | null; onGo?: (label: string) => void }) {
  if (!items || !items.length) return <div className="empty">Not in this pull.</div>
  const max = Math.max(...items.map((i) => i.value || 0), 1)
  return <>{items.slice(0, 10).map((it, n) => {
    const d = detail && detail[it.label]
    return (
      <div key={it.label + n} className={'rp-r' + (d ? ' rp-go' : '')} {...(d ? { tabIndex: 0, role: 'button', onClick: () => onGo?.(it.label) } : {})}>
        <div className="rp-l">{it.label}{d && <span className="rp-x">{d.policies} policies &rsaquo;</span>}</div>
        <div className="rp-t"><div className="rp-f" style={{ width: Math.max(2, ((it.value || 0) / max) * 100).toFixed(1) + '%' }} /></div>
        <div className="rp-v mono">{it.count != null ? it.count + (it.unit ? ' ' + it.unit : '') : money0(it.value || 0)}</div>
        <div className="rp-n">{it.n != null ? it.n : ''}</div>
      </div>
    )
  })}</>
}

function DrillPanel({ R, kind, who, onClose }: { R: Json; kind: string; who: string | null; onClose: () => void }) {
  const d = ((kind === 'carrier' ? R.carrierDetail : R.producerDetail) || {})[who || '']
  if (!d) return null
  const total = d.rows.reduce((t: number, r: Json) => t + (r.premium || 0), 0)
  return (
    <div className="panel drill-p">
      <div className="panel-h"><div><div className="panel-t">{who}</div><div className="panel-s">{d.policies} policies · {money0(d.total)}</div></div>
        <button className="drill-x" onClick={onClose} aria-label="Close">&times;</button></div>
      <div className="panel-b">
        {d.sourceNote && <div className="drill-how">{d.sourceNote}</div>}
        <table className="dect"><thead><tr><th>Customer</th><th>Date</th><th>Line</th><th className="tr">Premium</th></tr></thead>
          <tbody>
            {d.rows.slice().sort((a: Json, b: Json) => b.premium - a.premium).map((r: Json, i: number) => (
              <tr key={i} className={r.missedByPull ? 'miss' : undefined}>
                <td style={{ fontWeight: 600, color: 'var(--bistre)' }}>{r.client}{r.missedByPull && <span className="miss-t">missed by the pull</span>}</td>
                <td>{r.when}</td><td>{r.line}</td><td className="tr mono">{money0(r.premium)}</td>
              </tr>
            ))}
            <tr><td colSpan={3} style={{ fontWeight: 700, color: 'var(--bistre)' }}>Total</td><td className="tr mono" style={{ fontWeight: 800, color: 'var(--bistre)' }}>{money0(total)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Written({ D, v, set, setFolio }: { D: PerfData; v: View; set: (p: Partial<View>) => void; setFolio: (k: string) => void }) {
  const x = computeWritten(D, v.folio, v.carrier, v.biz, v.metric)
  return <>
    <div className="panel"><div className="panel-b"><div className="fbar">
      <div className="fb-g"><label className="fl">Time Frame:</label>
        <select className="f" value={x.key} onChange={(e) => setFolio(e.target.value)}>{wbFolioKeys(D).map((k) => <option key={k} value={k}>{wbFolioLabel(D, k)}</option>)}</select></div>
      <div className="fb-g"><label className="fl">Carrier</label>
        <select className="f" value={v.carrier} onChange={(e) => set({ carrier: e.target.value })}><option value="all">All Carriers</option>{x.carriers.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
      <div className="fb-g"><label className="fl">Business Type:</label>
        <select className="f" value={v.biz} onChange={(e) => set({ biz: e.target.value })}><option value="all">All</option><option value="personal">Personal</option><option value="commercial">Commercial</option></select></div>
      <div className="fb-g"><label className="fl">Metric</label>
        <select className="f" value={v.metric} onChange={(e) => set({ metric: e.target.value })}><option value="premium">Premium</option><option value="policies">Policies</option></select></div>
    </div></div></div>
    <div className="scgrid" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
      <div className="sccard"><div className="sccard-l">Premium</div><div className="sccard-v">{money0(x.premium)}</div><div className="sccard-s">{wbFolioLabel(D, x.key)}</div></div>
      <div className="sccard"><div className="sccard-l">Policies</div><div className="sccard-v">{x.sales.length}</div>
        <div className="sccard-s">{v.carrier === 'all' ? 'All carriers' : v.carrier}{v.biz !== 'all' && <> &middot; {v.biz === 'commercial' ? 'Commercial' : 'Personal'}</>}</div></div>
    </div>
    <div className="panel">
      <div className="panel-h"><div><div className="panel-t">Written Business by Producer</div><div className="panel-s">{v.metric === 'premium' ? 'Premium' : 'Policy count'}</div></div></div>
      <div className="panel-b"><RepBars items={x.bars} /></div>
    </div>
    <div className="panel">
      <div className="panel-h"><div><div className="panel-t">Line items</div><div className="panel-s">{x.sales.length} polic{x.sales.length === 1 ? 'y' : 'ies'} in this view</div></div></div>
      <div className="panel-b">
        {x.rows.length ? (
          <table className="dect"><thead><tr><th>Customer</th><th>Producer</th><th>Date</th><th>Policy</th><th className="tr">Premium</th></tr></thead>
            <tbody>{x.rows.map((s, i) => (
              <tr key={i}><td style={{ fontWeight: 600, color: 'var(--bistre)' }}>{s.name || ''}</td><td>{s.producer || ''}</td><td>{s.soldDate || ''}</td>
                <td>{s.policyType || ''} <span style={{ color: 'var(--muted)', fontSize: '10.5px' }}>({s.source || ''})</span></td><td className="tr mono">{money0(s.premium || 0)}</td></tr>
            ))}</tbody>
          </table>
        ) : <div className="empty">No sales match these filters.</div>}
      </div>
    </div>
  </>
}

const muted = { color: 'var(--muted)', fontSize: '10.5px' }
const link = (url: string | null | undefined, text: string) => (url ? <a href={url} target="_blank" rel="noopener" style={{ color: 'inherit' }}>{text}</a> : text)

function Daily({ D, chosen, setDay }: { D: PerfData; chosen: string | null; setDay: (d: string) => void }) {
  const x = computeDaily(D, chosen), { q, sold, quoted, day } = x
  const sales: Json[] = sold.sales || []
  const nProd = Object.keys(quoted.byProducer || {}).length
  return <>
    <div className="panel"><div className="panel-b"><div className="fbar"><div className="fb-g"><label className="fl">Date</label>
      <select className="f" value={day} onChange={(e) => setDay(e.target.value)}>{x.days.map((d) => <option key={d} value={d}>{d}</option>)}</select>
    </div></div></div></div>
    <div className="scgrid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
      <div className="sccard"><div className="sccard-l">Premium</div><div className="sccard-v">{money0(sold.total || 0)}</div><div className="sccard-s">{day}</div></div>
      <div className="sccard"><div className="sccard-l">Policies</div><div className="sccard-v">{sales.length}</div><div className="sccard-s">sold this day</div></div>
      <div className="sccard"><div className="sccard-l">Quotes</div><div className="sccard-v">{quoted.count}</div><div className="sccard-s">leads in Quoted with a premium</div></div>
      <div className="sccard"><div className="sccard-l">Quoted premium</div><div className="sccard-v">{money0(quoted.premium || 0)}</div>
        <div className="sccard-s">{quoted.count ? nProd + ' producer' + (nProd === 1 ? '' : 's') : 'no quotes this day'}</div></div>
    </div>
    <div className="panel">
      <div className="panel-h"><div><div className="panel-t">Quotes</div><div className="panel-s">{quoted.count} quote{quoted.count === 1 ? '' : 's'} this day &middot; {q.definition || ''}</div></div></div>
      <div className="panel-b">
        {quoted.count ? <>
          <RepBars items={x.quoteBars} />
          <table className="dect" style={{ marginTop: 12 }}><thead><tr><th>Lead</th><th>Producer</th><th>Source</th><th>Lines</th><th>Quote #</th><th>Basis</th><th className="tr">Quoted</th></tr></thead>
            <tbody>{quoted.leads.map((l: Json, i: number) => (
              <tr key={i}>
                <td style={{ fontWeight: 600, color: 'var(--bistre)' }}><a href={l.url} target="_blank" rel="noopener" style={{ color: 'inherit' }}>{l.name}</a>{l.sdrTag && <> <span style={muted}>({l.sdrTag} transfer)</span></>}</td>
                <td>{l.producer}</td><td>{l.leadSource}</td><td>{l.lines}</td>
                <td className="mono" style={{ fontSize: '10.5px' }}>{(l.quotes || []).map((z: Json) => z.quoteId).join(', ')}</td>
                <td style={muted}>{l.dayBasis}</td><td className="tr mono">{money0(l.quotedPremium)}</td>
              </tr>
            ))}</tbody>
          </table>
        </> : <div className="empty">No leads were quoted this day (or none are still sitting in Quoted).</div>}
      </div>
    </div>
    <div className="panel">
      <div className="panel-h"><div><div className="panel-t">Quotes per day</div><div className="panel-s">{(q.coverage || {}).leads || 0} quoted leads on file &middot; pulled {q.pulledAt || ''} &middot; {q.note || ''}</div></div></div>
      <div className="panel-b" style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
        <table className="dect"><thead><tr><th>Day</th><th className="tr">Quotes</th><th className="tr">Quoted premium</th><th>By producer</th><th className="tr">Sold that day</th></tr></thead>
          <tbody>{x.quoteDays.map((d) => {
            const qq = x.qd[d], ss = D.WB_EXTRA.daily[d]
            return (
              <tr key={d} style={d === day ? { background: 'var(--paper)', fontWeight: 700 } : undefined}>
                <td><a href="#" onClick={(e) => { e.preventDefault(); setDay(d) }} style={{ color: 'var(--bistre)', fontWeight: 600 }}>{d}</a></td>
                <td className="tr mono">{qq.count}</td><td className="tr mono">{money0(qq.premium)}</td>
                <td style={{ fontSize: 11 }}>{Object.entries(qq.byProducer).sort((a: any, b: any) => b[1] - a[1]).map(([p, n]) => p + ' ' + n).join(' · ')}</td>
                <td className="tr mono">{ss ? ss.sales.length + ' / ' + money0(ss.total) : '—'}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
    </div>
    <div className="panel">
      <div className="panel-h"><div><div className="panel-t">By producer</div><div className="panel-s">Premium sold this day</div></div></div>
      <div className="panel-b"><RepBars items={x.saleBars} /></div>
    </div>
    <div className="panel">
      <div className="panel-h"><div><div className="panel-t">Sales</div><div className="panel-s">{sales.length} polic{sales.length === 1 ? 'y' : 'ies'}</div></div></div>
      <div className="panel-b">
        {sales.length ? (
          <table className="dect"><thead><tr><th>Customer</th><th>Producer</th><th>Policy</th><th className="tr">Premium</th></tr></thead>
            <tbody>{sales.map((s, i) => (
              <tr key={i}><td style={{ fontWeight: 600, color: 'var(--bistre)' }}>{link(s.url, s.name || '')}</td><td>{s.producer || ''}</td>
                <td>{s.policyType || ''} <span style={muted}>({s.carrier || s.source || ''})</span>{s.confirmed === false && <> <span style={muted}>&middot; lead premium, no policy on file yet</span></>}</td>
                <td className="tr mono">{money0(s.premium || 0)}</td></tr>
            ))}</tbody>
          </table>
        ) : <div className="empty">No sales logged this day.</div>}
      </div>
    </div>
    {sold.source === 'agencyzoom-api' ? (
      <div className="panel">
        <div className="panel-h"><div><div className="panel-t">New leads</div><div className="panel-s">{(sold.newLeads || []).length} created this day in AgencyZoom</div></div></div>
        <div className="panel-b">
          {(sold.newLeads || []).length ? (
            <table className="dect"><thead><tr><th>Lead</th><th>Producer</th><th>Source</th><th>Stage</th></tr></thead>
              <tbody>{sold.newLeads.map((l: Json, i: number) => (
                <tr key={i}><td style={{ fontWeight: 600, color: 'var(--bistre)' }}>{link(l.id ? 'https://app.agencyzoom.com/leads/' + String(l.id) : null, l.name || '')}</td>
                  <td>{l.producer || ''}</td><td>{l.source || ''}</td><td>{l.pipeline ? l.pipeline + ' → ' : ''}{l.stage || ''}</td></tr>
              ))}</tbody>
            </table>
          ) : <div className="empty">No leads created this day.</div>}
          <div className="mail-note" style={{ marginTop: 10 }}>Pulled from AgencyZoom {sold.syncedAt ? azSyncWhen(sold.syncedAt) : ''}.</div>
        </div>
      </div>
    ) : <div className="mail-note">This day was keyed in by hand. Days pulled by the daily sync also list new leads here.</div>}
  </>
}
