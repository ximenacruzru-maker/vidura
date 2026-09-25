import { useMemo, useState } from 'react'
import { useAuth } from '../../auth'
import { Empty, ErrorBox, Loading, PageHead, Panel, Tile, Tiles } from '../../components/ui'
import {
  addSpend, analyseSources, deleteSpend, loadForesight, MIN_DAYS, MIN_POLICIES, MIN_SPEND, producerRanking, project, recommend,
  SHIFT_CEIL, SHIFT_FLOOR, weekdayPattern, windowFor, type ForesightData, type SourceStat,
} from '../../lib/foresight'
import { money0, shortDate, todayPacific } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import './foresight.css'

const pct = (n: number, d = 0) => (n * 100).toFixed(d) + '%'
const signed = (n: number, f: (x: number) => string) => (n > 0 ? '+' : n < 0 ? '−' : '') + f(Math.abs(n))
const perDollar = (n: number | null) => (n == null ? '—' : '$' + n.toFixed(2))

export default function Foresight() {
  const [reload, setReload] = useState(0)
  const { data, error } = useAsync(loadForesight, [reload])
  const head = <PageHead kicker="Performance" title="Vida Foresight" sub="Sales patterns, producer ranking and lead spend, from the policies AgencyZoom shows as sold and the spend you record here." />
  if (error) return <>{head}<ErrorBox error={error} /></>
  if (!data) return <>{head}<Loading /></>
  const today = todayPacific()
  const first = data.sales.reduce((m, s) => (s.sale_date < m ? s.sale_date : m), today)
  return (
    <div className="fs">
      {head}
      {(!data.hasLeadSource || !data.hasSpendTable) && (
        <div className="band-note">The Vida Foresight database migration hasn't been run yet ({[!data.hasLeadSource && 'no lead source on sold policies', !data.hasSpendTable && 'no lead spend table'].filter(Boolean).join(', ')}).
          Day-of-week and producer figures below are complete; lead-spend analysis uses the saved AgencyZoom folio reports only until it is.</div>
      )}
      <Weekdays D={data} today={today} first={first} />
      <Producers D={data} today={today} first={first} />
      <Sources D={data} today={today} first={first} onChanged={() => setReload((n) => n + 1)} />
    </div>
  )
}

/* ---------- 1. day of week ---------- */
function Weekdays({ D, today, first }: { D: ForesightData; today: string; first: string }) {
  const [win, setWin] = useState('365')
  const [metric, setMetric] = useState<'premium' | 'policies'>('premium')
  const w = windowFor(win, today, first)
  const { stats, from } = useMemo(() => weekdayPattern(D.sales, w), [D, w.from, w.to])
  const val = (s: typeof stats[number]) => (metric === 'premium' ? s.avgPremium : s.avgPolicies)
  const fmt = (n: number) => (metric === 'premium' ? money0(n) : n.toFixed(2))
  const best = stats.reduce((b, s) => (val(s) > val(b) ? s : b), stats[0])
  const total = stats.reduce((t, s) => t + s.policies, 0)
  return (
    <Panel title="Which days you sell on" sub={total ? `Average sold ${metric === 'premium' ? 'premium' : 'policies'} per calendar day, ${shortDate(from, true)} – ${shortDate(w.to, true)} · ${total} policies · days with no sales count as zero` : 'No sold policies in this window.'}
      right={<div className="filters">
        <select value={win} onChange={(e) => setWin(e.target.value)} aria-label="Window">
          <option value="90">Last 90 days</option><option value="365">Last 12 months</option><option value="all">All history</option>
        </select>
        <select value={metric} onChange={(e) => setMetric(e.target.value as 'premium')} aria-label="Measure">
          <option value="premium">Premium</option><option value="policies">Policies</option>
        </select>
      </div>}>
      {total ? <>
        <ColumnChart bars={stats.map((s) => ({ label: s.day, value: val(s), tip: `${s.day}: ${fmt(val(s))} a day on average · ${s.policies} policies, ${money0(s.premium)} across ${s.dates} ${s.day}s` }))}
          format={fmt} highlight={best.day} />
        <p className="note"><b>{best.day}</b> is the strongest day at {fmt(val(best))} a day on average.</p>
        <details className="fs-table"><summary>Show as table</summary>
          <table className="tbl"><thead><tr><th>Day</th><th className="r">Days in window</th><th className="r">Policies</th><th className="r">Premium</th><th className="r">Avg premium / day</th><th className="r">Avg policies / day</th></tr></thead>
            <tbody>{stats.map((s) => <tr key={s.day}><td>{s.day}</td><td className="r mono">{s.dates}</td><td className="r mono">{s.policies}</td><td className="r mono">{money0(s.premium)}</td><td className="r mono">{money0(s.avgPremium)}</td><td className="r mono">{s.avgPolicies.toFixed(2)}</td></tr>)}</tbody></table>
        </details>
      </> : <Empty>Nothing sold in this window.</Empty>}
    </Panel>
  )
}

/** Vertical columns, one series; value label only on the highlighted column, every column has a tooltip. */
function ColumnChart({ bars, format, highlight }: { bars: { label: string; value: number; tip: string }[]; format: (n: number) => string; highlight?: string }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const W = 1100, H = 260, PL = 56, PR = 12, PT = 22, PB = 28
  const max = Math.max(...bars.map((b) => b.value), 0)
  const raw = max / 4 || 1, mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) || 10 * mag
  const top = Math.ceil(max / step) * step || step * 4
  const band = (W - PL - PR) / bars.length, bw = Math.min(24, band * 0.6)
  const y = (v: number) => PT + (H - PT - PB) * (1 - v / top)
  return (
    <div className="fs-chart" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={bars.map((b) => b.label + ' ' + format(b.value)).join(', ')}>
        {[0, 1, 2, 3, 4].map((i) => {
          const v = (top * i) / 4
          return <g key={i}><line className="fs-grid" x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} /><text className="fs-ax" x={PL - 8} y={y(v) + 4} textAnchor="end">{format(v)}</text></g>
        })}
        {bars.map((b, i) => {
          const cx = PL + band * i + band / 2, h = y(0) - y(b.value), r = Math.min(4, h)
          const x0 = cx - bw / 2, x1 = cx + bw / 2, yt = y(b.value), yb = y(0)
          return (
            <g key={b.label}>
              {h > 0 && <path className="fs-bar" d={`M${x0},${yb} V${yt + r} Q${x0},${yt} ${x0 + r},${yt} H${x1 - r} Q${x1},${yt} ${x1},${yt + r} V${yb} Z`} />}
              {b.label === highlight && h > 0 && <text className="fs-val" x={cx} y={yt - 7} textAnchor="middle">{format(b.value)}</text>}
              <text className="fs-ax" x={cx} y={H - 8} textAnchor="middle">{b.label}</text>
              <rect className="fs-hit" x={cx - band / 2} y={PT} width={band} height={yb - PT} tabIndex={0}
                onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, text: b.tip })}
                onFocus={() => setTip({ x: 0, y: 0, text: b.tip })} onBlur={() => setTip(null)}><title>{b.tip}</title></rect>
            </g>
          )
        })}
      </svg>
      {tip && <div className="fs-tip" style={{ left: tip.x + 12, top: tip.y - 12 }}>{tip.text}</div>}
    </div>
  )
}

/* ---------- 2. producers ---------- */
function Producers({ D, today, first }: { D: ForesightData; today: string; first: string }) {
  const [win, setWin] = useState('90')
  const w = windowFor(win, today, first)
  const rows = useMemo(() => producerRanking(D.sales, w), [D, w.from, w.to])
  const max = Math.max(...rows.map((r) => r.premium), 1)
  return (
    <Panel title="Best-performing producer" sub={`Ranked by sold premium, ${shortDate(w.from, true)} – ${shortDate(w.to, true)}. Policies and average premium are context. Close rate isn't shown: AgencyZoom leads that were lost or sold aren't kept, so there is no reliable count of what each producer quoted.`}
      right={<div className="filters"><select value={win} onChange={(e) => setWin(e.target.value)} aria-label="Window">
        <option value="mtd">This month</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
        <option value="ytd">Year to date</option><option value="365">Last 12 months</option><option value="all">All history</option>
      </select></div>}>
      {rows.length ? (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>#</th><th>Producer</th><th>Sold premium</th><th className="r">Policies</th><th className="r">Avg premium</th><th className="r">Share</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={r.producer}><td className="mono">{i + 1}</td><td className="strong">{r.producer}</td>
              <td className="fs-barcell"><span className="fs-hbar" style={{ width: (r.premium / max) * 70 + '%' }} /><span className="mono">{money0(r.premium)}</span></td>
              <td className="r mono">{r.policies}</td><td className="r mono">{money0(r.avg)}</td><td className="r mono">{pct(r.share)}</td></tr>
          ))}</tbody>
        </table></div>
      ) : <Empty>No sold policies in this window.</Empty>}
    </Panel>
  )
}

/* ---------- 3 & 4. lead sources ---------- */
const RATE_KEY = 'vidura_foresight_commission_rate'
function Sources({ D, today, first, onChanged }: { D: ForesightData; today: string; first: string; onChanged: () => void }) {
  const [win, setWin] = useState('365')
  const w = windowFor(win, today, first)
  const a = useMemo(() => analyseSources(D, w), [D, w.from, w.to])
  const plan = useMemo(() => recommend(a), [a])
  const paid = a.sources.filter((s) => s.spend > 0)
  const known = [...new Set(a.sources.map((s) => s.source).concat(D.spend.map((s) => s.source)))].sort()
  const noAttribution = !a.attributedDays
  return <>
    <Panel title="Lead sources: what each dollar returned"
      sub={noAttribution ? 'No sold premium in this window can be tied to a lead source yet.'
        : `${a.attributedDays} of ${a.windowDays} days in the window can be tied to a source (${a.folioDays} from AgencyZoom folio reports${a.capturedFrom ? `, the rest from sales captured since ${shortDate(a.capturedFrom, true)}` : ''}) — ${pct(a.coverage)} of sold premium. Spend is counted over those same days.`}
      right={<div className="filters"><select value={win} onChange={(e) => setWin(e.target.value)} aria-label="Window">
        <option value="90">Last 90 days</option><option value="180">Last 6 months</option><option value="365">Last 12 months</option><option value="all">All history</option>
      </select></div>}>
      {noAttribution ? <Empty>Sold policies start carrying their lead source once the migration has run and the AgencyZoom sync has been redeployed. Until then only months covered by a saved AgencyZoom folio report can be analysed.</Empty> : <>
        {a.coverage < 0.8 && <div className="band-note" style={{ marginTop: 0, marginBottom: 12 }}>Only {pct(a.coverage)} of sold premium in this window can be tied to a source, so treat per-source figures as partial.</div>}
        {a.unattributedPremium > 0 && <p className="note" style={{ marginTop: 0 }}>{money0(a.unattributedPremium)} of captured sales came from customers with no won lead in AgencyZoom, so it has no source.</p>}
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Source</th><th className="r">Sold premium</th><th className="r">Policies</th><th className="r">Spend</th><th className="r">Premium per $1</th><th className="r">Cost per policy</th></tr></thead>
          <tbody>{a.sources.map((s) => (
            <tr key={s.source}><td className="strong">{s.source}</td><td className="r mono">{money0(s.premium)}</td><td className="r mono">{s.policies}</td>
              <td className="r mono">{s.spend ? money0(s.spend) : <span className="pill pill-muted">no spend recorded</span>}</td>
              <td className="r mono">{perDollar(s.premiumPerDollar)}</td><td className="r mono">{s.spend && s.policies ? money0(s.spend / s.policies) : '—'}</td></tr>
          ))}</tbody>
        </table></div>
      </>}
    </Panel>
    {!noAttribution && <Recommendation plan={plan} hasSpend={paid.length > 0} />}
    {!noAttribution && paid.length > 0 && <Sliders sources={paid} />}
    <SpendRecords D={D} known={known} onChanged={onChanged} />
  </>
}

function Recommendation({ plan, hasSpend }: { plan: ReturnType<typeof recommend>; hasSpend: boolean }) {
  const max = Math.max(...plan.rows.flatMap((r) => [r.current, r.recommended]), 1)
  const moved = plan.rows.some((r) => Math.abs(r.recommended - r.current) > 0.5)
  return (
    <Panel title="Recommended monthly spend"
      sub={`Same total budget, moved toward the paid sources that return more sold premium per dollar. A source's budget moves only once it has ${MIN_DAYS}+ days of history and ${MIN_POLICIES}+ policies or $${MIN_SPEND}+ spent, and never below ${pct(SHIFT_FLOOR)} or above ${pct(SHIFT_CEIL)} of what it gets now — returns rarely stay linear beyond that.`}>
      {!hasSpend ? <Empty>No lead spend is on file for this window, so there is nothing to compare. Record what each source cost below; nothing here is estimated.</Empty> : <>
        <Tiles>
          <Tile label="Monthly budget" value={money0(plan.budget)} sub="paid sources with enough history" />
          <Tile label="Blended return" value={perDollar(plan.blended)} sub="sold premium per $1 across them" />
          <Tile label="Premium / month if shifted" value={money0(plan.recommendedPremium)} sub={moved ? `${signed(plan.recommendedPremium - plan.currentPremium, money0)} vs ${money0(plan.currentPremium)} now · linear estimate` : 'no change recommended'} tone={plan.recommendedPremium > plan.currentPremium ? 'good' : undefined} />
        </Tiles>
        <div className="fs-legend"><span><i className="cur" />Current</span><span><i className="rec" />Recommended</span></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Source</th><th className="r">Per $1</th><th>Monthly spend</th><th className="r">Change</th><th>Why</th></tr></thead>
          <tbody>{plan.rows.map((r) => {
            const d = r.current ? r.recommended / r.current - 1 : 0
            return (
              <tr key={r.source.source}><td className="strong">{r.source.source}</td><td className="r mono">{perDollar(r.source.premiumPerDollar)}</td>
                <td className="fs-pair">
                  <div><span className="fs-hbar cur" style={{ width: (r.current / max) * 70 + '%' }} /><span className="mono">{money0(r.current)}</span></div>
                  <div><span className="fs-hbar rec" style={{ width: (r.recommended / max) * 70 + '%' }} /><span className="mono">{money0(r.recommended)}</span></div>
                </td>
                <td className="r">{Math.abs(d) < 0.005 ? <span className="pill pill-muted">hold</span> : <span className={'pill ' + (d > 0 ? 'pill-good' : 'pill-warn')}>{signed(d, (x) => pct(x))}</span>}</td>
                <td className="sub">{r.reason}</td></tr>
            )
          })}</tbody>
        </table></div>
        {plan.organic.length > 0 && <p className="note">No spend recorded for {plan.organic.map((s) => s.source).join(', ')}. They're left out of the budget; if any of them does cost money, record it below.</p>}
      </>}
    </Panel>
  )
}

function Sliders({ sources }: { sources: SourceStat[] }) {
  const [move, setMove] = useState<Record<string, number>>({})
  const [rate, setRate] = useState(() => { try { return localStorage.getItem(RATE_KEY) || '' } catch { return '' } })
  const r = rate.trim() === '' ? null : Math.max(0, Number(rate)) / 100
  const setR = (v: string) => { setRate(v); try { localStorage.setItem(RATE_KEY, v) } catch { /* private mode */ } }
  const rows = sources.map((s) => ({ s, p: (move[s.source] || 0) / 100, ...project(s, (move[s.source] || 0) / 100, r) }))
  const tot = rows.reduce((t, x) => ({ dSpend: t.dSpend + x.dSpend, dPremium: t.dPremium + x.dPremium, dPolicies: t.dPolicies + x.dPolicies }), { dSpend: 0, dPremium: 0, dPolicies: 0 })
  return (
    <Panel title="What if you changed spend?"
      sub="Estimate based on historical performance: each source's past sold premium per dollar × the new spend. It's a straight-line projection, not a trained model — real returns usually flatten as spend grows, so treat big increases as optimistic."
      right={<div className="filters fs-rate"><label>New-business commission rate <input className="fld" inputMode="decimal" placeholder="e.g. 12" value={rate} onChange={(e) => setR(e.target.value)} />%</label>
        <button className="btn-ghost" onClick={() => setMove({})}>Reset</button></div>}>
      <Tiles>
        <Tile label="Spend change / month" value={signed(tot.dSpend, money0)} />
        <Tile label="Projected premium / month" value={signed(tot.dPremium, money0)} tone={tot.dPremium > 0 ? 'good' : undefined} />
        <Tile label="Projected policies / month" value={signed(tot.dPolicies, (x) => x.toFixed(1))} />
        <Tile label="Projected revenue / month" value={r == null ? '—' : signed(tot.dPremium * r, money0)} sub={r == null ? 'enter your commission rate to see this' : `at the ${pct(r, 1)} you entered`} />
      </Tiles>
      <div className="fs-sliders">{rows.map((x) => (
        <div key={x.s.source} className="fs-slider">
          <div className="fs-slider-h"><b>{x.s.source}</b><span className="sub">{money0(x.s.monthlySpend)}/mo now · {perDollar(x.s.premiumPerDollar)} per $1</span></div>
          <input type="range" min={-50} max={100} step={5} value={move[x.s.source] || 0} aria-label={`Change spend on ${x.s.source}`}
            onChange={(e) => setMove((m) => ({ ...m, [x.s.source]: Number(e.target.value) }))} />
          <div className="fs-slider-r"><span className="mono">{signed(x.p, (v) => pct(v))}</span>
            <span>{signed(x.dSpend, money0)} spend → <b>{signed(x.dPremium, money0)}</b> premium, {signed(x.dPolicies, (v) => v.toFixed(1))} policies{x.dRevenue != null ? `, ${signed(x.dRevenue, money0)} revenue` : ''} a month</span></div>
        </div>
      ))}</div>
    </Panel>
  )
}

/* ---------- lead spend records ---------- */
function SpendRecords({ D, known, onChanged }: { D: ForesightData; known: string[]; onChanged: () => void }) {
  const { me } = useAuth()
  const canEdit = me?.role === 'owner' || me?.role === 'admin'
  const [f, setF] = useState({ source: '', period_start: '', period_end: '', amount: '', notes: '' })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    const amount = Number(f.amount)
    if (!f.source.trim() || !f.period_start || !f.period_end || !(amount >= 0) || f.amount === '') { setMsg('Source, both dates and an amount are required.'); return }
    if (f.period_end < f.period_start) { setMsg('The end date is before the start date.'); return }
    setBusy(true); setMsg('')
    try { await addSpend({ source: f.source.trim(), period_start: f.period_start, period_end: f.period_end, amount, notes: f.notes.trim() || null }); setF({ source: f.source, period_start: '', period_end: '', amount: '', notes: '' }); onChanged() }
    catch (e: any) { setMsg('Not saved: ' + (e?.message || e)) } finally { setBusy(false) }
  }
  const remove = async (id: string) => {
    if (!confirm('Delete this spend record?')) return
    try { await deleteSpend(id); onChanged() } catch (e: any) { setMsg('Not deleted: ' + (e?.message || e)) }
  }
  const rows = [...D.spend].sort((a, b) => b.period_start.localeCompare(a.period_start))
  return (
    <Panel title="Lead spend on file" sub="What each lead source cost, for a date range. Use the source name exactly as AgencyZoom spells it so spend lines up with the sales it bought.">
      {!D.hasSpendTable ? <Empty>The lead_spend table doesn't exist yet — run the Vida Foresight migration first.</Empty> : <>
        {canEdit && (
          <div className="form-grid" style={{ marginBottom: 14 }}>
            <label>Source<input className="fld" list="fs-sources" value={f.source} onChange={set('source')} /></label>
            <datalist id="fs-sources">{known.map((s) => <option key={s} value={s} />)}</datalist>
            <label>From<input className="fld" type="date" value={f.period_start} onChange={set('period_start')} /></label>
            <label>To<input className="fld" type="date" value={f.period_end} onChange={set('period_end')} /></label>
            <label>Amount ($)<input className="fld" inputMode="decimal" value={f.amount} onChange={set('amount')} /></label>
            <label>Notes<input className="fld" value={f.notes} onChange={set('notes')} placeholder="invoice, campaign…" /></label>
            <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Add spend'}</button>
          </div>
        )}
        {msg && <p className="note" role="alert">{msg}</p>}
        {rows.length ? (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Source</th><th>Period</th><th className="r">Amount</th><th className="r">Per day</th><th>Notes</th>{canEdit && <th />}</tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id}><td className="strong">{s.source}</td><td>{shortDate(s.period_start, true)} – {shortDate(s.period_end, true)}</td>
                <td className="r mono">{money0(s.amount)}</td>
                <td className="r mono">{'$' + (s.amount / (Math.round((Date.parse(s.period_end) - Date.parse(s.period_start)) / 86400000) + 1)).toFixed(2)}</td>
                <td className="sub">{s.notes}</td>{canEdit && <td className="r"><button className="btn-ghost" onClick={() => remove(s.id)}>Delete</button></td>}</tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>No lead spend recorded yet.</Empty>}
      </>}
    </Panel>
  )
}
