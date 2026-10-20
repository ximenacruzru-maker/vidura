// Reports › Lead Sources (also on the Reports dashboard): sold by lead source and the return on what each source
// cost — the same figures as Declara Foresight (analyseSources: sold policies by captured lead source, the AgencyZoom
// folio reports for earlier months, and the lead spend recorded on Foresight). Pick the year to date or any folio,
// and all producers or one. Spend isn't kept per producer, so one producer's view shows what they sold by source.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { analyseSources, loadForesight, type ForesightData } from '../../lib/foresight'
import { money0 } from '../../lib/perf/executive'
import { useAsync } from '../../lib/useAsync'
import { useSyncStamp } from '../../lib/syncEvents'

export interface LeadFolio { key: string; start: string; end: string; label: string }
interface Row { source: string; policies: number; premium: number; spend: number; premiumPerDollar: number | null }

const perDollar = (n: number | null) => (n == null ? '—' : '$' + n.toFixed(2))
const pct = (n: number) => Math.round(n * 100) + '%'
const NONE = 'No lead source'
// a source needs this much before it can be called the best (one lucky policy doesn't count)
const ranked = (s: Row, paid: boolean) => s.source !== NONE && s.policies >= 2 && (!paid || s.spend >= 100)

/** One producer's sales in the window, by the lead source AgencyZoom has on each sold policy. */
function byProducer(D: ForesightData, from: string, to: string, producer: string) {
  const m = new Map<string, Row>()
  let total = 0, tied = 0
  D.sales.forEach((s) => {
    if (s.producer !== producer || s.sale_date < from || s.sale_date > to) return
    total += s.premium; if (s.lead_source) tied += s.premium
    const k = s.lead_source || NONE
    const o = m.get(k) || { source: k, policies: 0, premium: 0, spend: 0, premiumPerDollar: null }
    o.policies++; o.premium += s.premium; m.set(k, o)
  })
  const rows = [...m.values()].sort((a, b) => (a.source === NONE ? 1 : b.source === NONE ? -1 : b.premium - a.premium))
  return { rows, coverage: total ? tied / total : 0 }
}

export function LeadSources({ folios, current }: { folios: LeadFolio[]; current: string | null }) {
  const synced = useSyncStamp()
  const nav = useNavigate()
  const { data, error } = useAsync(loadForesight, [synced])
  const [period, setPeriod] = useState<string>(current && folios.some((f) => f.key === current) ? current : 'ytd')
  const [producer, setProducer] = useState('all')
  const today = new Date().toISOString().slice(0, 10)
  const f = folios.find((x) => x.key === period)
  const w = f ? { from: f.start, to: f.end < today ? f.end : today } : { from: today.slice(0, 4) + '-01-01', to: today }
  const label = f ? f.label : `Year to date ${today.slice(0, 4)}`
  const producers = useMemo(() => [...new Set((data?.sales || []).filter((s) => s.sale_date >= w.from && s.sale_date <= w.to).map((s) => s.producer))].sort(), [data, w.from, w.to])
  const who = producer !== 'all' && producers.includes(producer) ? producer : 'all'

  let rows: Row[] = [], coverage = 0, unattributed = 0
  if (data && who === 'all') {
    const a = analyseSources(data, w)
    // paid sources by return per dollar, then the ones with no spend on file by premium
    rows = [...a.sources.filter((s) => s.spend > 0).sort((x, y) => (y.premiumPerDollar || 0) - (x.premiumPerDollar || 0)), ...a.sources.filter((s) => !(s.spend > 0))]
    coverage = a.coverage; unattributed = a.unattributedPremium
  } else if (data) ({ rows, coverage } = byProducer(data, w.from, w.to, who))
  const spend = rows.reduce((t, s) => t + s.spend, 0)
  const paid = who === 'all' && spend > 0
  const best = rows.find((s) => ranked(s, paid) && (!paid || s.spend > 0))
  const counted = rows.filter((s) => s.source !== NONE)
  const sold = counted.reduce((t, s) => t + s.premium, 0), pols = counted.reduce((t, s) => t + s.policies, 0)

  return (
    <div className="panel" data-parity="new">
      <div className="panel-h">
        <div><div className="panel-t">Sold by lead source{who === 'all' ? ' · return on spend' : ` · ${who}`}</div>
          <div className="panel-s">{label} · {who === 'all' ? 'premium per $1 = sold premium ÷ what the source cost · same figures as Declara Foresight' : 'what this producer sold, by the lead source AgencyZoom has on each policy'}</div></div>
        <div className="fbar" style={{ margin: 0 }}>
          <div className="fb-g"><label className="fl">Period</label>
            <select className="f" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
              <option value="ytd">Year to date</option>{folios.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select></div>
          <div className="fb-g"><label className="fl">Producer</label>
            <select className="f" value={who} onChange={(e) => setProducer(e.target.value)} aria-label="Producer">
              <option value="all">All producers</option>{producers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select></div>
        </div>
      </div>
      <div className="panel-b" style={{ overflowX: 'auto' }}>
        {error ? <div className="empty">Couldn’t load lead sources: {String((error as Error).message || error)}</div> : !data ? <div className="empty">Adding up lead sources…</div> : !rows.length ? (
          <div className="empty">No sold policies in this period{who === 'all' ? '' : ' for ' + who} can be tied to a lead source yet.</div>
        ) : <>
          <div className="scgrid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: 14 }}>
            <div className="sccard"><div className="sccard-l">{paid ? 'Best return' : 'Top lead source'}</div><div className="sccard-v">{best ? best.source : '—'}</div>
              <div className="sccard-s">{best ? (paid ? `${perDollar(best.premiumPerDollar)} premium per $1 · ${best.policies} sold` : `${money0(best.premium)} · ${best.policies} sold`) : 'not enough sales yet to rank'}</div></div>
            <div className="sccard"><div className="sccard-l">Sold with a lead source</div><div className="sccard-v">{money0(sold)}</div><div className="sccard-s">{pols} policies · {pct(coverage)} of sold premium can be tied to a source</div></div>
            {who === 'all' && <div className="sccard"><div className="sccard-l">Lead spend on file</div><div className="sccard-v">{money0(spend)}</div>
              <div className="sccard-s">{spend ? `${perDollar(rows.filter((s) => s.spend > 0).reduce((t, s) => t + s.premium, 0) / spend)} premium per $1 across paid sources` : 'none recorded for this period'}</div></div>}
          </div>
          <table className="dect"><thead><tr><th>Lead source</th><th className="tr">Policies sold</th><th className="tr">Sold premium</th>
            {who === 'all' && <><th className="tr">Spend</th><th className="tr">Premium per $1</th><th className="tr">Cost per policy</th></>}</tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.source} style={s.source === NONE ? { color: 'var(--muted)' } : undefined}><td style={{ fontWeight: 600, color: s.source === NONE ? undefined : 'var(--bistre)' }}>{s.source}{best === s ? ' ★' : ''}</td>
                <td className="tr mono">{s.policies}</td><td className="tr mono">{money0(s.premium)}</td>
                {who === 'all' && <>
                  <td className="tr mono">{s.spend ? money0(s.spend) : <span style={{ color: 'var(--muted)' }}>no spend recorded</span>}</td>
                  <td className="tr mono" style={s.premiumPerDollar != null ? { fontWeight: 700, color: best === s ? '#1F7A4D' : undefined } : undefined}>{perDollar(s.premiumPerDollar)}</td>
                  <td className="tr mono">{s.spend && s.policies ? money0(s.spend / s.policies) : '—'}</td></>}</tr>
            ))}</tbody>
          </table>
          {unattributed > 0 && <p className="note" style={{ marginTop: 10 }}>{money0(unattributed)} of sold premium in this period has no lead source in AgencyZoom, so it isn’t counted above.</p>}
          {who !== 'all' && <p className="note" style={{ marginTop: 10 }}>Lead spend isn’t kept per producer, so the return per $1 shows under All producers.</p>}
          {who === 'all' && !spend && <p className="note" style={{ marginTop: 10 }}>No lead spend is recorded for this period, so the return can’t be worked out yet. <a href="#" onClick={(e) => { e.preventDefault(); nav('/foresight') }}>Record what each source cost on Declara Foresight</a> and it shows here.</p>}
        </>}
      </div>
    </div>
  )
}
