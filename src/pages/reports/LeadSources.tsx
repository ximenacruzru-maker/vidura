// Reports › Folio: sold by lead source and the return on what each source cost — the same figures as Declara
// Foresight (analyseSources: sold policies by captured lead source, the AgencyZoom folio reports for earlier months,
// and the lead spend recorded on Foresight), for the folio picked above or the year to date.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { analyseSources, loadForesight, type SourceStat } from '../../lib/foresight'
import { money0 } from '../../lib/perf/executive'
import { useAsync } from '../../lib/useAsync'
import { useSyncStamp } from '../../lib/syncEvents'

const perDollar = (n: number | null) => (n == null ? '—' : '$' + n.toFixed(2))
const pct = (n: number) => Math.round(n * 100) + '%'
// a source needs this much before it can be called the best return (one lucky policy doesn't count)
const ranked = (s: SourceStat) => s.spend >= 100 && s.policies >= 2

export function LeadSources({ folio }: { folio: { start: string; end: string; label: string } | null }) {
  const synced = useSyncStamp()
  const nav = useNavigate()
  const { data, error } = useAsync(loadForesight, [synced])
  const [win, setWin] = useState<'folio' | 'ytd'>('folio')
  const today = new Date().toISOString().slice(0, 10)
  const w = win === 'folio' && folio ? { from: folio.start, to: folio.end < today ? folio.end : today } : { from: today.slice(0, 4) + '-01-01', to: today }
  const a = data ? analyseSources(data, w) : null
  // paid sources by return per dollar, then the ones with no spend on file by premium
  const rows = a ? [...a.sources.filter((s) => s.spend > 0).sort((x, y) => (y.premiumPerDollar || 0) - (x.premiumPerDollar || 0)), ...a.sources.filter((s) => !(s.spend > 0))] : []
  const best = rows.find(ranked)
  const sold = rows.reduce((t, s) => t + s.premium, 0), pols = rows.reduce((t, s) => t + s.policies, 0), spend = rows.reduce((t, s) => t + s.spend, 0)

  return (
    <div className="panel" data-parity="new">
      <div className="panel-h">
        <div><div className="panel-t">Sold by lead source · return on spend</div>
          <div className="panel-s">{win === 'folio' && folio ? folio.label : `Year to date ${today.slice(0, 4)}`} · premium per $1 = sold premium ÷ what the source cost · same figures as Declara Foresight</div></div>
        <div className="fbar" style={{ margin: 0 }}>
          <select className="f" value={win} onChange={(e) => setWin(e.target.value as 'folio' | 'ytd')} aria-label="Period">
            {folio && <option value="folio">This folio</option>}<option value="ytd">Year to date</option>
          </select>
        </div>
      </div>
      <div className="panel-b" style={{ overflowX: 'auto' }}>
        {error ? <div className="empty">Couldn’t load lead sources: {String((error as Error).message || error)}</div> : !a ? <div className="empty">Adding up lead sources…</div> : !rows.length ? (
          <div className="empty">No sold policies in this period can be tied to a lead source yet.</div>
        ) : <>
          <div className="scgrid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: 14 }}>
            <div className="sccard"><div className="sccard-l">Best return</div><div className="sccard-v">{best ? best.source : '—'}</div><div className="sccard-s">{best ? `${perDollar(best.premiumPerDollar)} premium per $1 · ${best.policies} sold` : spend ? 'not enough spend or sales yet to rank' : 'record lead spend to see the return'}</div></div>
            <div className="sccard"><div className="sccard-l">Sold with a lead source</div><div className="sccard-v">{money0(sold)}</div><div className="sccard-s">{pols} policies · {pct(a.coverage)} of sold premium can be tied to a source</div></div>
            <div className="sccard"><div className="sccard-l">Lead spend on file</div><div className="sccard-v">{money0(spend)}</div><div className="sccard-s">{spend ? `${perDollar(sold && spend ? rows.filter((s) => s.spend > 0).reduce((t, s) => t + s.premium, 0) / spend : null)} premium per $1 across paid sources` : 'none recorded for this period'}</div></div>
          </div>
          <table className="dect"><thead><tr><th>Lead source</th><th className="tr">Policies sold</th><th className="tr">Sold premium</th><th className="tr">Spend</th><th className="tr">Premium per $1</th><th className="tr">Cost per policy</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.source}><td style={{ fontWeight: 600, color: 'var(--bistre)' }}>{s.source}{best === s ? ' ★' : ''}</td>
                <td className="tr mono">{s.policies}</td><td className="tr mono">{money0(s.premium)}</td>
                <td className="tr mono">{s.spend ? money0(s.spend) : <span style={{ color: 'var(--muted)' }}>no spend recorded</span>}</td>
                <td className="tr mono" style={s.premiumPerDollar != null ? { fontWeight: 700, color: best === s ? '#1F7A4D' : undefined } : undefined}>{perDollar(s.premiumPerDollar)}</td>
                <td className="tr mono">{s.spend && s.policies ? money0(s.spend / s.policies) : '—'}</td></tr>
            ))}</tbody>
          </table>
          {a.unattributedPremium > 0 && <p className="note" style={{ marginTop: 10 }}>{money0(a.unattributedPremium)} of sold premium in this period has no lead source in AgencyZoom, so it isn’t counted above.</p>}
          {!spend && <p className="note" style={{ marginTop: 10 }}>No lead spend is recorded for this period, so the return can’t be worked out yet. <a href="#" onClick={(e) => { e.preventDefault(); nav('/foresight') }}>Record what each source cost on Declara Foresight</a> and it shows here.</p>}
        </>}
      </div>
    </div>
  )
}
