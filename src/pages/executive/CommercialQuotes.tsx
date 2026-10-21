// Executive Dashboard (owner): the ten biggest open commercial quotes in the AgencyZoom quoted pipeline — the
// business deals worth chasing first. From the same quote_leads sync as the Daily Huddle and Reports › Daily.
import { useMemo } from 'react'
import type { Json, PerfData } from '../../lib/perf/data'
import { money0 } from '../../lib/perf/executive'
import { todayPacific } from '../../lib/format'

/** A commercial line on the lead or on any of its quotes (BOP, GL, property, workers' comp, commercial auto…). */
const COMMERCIAL = /commercial|\bbop\b|business ?owners|\bgl\b|general liab|workers|work ?comp|\bwc\b|garage|contractor|liquor|cyber|\bepli\b|inland marine|surety|bond/i
const WINDOW_DAYS = 90
const ago = (iso: string, to: string) => Math.max(0, Math.round((Date.parse(to) - Date.parse(iso)) / 86400000))
const us = (iso: string) => iso.slice(5, 7) + '/' + iso.slice(8, 10) + '/' + iso.slice(0, 4)

export function commercialQuotes(D: PerfData, asOf = todayPacific()) {
  const byDay: Record<string, Json> = D.WB_EXTRA?.quotes?.byDay || {}
  const from = new Date(Date.parse(asOf) - WINDOW_DAYS * 86400000).toISOString().slice(0, 10)
  const seen = new Set<string>()
  const open: Json[] = []
  Object.keys(byDay).sort().reverse().forEach((day) => (byDay[day].leads || []).forEach((l: Json) => {
    const key = String(l.leadId || l.name)
    if (seen.has(key)) return
    seen.add(key)
    const quotes: Json[] = l.quotes || []
    const lines = [l.lines || '', ...quotes.map((q) => q.product || '')].join(' ')
    if (!COMMERCIAL.test(lines) || quotes.some((q) => q.sold === true) || !l.quotedPremium) return
    if ((l.quoteDay || day) < from) return
    open.push({ ...l, quoteDay: l.quoteDay || day, carriers: [...new Set(quotes.map((q) => q.carrier).filter(Boolean))].join(', ') })
  }))
  open.sort((a, b) => b.quotedPremium - a.quotedPremium)
  const total = open.reduce((t, l) => t + l.quotedPremium, 0)
  return { top: open.slice(0, 10), count: open.length, total, from }
}

export default function CommercialQuotes({ D }: { D: PerfData }) {
  const asOf = todayPacific()
  const x = useMemo(() => commercialQuotes(D, asOf), [D, asOf])
  const topSum = x.top.reduce((t, l) => t + l.quotedPremium, 0)
  return (
    <div className="panel">
      <div className="panel-h"><div>
        <div className="panel-t">Top 10 commercial quote opportunities</div>
        <div className="panel-s">Open commercial quotes in the AgencyZoom quoted pipeline, biggest first · quoted since {us(x.from)} · {x.count} open, {money0(x.total)} quoted{x.top.length ? ` · these ${x.top.length} are ${money0(topSum)}` : ''}</div>
      </div></div>
      <div className="panel-b" style={{ overflowX: 'auto' }}>
        {!x.top.length ? <div className="empty">No open commercial quotes in the pipeline from the last {WINDOW_DAYS} days.</div> : (
          <table className="dect"><thead><tr><th>#</th><th>Client</th><th>Lines</th><th>Carrier</th><th className="tr">Quoted</th><th>Producer</th><th>Lead source</th><th>Quoted on</th></tr></thead>
            <tbody>{x.top.map((l, i) => {
              const d = ago(l.quoteDay, asOf)
              return (
                <tr key={String(l.leadId || l.name)}>
                  <td className="mono">{i + 1}</td>
                  <td style={{ fontWeight: 700, color: 'var(--bistre)' }}>{l.url ? <a href={l.url} target="_blank" rel="noopener" style={{ color: 'inherit' }}>{l.name}</a> : l.name}</td>
                  <td>{l.lines || '—'}</td><td>{l.carriers || '—'}</td>
                  <td className="tr mono" style={{ fontWeight: 700 }}>{money0(l.quotedPremium)}</td>
                  <td>{l.producer || '—'}</td><td>{l.leadSource || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{us(l.quoteDay)} <span style={{ color: d > 30 ? '#B7791F' : 'var(--muted)', fontSize: 11 }}>· {d}d ago</span></td>
                </tr>
              )
            })}</tbody>
          </table>
        )}
      </div>
    </div>
  )
}
