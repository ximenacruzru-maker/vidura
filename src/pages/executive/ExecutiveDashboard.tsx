import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { ErrorBox, Loading } from '../../components/ui'
import { loadPerfData, saveGoals, type PerfData } from '../../lib/perf/data'
import { computeExecutive, execProduction, execRows, isFarmersCarrier, money0, today, type Book, type Client, type Drill, type Filters, type Row } from '../../lib/perf/executive'
import { getLook, onLook, type Look } from '../../lib/theme'
import { useAsync } from '../../lib/useAsync'
import { Bars, DayChart, Donut, ICO, Meter, RenewalChart, ScoreCard } from './parts'
import './executive.css'

/* Filters survive leaving and coming back within a session, as they did while the original screens stayed loaded. */
let saved: Filters & { chart: string; goals: boolean; drill: string | null } | null = null

const BOOK_ROUTE: Record<Book, string> = { Farmers: 'farmers', Commercial: 'brokered_commercial', Retail: 'brokered_personal' }

export default function ExecutiveDashboard() {
  const { data, error } = useAsync(loadPerfData, [])
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading what="Loading the dashboard" />
  return <Dashboard D={data} />
}

export function Dashboard({ D }: { D: PerfData }) {
  const go = useNavigate()
  const root = useRef<HTMLDivElement>(null)
  const S = D.S || {}
  const [f, setF] = useState(saved || {
    period: S.exPeriod || '365', book: S.exBook || 'all', line: S.exLine || 'all',
    customStart: S.exCustomStart || '', customEnd: S.exCustomEnd || '', prod: S.exProd || 'folio',
    chart: S.exChart || 'count', goals: !!S.exGoals, drill: S.exDrill || null,
  })
  useEffect(() => { saved = f }, [f])
  const set = (k: keyof typeof f, v: any) => setF((x) => ({ ...x, [k]: v }))

  const [goals, setGoals] = useState(D.GOALS)
  const [goalMsg, setGoalMsg] = useState('')
  const goalSet = async (k: 'premium' | 'policies', v: string) => {
    const n = Number(String(v).replace(/[^0-9.]/g, ''))
    const next = { ...goals, [k]: n > 0 ? n : null }
    D.GOALS = next
    setGoals(next)
    setGoalMsg('Saving…')
    try { await saveGoals(next); setGoalMsg('Saved for the agency.') } catch (e: any) { setGoalMsg('Not saved: ' + (e?.message || e)) }
  }

  const rows = useMemo(() => execRows(D), [D])
  const x = useMemo(() => computeExecutive(D, rows, f), [D, rows, f, goals])
  const look = useLegacyLook(D)
  const [components, setComponents] = useState(false)
  useFitFigures(root)
  useDarkFix(root, !!D.THEMES[look.theme]?.dark)

  /** Open a client's file in Books of Business (the original screens opened their own book pages). */
  const openClient = (book: Book, id: string) => {
    const acct = D.accountOf[book + '|' + id]
    go('/books/' + BOOK_ROUTE[book] + (acct ? '?open=' + encodeURIComponent(acct) : ''))
  }
  const drill = f.drill ? x.drills[f.drill] : null
  const onDrill = (id: string) => set('drill', f.drill === id ? null : id)
  const gPrem = goals.premium, gPol = goals.policies
  const nowLabel = today().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div ref={root} className={'xd' + (components ? ' dr-open' : '')} style={look.style} data-mode={look.dark ? 'dark' : 'light'}>
      <div className="pagehead">
        <div className="hd-titles">
          <p className="eyebrow">Performance</p>
          <p className="ptitle">Executive Dashboard</p>
          <p className="psrc">{rows.length} policies · {new Set(rows.map((r) => r.book)).size} books · {money0(rows.reduce((s, r) => s + (r.prem || 0), 0))} written premium</p>
        </div>
        {/* Temporary, for this release: the original dashboard stays reachable to compare figures side by side. */}
        <a className="psrc" href="#/legacy-dashboard" style={{ alignSelf: 'center', fontWeight: 700 }}>Compare with the original dashboard ›</a>
      </div>
      <div className="wrap">
        <div className="fbar">
          <div className="fb-g"><label className="fl">Period</label>
            <select className="f" value={f.period} onChange={(e) => set('period', e.target.value)}>
              {Object.entries(D.PERIODS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              <option value="custom">Custom range</option>
            </select></div>
          {f.period === 'custom' && <>
            <div className="fb-g"><label className="fl">From</label><input type="date" className="f" value={f.customStart} onChange={(e) => set('customStart', e.target.value)} /></div>
            <div className="fb-g"><label className="fl">To</label><input type="date" className="f" value={f.customEnd} onChange={(e) => set('customEnd', e.target.value)} /></div>
          </>}
          <div className="fb-g"><label className="fl">Book</label>
            <select className="f" value={f.book} onChange={(e) => set('book', e.target.value)}>
              {['all', 'Farmers', 'Commercial', 'Retail'].map((k) => <option key={k} value={k}>{k === 'all' ? 'All books' : D.BOOK_NAME[k]}</option>)}
            </select></div>
          <div className="fb-g"><label className="fl">Line</label>
            <select className="f" value={f.line} onChange={(e) => set('line', e.target.value)}>
              <option value="all">All lines</option>
              {x.kindsAll.map((k) => <option key={k} value={k}>{k}</option>)}
            </select></div>
          <button className={'fb-goals' + (f.goals ? ' on' : '')} onClick={() => set('goals', !f.goals)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></svg>
            Edit Goals</button>
          <button className="mc-btn" onClick={() => setComponents(true)}>{ICO.doc}<span>Metric Components</span></button>
          <div className="fb-u">{ICO.cal}<span>Updated {nowLabel}</span></div>
        </div>
        {f.goals && (
          <div className="fgoals">
            <label>Premium goal<input className="f fb-in" placeholder="Not set" defaultValue={gPrem || ''} onBlur={(e) => e.target.value !== String(gPrem || '') && goalSet('premium', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></label>
            <label>Policy goal<input className="f fb-in" placeholder="Not set" defaultValue={gPol || ''} onBlur={(e) => e.target.value !== String(gPol || '') && goalSet('policies', e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} /></label>
            {goalMsg && <span className="fl">{goalMsg}</span>}
          </div>
        )}
        <div className="fcrumb">{f.book === 'all' ? 'All Books' : D.BOOK_NAME[f.book]} &middot; {f.line === 'all' ? 'All Lines' : f.line} &middot; {x.periodLabel}</div>
        <Production D={D} win={f.prod} setWin={(v) => set('prod', v)} goals={goals} />

        <div className="scg" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
          <ScoreCard icon={ICO.dollar} iconClass="i-blue" label="Written premium" value={x.total} display={money0(x.total)} drill="premium" onDrill={onDrill}
            goalLine={gPrem ? 'Goal ' + money0(gPrem) : 'No goal set'} pct={gPrem ? Math.min(100, (x.total / gPrem) * 100) : null} tone={gPrem && x.total >= gPrem ? 'good' : 'warn'}
            delta={{ tone: 'flat', arrow: '', value: x.priced + ' of ' + x.scoped.length }} goalNote="policies priced" />
          <ScoreCard icon={ICO.users} iconClass="i-amber" label="Retention rate" value={x.retention} display={x.retention.toFixed(1) + '%'} drill="retention" onDrill={onDrill}
            goalLine="Goal 95%" pct={x.retention} tone={x.retention >= 95 ? 'good' : 'warn'}
            delta={{ tone: x.retention >= 95 ? 'up' : 'down', arrow: x.retention >= 95 ? '▲' : '▼', value: (x.retention - 95 >= 0 ? '+' : '') + (x.retention - 95).toFixed(1) + ' pts' }} goalNote="vs goal" />
          <ScoreCard icon={ICO.warn} iconClass="i-red" label="Premium at risk" value={x.atRisk} display={money0(x.atRisk)} drill="atrisk" onDrill={onDrill}
            goalLine={x.terminated.length + ' polic' + (x.terminated.length === 1 ? 'y' : 'ies')} pct={x.total ? (x.atRisk / x.total) * 100 : 0} tone={x.terminated.length ? 'bad' : 'good'}
            delta={{ tone: x.terminated.length ? 'down' : 'up', arrow: '■', value: (x.total ? ((x.atRisk / x.total) * 100).toFixed(0) : '0') + '%' }} goalNote="of book" />
          <ScoreCard icon={ICO.bars} iconClass="i-amber" label="Policies per client" value={x.ppc} display={x.ppc.toFixed(2)} drill="ppc" onDrill={onDrill}
            goalLine="Goal 2.00" pct={Math.min(100, (x.ppc / 2) * 100)} tone={x.ppc >= 2 ? 'good' : 'warn'}
            delta={{ tone: x.ppc >= 2 ? 'up' : 'down', arrow: x.ppc >= 2 ? '▲' : '▼', value: 'Gap ' + (x.ppc - 2 >= 0 ? '+' : '') + (x.ppc - 2).toFixed(2) }} goalNote="vs goal" />
          {(() => { const net = x.newBizPrem - x.atRisk; return (
            <ScoreCard icon={ICO.trend} iconClass="i-green" label="Net growth" value={net} display={(net >= 0 ? '+' : '−') + money0(Math.abs(net))} drill="growth" onDrill={onDrill}
              goalLine={money0(x.newBizPrem) + ' in · ' + money0(x.atRisk) + ' lost'} pct={x.total ? Math.min(100, (Math.abs(net) / x.total) * 100) : 0} tone={net >= 0 ? 'good' : 'bad'}
              delta={{ tone: net >= 0 ? 'up' : 'down', arrow: net >= 0 ? '▲' : '▼', value: (x.total ? ((net / x.total) * 100).toFixed(1) : '0') + '%' }} goalNote="of book premium" />
          ) })()}
          {/* Follows the Period filter, including a custom From/To range. */}
          <ScoreCard icon={ICO.renew} iconClass="i-blue" label="Renewing this period" value={x.winPrem} display={money0(x.winPrem)} drill="renewing" onDrill={onDrill}
            goalLine={x.renewing.length + ' polic' + (x.renewing.length === 1 ? 'y' : 'ies') + ' · ' + x.periodLabel.replace(/^Custom range (from )?/, '')}
            pct={x.total ? Math.min(100, (x.winPrem / x.total) * 100) : 0} tone="good"
            delta={{ tone: 'flat', arrow: '', value: (x.total ? ((x.winPrem / x.total) * 100).toFixed(1) : '0') + '%' }} goalNote="of book premium" />
        </div>

        {drill && <DrillPanel d={drill} bookName={D.BOOK_NAME} onClose={() => set('drill', null)} onOpen={openClient} />}

        <div className="p21">
          <div className="panel">
            <div className="panel-h">
              <div><div className="panel-t">Renewal Performance</div>
                <div className="panel-s">Policies renewing by book and how many carry a premium · {x.periodLabel}{f.book !== 'all' || f.line !== 'all' ? ' · filtered' : ''}</div></div>
              <div className="segt" role="group" aria-label="Chart measure">
                <button className={'segt-b' + (f.chart !== 'prem' ? ' on' : '')} onClick={() => set('chart', 'count')}>Policy Count</button>
                <button className={'segt-b' + (f.chart === 'prem' ? ' on' : '')} onClick={() => set('chart', 'prem')}>Premium $</button>
              </div>
            </div>
            <div className="panel-b">
              <div className="lgnd lgnd-c">
                {(['Commercial', 'Farmers', 'Retail'] as const).map((bk) => <span key={bk} className="lgnd-i"><i style={{ background: D.CHART[bk] }} />{D.BOOK_NAME[bk]}</span>)}
                <span className="lgnd-i"><i className="lgnd-line" />Priced (%)</span>
              </div>
              {x.renewing.length ? <RenewalChart months={x.months} mode={f.chart} colors={D.CHART} bookName={D.BOOK_NAME} />
                : <div className="empty">No renewals fall in this period for this view.</div>}
              <details className="ch-tbl"><summary>Show as table</summary>
                <table>
                  <thead><tr><th>Month</th><th className="tr">Commercial</th><th className="tr">Farmers</th><th className="tr">P&amp;C Brokered</th><th className="tr">Total</th><th className="tc">Policies</th></tr></thead>
                  <tbody>{x.months.map((m) => (
                    <tr key={m.key}><td>{m.label} {m.year}</td>
                      {(['Commercial', 'Farmers', 'Retail'] as const).map((bk) => <td key={bk} className="tr mono">{m[bk] ? money0(m[bk]) : '—'}</td>)}
                      <td className="tr mono"><b>{m.total ? money0(m.total) : '—'}</b></td><td className="tc mono">{m.n || '—'}</td></tr>
                  ))}</tbody>
                </table>
              </details>
              {x.monthsCapped && <div className="rb-band-note" style={{ marginTop: 14 }}>The range spans more than 24 months; the chart shows the first 24. The score card and drill-down cover the whole range.</div>}
              {x.undated > 0 && <div className="rb-band-note" style={{ marginTop: 14 }}>{x.undated} of {x.scoped.length} policies in this view have no expiration date and cannot appear above.</div>}
            </div>
          </div>
          <div className="panel">
            <div className="panel-h"><div><div className="panel-t">Executive Attention</div><div className="panel-s">Key items requiring your focus</div></div></div>
            <div className="panel-b">
              {x.attention.length ? x.attention.map((it, i) => (
                <div key={it.t} className="xa">
                  <div className="xa-n" style={{ background: { bad: '#D93B34', warn: '#E08A17', info: '#164fec' }[it.tone] }}>{i + 1}</div>
                  <div className="xa-b"><div className="xa-t">{it.t}</div><div className="xa-s">{it.s}</div></div>
                  <span className="xa-tag" style={{ background: it.tagBg, color: it.tagFg }}>{it.tag}</span>
                </div>
              )) : <div className="empty">Nothing needs attention in this view.</div>}
            </div>
          </div>
        </div>

        <div className="p2">
          <div className="panel">
            <div className="panel-h"><div><div className="panel-t">Book Mix</div><div className="panel-s">Written premium by line of business</div></div></div>
            <div className="panel-b">
              {x.mix.lines.length ? <Bars items={[...x.mix.lines].sort((a, b) => b.value - a.value)} emphasis /> : <div className="empty">None of these four lines appear in this view.</div>}
              {x.mix.empty.length > 0 && <div className="mix-note">No premium on file for {x.mix.empty.map((l) => l.label).join(', ')} in this view.</div>}
              {x.mix.other > 0 && <div className="mix-note">{money0(x.mix.other)} across {x.mix.otherN} polic{x.mix.otherN === 1 ? 'y' : 'ies'} sits outside these four lines and is not shown.</div>}
            </div>
          </div>
          <div className="panel">
            <div className="panel-h"><div><div className="panel-t">Top Opportunities</div><div className="panel-s">Largest renewals · {x.periodLabel}</div></div></div>
            <div className="panel-b">
              {x.opps.length ? (
                <table className="opp">
                  <thead><tr><th>#</th><th>Client</th><th>Renewal date</th><th className="tr">Premium</th><th>Opportunity</th></tr></thead>
                  <tbody>{x.opps.map((o, i) => (
                    <tr key={o.book + o.id + i} className="opp-r" tabIndex={0} onClick={() => openClient(o.book, o.id)}>
                      <td className="opp-n">{i + 1}</td><td className="opp-c">{o.name}</td><td>{o.when}</td>
                      <td className="tr mono">{money0(o.prem)}</td><td className="opp-p">{o.play}</td></tr>
                  ))}</tbody>
                </table>
              ) : <div className="empty">No priced renewals fall in this period for this view.</div>}
            </div>
          </div>
        </div>

        <div className="p2">
          <div className="panel">
            <div className="panel-h"><div><div className="panel-t">Carrier concentration</div><div className="panel-s">Share of premium by carrier</div></div></div>
            <div className="panel-b">
              {x.carriers.length ? <Bars items={x.carriers.slice(0, 7)} emphasis /> : <div className="empty">Nothing in this view.</div>}
              {x.carriers.length > 0 && <div className={'insight' + (x.carriers[0].pct! > 50 ? ' insight-bad' : '')}><b>{x.carriers[0].pct!.toFixed(0)}% sits with {x.carriers[0].label}.</b>{' '}
                {x.carriers[0].pct! > 50 ? 'One appetite change or rate action there moves most of the agency at once.' : 'Spread looks reasonable.'}</div>}
            </div>
          </div>
          <div className="panel">
            <div className="panel-h"><div><div className="panel-t">Largest clients</div><div className="panel-s">By premium &middot; click through to the file</div></div></div>
            <div className="panel-b">
              {x.topClients.length ? <Bars items={x.topClients} emphasis onGo={(b) => openClient(b.go!.book, b.go!.id)} /> : <div className="empty">Nothing in this view.</div>}
              {x.topClients.length > 0 && <div className={'insight' + (x.topClients[0].pct! > 10 ? ' insight-bad' : '')}><b>{x.topClients[0].label} is {x.topClients[0].pct!.toFixed(1)}% of premium in this view.</b>{' '}
                {x.topClients[0].pct! > 10 ? 'Losing this account would take a visible bite out of revenue.' : 'No single client dominates.'}</div>}
            </div>
          </div>
        </div>

        <div className="p2">
          <div className="panel">
            <div className="panel-h"><div><div className="panel-t">Book health</div><div className="panel-s">How much of the book is actually documented</div></div></div>
            <div className="panel-b">
              <Meter label="Policies with a premium on file" num={x.priced} den={x.scoped.length} tone={x.priced / Math.max(1, x.scoped.length) > 0.8 ? 'good' : 'warn'} />
              <Meter label="Policies with an expiration date" num={x.dated} den={x.scoped.length} note="renewal tracking depends on this" tone={x.dated / Math.max(1, x.scoped.length) > 0.8 ? 'good' : 'warn'} />
              <Meter label="Policies with a document on file" num={x.docs} den={rows.length} note="dec sheets and WC pages" tone={x.docs / rows.length > 0.5 ? 'good' : 'bad'} />
              <div className="insight">Every figure here is bounded by these three bars. The book is {Math.round((x.priced / Math.max(1, x.scoped.length)) * 100)}% priced, so treat totals as a floor.</div>
            </div>
          </div>
        </div>

        <div className="scg scg-nd">
          <ScoreCard icon={ICO.coin} label="Revenue / commission" value={null} why="No commission rates on file. Add them per carrier and this fills in." />
          <ScoreCard icon={ICO.pct} label="Quotes & close rate" value={null} why="Quoting activity lives in AgencyZoom, not here. Connect it under Settings." />
          <ScoreCard icon={ICO.flag} label="New business this period" value={null} why="Requires a written-date on each policy; the carrier lists do not carry one." />
        </div>

        <div className="panel">
          <div className="panel-h"><div><div className="panel-t">Cross-sell opportunity</div><div className="panel-s">Clients carrying a single policy</div></div></div>
          <div className="panel-b"><div className="p2">
            <div><Meter label="Monoline clients" num={x.mono.length} den={x.clients.length} note="one policy only" tone="warn" />
              <div className="insight"><b>{x.mono.length} of {x.clients.length} clients carry exactly one policy.</b> Every one is a second-line conversation, and a retained client is cheaper than a new one.</div></div>
            <div>{x.monoTargets.length ? <Bars items={x.monoTargets} onGo={(b) => openClient(b.go!.book, b.go!.id)} /> : <div className="empty">None in this view.</div>}</div>
          </div></div>
        </div>

        <div className="panel">
          <div className="panel-h"><div><div className="panel-t">Needs attention</div><div className="panel-s">Everything the platform currently knows is wrong or missing</div></div></div>
          <div className="panel-b">
            <div className="exc">{x.exceptions.map((i, n) => (
              <div key={n} className={'exc-r' + (i.go ? ' exc-click' : '')} {...(i.go ? { tabIndex: 0, onClick: () => openClient(i.go!.book, i.go!.id) } : {})}>
                <span className={'exc-b exc-' + i.sev}>{i.sev}</span>
                <div className="exc-t"><div className="exc-w">{i.what}</div><div className="exc-y">{i.why}</div></div>
                <div className="exc-a mono">{i.amt != null && i.amt > 0 ? money0(i.amt) : ''}</div>
              </div>
            ))}</div>
          </div>
        </div>

        <div className="foot">Premiums are annual written premium as recorded, not commission. Goals are saved for the whole agency. Cards marked <b>No data</b> need a source this platform does not yet have — each one names what.</div>
      </div>
      <MetricComponents D={D} open={components} live={x.liveKpis} onClose={() => setComponents(false)} />
    </div>
  )
}

/* ---------- production window ---------- */
function Production({ D, win, setWin, goals }: { D: PerfData; win: string; setWin: (v: string) => void; goals: PerfData['GOALS'] }) {
  const P = execProduction(D, win)
  const conv = P.quotes && P.quotes >= P.sales.length ? (P.sales.length / P.quotes) * 100 : null
  const farmers = P.sales.filter((s) => isFarmersCarrier(s.carrier) || isFarmersCarrier(s.source)).reduce((a, s) => a + (s.premium || 0), 0)
  const other = P.prem - farmers, fShare = P.prem ? (farmers / P.prem) * 100 : 0
  const gPrem = goals.premium, gPol = goals.policies
  const carr: Record<string, number> = {}
  P.sales.forEach((s) => { const c = s.carrier || s.source || 'Other'; carr[c] = (carr[c] || 0) + (s.premium || 0) })
  let byC = Object.entries(carr).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }))
  if (byC.length > 6) { const tail = byC.slice(5); byC = byC.slice(0, 5).concat([{ label: 'Other (' + tail.length + ')', value: tail.reduce((a, s) => a + s.value, 0) }]) }
  const byP = Object.entries(P.byP).sort((a, b) => b[1].p - a[1].p).map(([label, v]) => ({ label, value: v.p }))
  const rep = D.AZ_REPORTS[D.REPORT_DEFAULT_FOLIO] || {}
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-h">
        <div><div className="panel-t">Production &middot; {P.r.label}</div>
          <div className="panel-s">What was written in the window &middot; {P.days} day{P.days === 1 ? '' : 's'} with sales on the ledger{P.official ? <> &middot; AgencyZoom official {money0(P.official)} (last pull {rep.generatedAt || ''})</> : ''}</div></div>
        <div className="fb-g"><label className="fl">Window</label>
          <select className="f" value={win} onChange={(e) => setWin(e.target.value)}>{D.EXEC_PROD_WINDOWS.map((w) => <option key={w[0]} value={w[0]}>{w[1]}</option>)}</select></div>
      </div>
      <div className="panel-b">
        <div className="scg">
          <ScoreCard icon={ICO.dollar} iconClass="i-blue" label="Written premium" value={P.prem} display={money0(P.prem)} goalLine={gPrem ? 'Goal ' + money0(gPrem) : P.sales.length + ' policies'}
            pct={gPrem ? Math.min(100, (P.prem / gPrem) * 100) : P.official ? Math.min(100, (P.prem / P.official) * 100) : null} tone={gPrem ? (P.prem >= gPrem ? 'good' : 'warn') : 'good'}
            delta={{ tone: 'flat', arrow: '', value: gPrem ? Math.round((P.prem / gPrem) * 100) + '%' : P.official ? Math.round((P.prem / P.official) * 100) + '%' : money0(P.sales.length ? P.prem / P.sales.length : 0) }}
            goalNote={gPrem ? 'of goal' : P.official ? 'of the last AgencyZoom pull' : 'avg per policy'} />
          <ScoreCard icon={ICO.shield} iconClass="i-green" label="Farmers premium" value={farmers} display={money0(farmers)} goalLine={money0(other) + ' brokered / other'} pct={fShare}
            tone={fShare >= 70 ? 'good' : 'warn'} delta={{ tone: fShare >= 70 ? 'up' : 'down', arrow: fShare >= 70 ? '▲' : '▼', value: fShare.toFixed(0) + '%' }} goalNote="of written premium" />
          <ScoreCard icon={ICO.doc} iconClass="i-amber" label="Policies" value={P.sales.length} display={String(P.sales.length)}
            goalLine={gPol ? 'Goal ' + gPol : P.sales.length ? money0(P.prem / P.sales.length) + ' avg premium' : 'none in window'}
            pct={gPol ? Math.min(100, (P.sales.length / gPol) * 100) : P.cust ? Math.min(100, (P.cust / Math.max(1, P.sales.length)) * 100) : null}
            tone={gPol ? (P.sales.length >= gPol ? 'good' : 'warn') : 'good'} delta={{ tone: 'flat', arrow: '', value: P.cust + ' customers' }}
            goalNote={P.cust ? (P.sales.length / P.cust).toFixed(2) + ' policies each' : ''} />
          <ScoreCard icon={ICO.target} iconClass="i-blue" label="Quotes" value={P.quotes} display={String(P.quotes)} goalLine={money0(P.qprem) + ' quoted' + (conv == null && P.quotes ? ' · quote log covers part of the window' : '')}
            pct={conv != null ? Math.min(100, conv) : null} tone={conv != null && conv >= 30 ? 'good' : 'warn'}
            delta={{ tone: conv != null && conv >= 30 ? 'up' : 'down', arrow: conv != null ? (conv >= 30 ? '▲' : '▼') : '', value: conv != null ? conv.toFixed(0) + '%' : '—' }} goalNote="quote → sale" />
          <ScoreCard icon={ICO.coin} iconClass="i-red" label="Producer commission" value={P.comm} display={P.folios.length ? money0(P.comm) : '—'} goalLine={P.folios.length ? 'closed-folio basis' : 'folio windows only'}
            pct={P.folios.length && P.prem ? Math.min(100, (P.comm / P.prem) * 100) : null} tone="good"
            delta={{ tone: 'flat', arrow: '', value: P.folios.length && P.prem ? ((P.comm / P.prem) * 100).toFixed(1) + '%' : '' }} goalNote={P.folios.length ? 'of premium' : ''} />
        </div>
        <div className="p21" style={{ marginTop: 14 }}>
          <div className="panel"><div className="panel-h"><div><div className="panel-t">Premium by carrier</div><div className="panel-s">Farmers vs everything else in the window</div></div></div>
            <div className="panel-b">{byC.length ? <Donut rows={byC} center={fShare.toFixed(0) + '%'} centerSub="Farmers" /> : <div className="empty">No written business in this window.</div>}</div></div>
          <div className="panel"><div className="panel-h"><div><div className="panel-t">Premium by producer</div><div className="panel-s">Share of written premium</div></div></div>
            <div className="panel-b">{byP.length ? <Donut rows={byP} colors={['#4d60ff', '#01BCAF', '#F79009', '#12B76A', '#8b5cf6', '#FE454E']} /> : <div className="empty">No sales in this window.</div>}</div></div>
        </div>
        <div style={{ marginTop: 14 }}><DayChart title="Written by day" sub={P.r.label} money series={P.byDay.slice(-31)} /></div>
      </div>
    </div>
  )
}

/* ---------- drill-down ---------- */
function DrillPanel({ d, bookName, onClose, onOpen }: { d: Drill; bookName: Record<string, string>; onClose: () => void; onOpen: (book: Book, id: string) => void }) {
  const note = d.items.length > 150 && <div className="drill-note">Showing the first 150 of {d.items.length}.</div>
  return (
    <div className="panel drill-p">
      <div className="panel-h">
        <div><div className="panel-t">{d.title}</div><div className="panel-s">{d.sub}</div></div>
        <button className="drill-x" onClick={onClose} aria-label="Close details">&times;</button>
      </div>
      <div className="panel-b">
        {d.how && <div className="drill-how">{d.how}</div>}
        {!d.items.length ? <div className="empty">Nothing to list for this metric in the current view.</div>
          : d.kind === 'clients' ? <>
            <table className="drill"><thead><tr><th>Client</th><th>Book</th><th className="tc">Policies</th><th className="tr">Premium</th></tr></thead>
              <tbody>{(d.items as Client[]).slice(0, 150).map((c, i) => (
                <tr key={i} className="drill-r" tabIndex={0} onClick={() => onOpen(c.book, c.id)}>
                  <td className="drill-c">{c.name}</td><td>{bookName[c.book] || c.book}</td><td className="tc mono">{c.n}</td><td className="tr mono">{c.p ? money0(c.p) : '—'}</td></tr>
              ))}</tbody></table>{note}</>
          : <>
            <table className="drill"><thead><tr><th>Client</th><th>Book</th><th>Line</th><th>Carrier</th><th>Renews</th><th className="tr">Premium</th></tr></thead>
              <tbody>{(d.items as Row[]).slice(0, 150).map((r, i) => (
                <tr key={i} className="drill-r" tabIndex={0} onClick={() => onOpen(r.book, r.clientId)}>
                  <td className="drill-c">{r.client || '—'}</td><td>{bookName[r.book] || r.book}</td><td>{r.kind || '—'}</td><td>{r.carrier || '—'}</td>
                  <td>{r.exp || 'no date'}</td><td className="tr mono">{r.prem ? money0(r.prem) : '—'}</td></tr>
              ))}</tbody></table>{note}</>}
      </div>
    </div>
  )
}

/* ---------- Metric Components drawer ---------- */
const MC_ICONS = ['money', 'doc', 'people', 'flag', 'renew', 'clock', 'pct']
function MetricComponents({ D, open, live, onClose }: { D: PerfData; open: boolean; live: { label: string; value: string }[]; onClose: () => void }) {
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [open, onClose])
  const defs = (D.METRIC_DEFS || {})[(D.DASH_DEF_KEY || {}).executive] || []
  const norm = (s: string) => String(s).toLowerCase().replace(/[^a-z%]+/g, ' ').trim()
  const valueOf = (name: string) => live.find((k) => norm(k.label) === norm(name))?.value ?? null
  return <>
    <div className="dr-ov" hidden={!open} onClick={onClose} />
    <aside className={'dr' + (open ? ' open' : '')} aria-hidden={!open}>
      <div className="dr-h"><div><span className="dr-eye">VIDURA COMPONENT LIBRARY</span><h2>Metric Components — Executive Dashboard</h2></div>
        <button className="dr-x" onClick={onClose} aria-label="Close">&times;</button></div>
      <div className="dr-b">
        <p className="dr-intro">The measurements this section is meant to carry. Cards with a value are live from the file; the rest light up as their data source is connected.</p>
        {defs.length ? (
          <div className="mc-grid">{defs.map((d, i) => { const v = valueOf(d[0]); return (
            <div key={d[0]} className="mc-card">
              <div className="mc-head"><span className="mc-ico">{ICO[MC_ICONS[i % 7]]}</span><strong>{d[0]}</strong></div>
              <div className="mc-val">{v != null ? v : <span className="status">Not connected yet</span>}</div>
              <div className="mc-def">{d[1]}</div>
            </div>) })}</div>
        ) : <div className="empty">Every card on this dashboard is listed above it — no additional components are defined for this section yet.</div>}
      </div>
    </aside>
  </>
}

/* ---------- appearance ---------- */
/** The original screens' own theme colours (lg:THEMES) for the person's chosen look. */
function useLegacyLook(D: PerfData): { style: CSSProperties; dark: boolean; theme: string } {
  const [look, setLook] = useState<Look>(getLook())
  useEffect(() => onLook(setLook), [])
  const inSeason = (t: PerfData['THEMES'][string]) => {
    if (!t || !t.season) return true
    const d = new Date(), md = String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    const a = t.season.from, b = t.season.to
    return a <= b ? md >= a && md <= b : md >= a || md <= b
  }
  const key = D.THEMES[look.theme] && inSeason(D.THEMES[look.theme]) ? look.theme : 'vidura'
  const t = D.THEMES[key] || D.THEMES.vidura
  const font = (D.FONTS || {})[look.font]
  const style = { ...(t?.vars || {}), ...(font ? { '--serif': font.serif, '--sans': font.sans } : {}) } as CSSProperties
  return { style, dark: !!t?.dark, theme: key }
}

/** Shrinks a headline figure until it fits its card (engine.js fitFigures). */
function useFitFigures(root: React.RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const fit = () => root.current?.querySelectorAll<HTMLElement>('.sc-v').forEach((el) => {
      el.style.fontSize = ''
      const box = el.parentElement; if (!box) return
      const cs = getComputedStyle(box)
      const avail = box.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
      if (avail <= 0) return
      let fs = parseFloat(getComputedStyle(el).fontSize), guard = 12
      while (el.scrollWidth > avail + 1 && fs > 13 && guard--) { fs -= 1.5; el.style.fontSize = fs + 'px' }
    })
    fit()
    let t = 0
    const onResize = () => { clearTimeout(t); t = window.setTimeout(fit, 80) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); clearTimeout(t) }
  })
}

/** Dark-mode contrast pass (engine.js darkFix): text that lands under 3:1 against its surface is pushed
 *  to whichever end reads, since the stylesheet's light tints were picked for the light design. */
function useDarkFix(root: React.RefObject<HTMLDivElement | null>, dark: boolean) {
  useLayoutEffect(() => {
    const el = root.current; if (!el) return
    el.querySelectorAll<HTMLElement>('[data-darkfixed]').forEach((n) => { n.style.color = ''; n.removeAttribute('data-darkfixed') })
    if (!dark) return
    const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
    const parse = (v: string) => { const m = v && v.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { c: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 } }
    const bg = (n: HTMLElement | null) => { let e = n; while (e && e !== document.documentElement) { const b = parse(getComputedStyle(e).backgroundColor); if (b && b.a > 0.5) return b.c; e = e.parentElement } return [11, 16, 32] }
    el.querySelectorAll<HTMLElement>('*:not(script):not(style):not(svg):not(path)').forEach((n) => {
      if (![...n.childNodes].some((c) => c.nodeType === 3 && c.textContent!.trim())) return
      const fg = parse(getComputedStyle(n).color); if (!fg || fg.a < 0.25) return
      const L2 = lum(bg(n)), L1 = lum(fg.c)
      if ((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05) >= 3) return
      const rat = (c: number[]) => { const l = lum(c); return (Math.max(l, L2) + 0.05) / (Math.min(l, L2) + 0.05) }
      n.style.color = rat([16, 26, 46]) >= rat([233, 238, 251]) ? '#101A2E' : '#E9EEFB'
      n.setAttribute('data-darkfixed', '1')
    })
  })
}
