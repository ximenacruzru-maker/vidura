// The Reports dashboard (engine.js renderDash + DASH.reports): five headline cards, written-by-week against the
// prior period, management attention, the producer mix and the register of every report. Cards and attention
// items open a drawer that can turn them into a work item, as the original did.
import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../../auth'
import { saveGoals, type Json, type PerfData } from '../../lib/perf/data'
import { money0 } from '../../lib/perf/executive'
import { computeReportsDash, type DashAttn, type DashKpi, type Go } from '../../lib/perf/reports'
import { supabase } from '../../lib/supabase'
import { cusRange } from '../../lib/perf/sales'
import { ICO } from '../executive/parts'

/** The period list, with the custom range the original screens add to it. */
const windows = (D: PerfData) => (D.EXEC_PROD_WINDOWS.some((w) => w[0] === 'custom') ? D.EXEC_PROD_WINDOWS : [...D.EXEC_PROD_WINDOWS, ['custom', 'Custom range'] as [string, string]])

export interface DashState { win: string; book: string; line: string; goals: boolean; from: string; to: string }
type Drawer = { kind: 'kpi'; i: number } | { kind: 'attn'; i: number } | { kind: 'components' } | null

export function ReportsDash({ D, st, set, onGo }: { D: PerfData; st: DashState; set: (p: Partial<DashState>) => void; onGo: (g: Go) => void }) {
  const [goals, setGoals] = useState(D.GOALS)
  const [drawer, setDrawer] = useState<Drawer>(null)
  const x = computeReportsDash(D, st.win, st.book, st.line, { from: st.from, to: st.to })
  const [cFrom, cTo] = cusRange(st.from, st.to)
  const goalSet = async (k: 'premium' | 'policies', v: string) => {
    const n = Number(String(v).replace(/[^0-9.]/g, ''))
    const next = { ...goals, [k]: n > 0 ? n : null }
    D.GOALS = next
    setGoals(next)
    try { await saveGoals(next) } catch (e: any) { alert('Goal not saved: ' + (e?.message || e)) }
  }
  const tone = D.DASH_TONE || {}
  const chartMax = Math.max(...x.chart.series.map((s) => Math.max(s.value || 0, s.value2 || 0)), 1)
  const mixTotal = x.mix.reduce((t, r) => t + (r.value || 0), 0) || 1, mixMax = Math.max(...x.mix.map((r) => r.value || 0), 1)

  return <>
    <div className="wrap">
      <div className="dash-top">
        <div className="fbar">
          <div className="fb-g"><label className="fl">Period</label>
            <select className="f" value={st.win} onChange={(e) => set({ win: e.target.value })}>{windows(D).map((w) => <option key={w[0]} value={w[0]}>{w[1]}</option>)}</select></div>
          {st.win === 'custom' && <>
            <div className="fb-g"><label className="fl">From</label><input type="date" className="f" value={cFrom} max={cTo} onChange={(e) => set({ from: e.target.value })} /></div>
            <div className="fb-g"><label className="fl">To</label><input type="date" className="f" value={cTo} min={cFrom} onChange={(e) => set({ to: e.target.value })} /></div>
          </>}
          <div className="fb-g"><label className="fl">Book</label>
            <select className="f" value={st.book} onChange={(e) => set({ book: e.target.value })}>{(D.REP_BOOKS || []).map((b) => <option key={b[0]} value={b[0]}>{b[1]}</option>)}</select></div>
          <div className="fb-g"><label className="fl">Line</label>
            <select className="f" value={st.line} onChange={(e) => set({ line: e.target.value })}><option value="all">All lines</option>{x.lines.map((l) => <option key={l} value={l}>{l}</option>)}</select></div>
          <button className={'fb-goals' + (st.goals ? ' on' : '')} onClick={() => set({ goals: !st.goals })}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></svg>Edit Goals
          </button>
          {st.goals && (
            <div className="fgoals" style={{ margin: '0 0 0 8px' }}>
              <label>Premium goal<input className="f fb-in" placeholder="Not set" defaultValue={goals.premium || ''} onChange={(e) => goalSet('premium', e.target.value)} /></label>
              <label>Policy goal<input className="f fb-in" placeholder="Not set" defaultValue={goals.policies || ''} onChange={(e) => goalSet('policies', e.target.value)} /></label>
            </div>
          )}
        </div>
        <button className="mc-btn" onClick={() => setDrawer({ kind: 'components' })}>{ICO.doc}<span>Metric Components</span></button>
      </div>

      <div className="scgrid" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
        {x.kpis.map((k, i) => (
          <button key={k.label} className="sccard sc-click dkpi" type="button" onClick={() => setDrawer({ kind: 'kpi', i })}>
            <div className="sccard-h"><span className="sccard-i i-blue">{ICO[k.icon] || ICO.doc}</span></div>
            <div className="dkpi-row">
              <div><div className="sccard-l">{k.label}</div><div className="sccard-v">{k.value}</div><div className="sccard-s">{k.goal || ''}</div></div>
              <Viz v={k.viz} />
            </div>
            <div className="dkpi-f"><span className={'dtrend ' + (k.tone || 'flat')}>{tone[k.tone || 'flat']}&nbsp; {k.delta || ''}</span><span className="dkpi-open">Open actions&nbsp;›</span></div>
          </button>
        ))}
      </div>

      <div className="p21">
        <div className="panel">
          <div className="panel-h"><div><div className="panel-t">{x.chart.title}</div><div className="panel-s">{x.chart.sub}</div></div></div>
          <div className="panel-b"><div className="dchart">
            <span className="dchart-note">{x.chart.note}</span>
            {x.chart.series.map((s) => (
              <div key={s.label} className="dbar-w" title={s.label + ': ' + s.text + ' / ' + s.text2}>
                <div className="dbar" style={{ height: Math.max(2, ((s.value || 0) / chartMax) * 100).toFixed(1) + '%' }} />
                <div className="dbar dbar2" style={{ height: Math.max(2, ((s.value2 || 0) / chartMax) * 100).toFixed(1) + '%' }} />
                <span className="dbar-l">{s.label}</span>
              </div>
            ))}
          </div></div>
        </div>
        <div className="panel">
          <div className="panel-h"><div><div className="panel-t">Management Attention</div><div className="panel-s">Key items requiring action or monitoring</div></div></div>
          <div className="panel-b"><div className="attn">
            {x.attention.length ? x.attention.map((a, i) => (
              <button key={i} className="attn-i" type="button" onClick={() => setDrawer({ kind: 'attn', i })}>
                <span className="rank" style={a.tone === 'good' ? { background: '#00af7a' } : a.tone === 'risk' ? { background: '#f34b55' } : undefined}>{i + 1}</span>
                <span><strong>{a.title}</strong><small>{a.sub || ''}</small></span>
                <span className={'status ' + (a.tone || '')}>{a.action || 'Review'} ›</span>
              </button>
            )) : <div className="empty">Nothing needs attention right now.</div>}
          </div></div>
        </div>
      </div>

      <div className="p21">
        <div className="panel">
          <div className="panel-h"><div><div className="panel-t">Performance Mix</div><div className="panel-s">Written premium by producer · {x.a.r.label}</div></div></div>
          <div className="panel-b">
            {x.mix.length ? x.mix.slice(0, 8).map((r) => (
              <div key={r.label} className="dmix">
                <span className="dmix-l">{r.label}</span>
                <div className="dmix-b"><i style={{ width: (r.value ? Math.max(1.5, ((r.value || 0) / mixMax) * 100).toFixed(1) : 0) + '%' }} /></div>
                <span className="dmix-v">{money0(r.value || 0)}</span>
                <span className="dmix-p">{Math.round(((r.value || 0) / mixTotal) * 100)}%</span>
              </div>
            )) : <div className="empty">Nothing to show yet.</div>}
          </div>
        </div>
        <div className="panel">
          <div className="panel-h"><div><div className="panel-t">Report Register</div><div className="panel-s">Every report the platform produces, with its source and last run</div></div></div>
          <div className="panel-b" style={{ overflowX: 'auto' }}>
            <table className="dect"><thead><tr><th>Report</th><th>Source</th><th>Frequency</th><th>Last run</th></tr></thead>
              <tbody>{x.register.map((r) => (
                <tr key={r[0]}>
                  <td style={{ fontWeight: 800, color: 'var(--ink)' }}><a href="#" onClick={(e) => { e.preventDefault(); onGo({ tab: r[4] }) }} style={{ color: 'var(--ink)', fontWeight: 800 }}>{r[0]}</a></td>
                  <td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="dnote"><strong>Dashboard:</strong> Select any KPI or attention item to open the report behind it. Period, book and line filters apply to written business from the AgencyZoom sales ledger.</div>
    </div>
    <DashDrawer D={D} drawer={drawer} kpis={x.kpis} attention={x.attention} onClose={() => setDrawer(null)} onGo={(g) => { setDrawer(null); onGo(g) }} />
  </>
}

function Viz({ v }: { v: Json | undefined }) {
  if (!v) return null
  const col = (t: string, good: string) => (t === 'bad' ? '#FE454E' : t === 'warn' ? '#F79009' : good)
  if (v.type === 'ring') {
    const p = Math.max(0, Math.min(100, v.pct || 0)), R = 17, C = 2 * Math.PI * R
    return (
      <svg className="dviz" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r={R} fill="none" stroke="#e6eeff" strokeWidth="5" />
        <circle cx="22" cy="22" r={R} fill="none" stroke={col(v.tone, '#164fec')} strokeWidth="5" strokeLinecap="round" strokeDasharray={((C * p) / 100).toFixed(1) + ' ' + C.toFixed(1)} transform="rotate(-90 22 22)" />
        <text x="22" y="25" textAnchor="middle" fontSize="9" fontWeight="900" fill="#071477">{Math.round(p)}%</text>
      </svg>
    )
  }
  if (v.type === 'spark') {
    const vals: number[] = v.values || [], m = Math.max(1, ...vals)
    return <div className="dviz dspark">{vals.map((x, i) => <i key={i} style={{ height: Math.max(8, (x / m) * 100).toFixed(0) + '%' }} />)}</div>
  }
  if (v.type === 'bar') {
    const p = Math.max(0, Math.min(100, v.pct || 0))
    return <div className="dviz dbarv"><div className="dbarv-t"><i style={{ width: p.toFixed(0) + '%', background: col(v.tone, '#12B76A') }} /></div><span>{v.label || Math.round(p) + '%'}</span></div>
  }
  if (v.type === 'dots') {
    return <div className="dviz ddots">{Array.from({ length: v.of || 5 }, (_, i) => <i key={i} className={i < (v.n || 0) ? 'on' : ''} />)}<span>{v.label || ''}</span></div>
  }
  return null
}

function DashDrawer({ D, drawer, kpis, attention, onClose, onGo }: { D: PerfData; drawer: Drawer; kpis: DashKpi[]; attention: DashAttn[]; onClose: () => void; onGo: (g: Go) => void }) {
  useEffect(() => {
    if (!drawer) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [drawer, onClose])
  const source = (D.DASH_SOURCE || {}).reports || 'This file'
  let eye = '', title = '', body: ReactNode = null
  if (drawer?.kind === 'kpi' && kpis[drawer.i]) {
    const k = kpis[drawer.i]
    const def = ((D.METRIC_DEFS || {})[(D.DASH_DEF_KEY || {}).reports] || []).find((d) => d[0].toLowerCase().split(' ')[0] === String(k.label).toLowerCase().split(' ')[0])
    eye = 'METRIC-TO-ACTION WORKFLOW'; title = k.label
    body = <>
      <section className="dr-ctx"><div><small>CURRENT RESULT</small><strong>{k.value != null ? k.value : '—'}</strong></div>
        <div><small>GOAL / THRESHOLD</small><strong>{k.goal || 'Not set'}</strong></div><div><small>SOURCE</small><strong>{source}</strong></div></section>
      <section className="dr-sec"><h3>What this measures</h3><p>{def ? def[1] : k.goal || ''}{k.delta && <> <span className={'status ' + (k.tone === 'down' ? 'risk' : k.tone === 'warn' ? 'warn' : 'good')}>{k.delta}</span></>}</p></section>
      <WorkForm name={'Follow up: ' + k.label} onOpen={() => onGo(k.go)} />
    </>
  } else if (drawer?.kind === 'attn' && attention[drawer.i]) {
    const a = attention[drawer.i]
    eye = 'MANAGEMENT ATTENTION'; title = a.title
    body = <>
      <section className="dr-ctx"><div><small>WHY IT MATTERS</small><strong style={{ fontSize: 14 }}>{a.sub || ''}</strong></div>
        <div><small>STATUS</small><strong>{a.action || 'Review'}</strong></div><div><small>SOURCE</small><strong>{source}</strong></div></section>
      <WorkForm name={a.title} onOpen={() => onGo(a.go)} />
    </>
  } else if (drawer?.kind === 'components') {
    eye = 'DECLARA COMPONENT LIBRARY'; title = 'Metric Components — Reports'
    body = <>
      <p className="dr-intro">The measurements this section is meant to carry. Cards with a value are live from the file; the rest light up as their data source is connected.</p>
      <div className="empty">Every card on this dashboard is listed above it — no additional components are defined for this section yet.</div>
    </>
  }
  const open = !!body
  return <>
    <div className="dr-ov" hidden={!open} onClick={onClose} />
    <aside className={'dr' + (open ? ' open' : '')} aria-hidden={!open}>
      <div className="dr-h"><div><span className="dr-eye">{eye}</span><h2>{title}</h2></div><button className="dr-x" onClick={onClose} aria-label="Close">&times;</button></div>
      <div className="dr-b">{body}</div>
    </aside>
  </>
}

/** "Turn it into work": logs an item in Work & Tickets for the chosen person. */
function WorkForm({ name, onOpen }: { name: string; onOpen: () => void }) {
  const { me } = useAuth()
  const [f, setF] = useState({ name, who: (me?.display_name || '').split(' ')[0], pri: 'High', due: '', area: 'Reports' })
  const [people, setPeople] = useState<string[]>([])
  const [msg, setMsg] = useState<ReactNode>('')
  useEffect(() => { setF((x) => ({ ...x, name })); setMsg('') }, [name])
  useEffect(() => {
    supabase.from('staff_directory').select('display_name').then(({ data }) => {
      setPeople([...new Set(((data || []) as { display_name: string }[]).map((p) => p.display_name.split(' ')[0]).filter(Boolean))].sort())
    })
  }, [])
  const log = async () => {
    if (!f.name.trim()) return
    const { error } = await supabase.from('work_items').insert({ area: f.area || 'General', name: f.name.trim(), kind: null, priority: f.pri, due: f.due || null,
      owner: f.who || null, status: 'Not started', note: 'Created from the Reports dashboard', source: 'Logged by ' + (me?.display_name || 'staff') })
    setMsg(error ? 'Not saved: ' + error.message : <>Logged in <a href="#/work">Work &amp; Tickets</a>.</>)
  }
  const upd = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  return (
    <section className="dr-sec"><h3>Turn it into work</h3>
      <div className="wk-new" style={{ gridTemplateColumns: '1fr 1fr', margin: 0 }}>
        <label className="wk-wide">Work item<input className="f" value={f.name} onChange={upd('name')} /></label>
        <label>Owner<select className="f" value={f.who} onChange={upd('who')}>{[...new Set([f.who, ...people])].filter(Boolean).map((p) => <option key={p}>{p}</option>)}</select></label>
        <label>Priority<select className="f" value={f.pri} onChange={upd('pri')}><option>High</option><option>Normal</option><option>Critical</option><option>Low</option></select></label>
        <label>Due<input className="f" type="date" value={f.due} onChange={upd('due')} /></label>
        <label>Area<input className="f" value={f.area} onChange={upd('area')} /></label>
      </div>
      <div className="dr-btns"><button className="brief-p" onClick={log}>Create work item</button><button className="brief-s" onClick={onOpen}>Open full details</button></div>
      <div className="dr-msg">{msg}</div>
    </section>
  )
}
