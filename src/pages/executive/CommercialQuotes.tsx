// Executive Dashboard (owner): the Top 10 opportunities — accounts at risk of being lost first (service work), then the
// biggest open commercial quotes in the AgencyZoom quoted pipeline (producer work) to make ten.
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { bookTab, getAccounts, getBookPolicies } from '../../lib/books'
import { WINDOW_DAYS, ago, atRisk, commercialQuotes, us } from '../../lib/opportunities'
import { useAsync } from '../../lib/useAsync'
import type { PerfData } from '../../lib/perf/data'
import { money0 } from '../../lib/perf/executive'
import { todayPacific } from '../../lib/format'

/** The owner's Top 10 opportunities: every at-risk account first (service work, so the owner sees what the service
 *  person must save), then the biggest open commercial quotes (producer work) to make ten. It changes as risks are
 *  fixed: two red alerts → 2 saves + 8 quotes; all fixed → 10 quotes. */
export default function TopOpportunities({ D }: { D: PerfData }) {
  const go = useNavigate()
  const asOf = todayPacific()
  const q = useMemo(() => commercialQuotes(D, asOf), [D, asOf])
  const book = useAsync(async () => { const [a, p] = await Promise.all([getAccounts(), getBookPolicies()]); return atRisk(a, p, asOf) }, [asOf])
  // commercial accounts lead the ten; personal-lines saves are counted below it (they're the service team's list too)
  const all = book.data || []
  const risks = all.filter((r) => /commercial/.test(r.account.book)), personal = all.filter((r) => !/commercial/.test(r.account.book))
  const top = [...risks.slice(0, 10).map((r) => ({ kind: 'risk' as const, r })), ...q.top.map((l) => ({ kind: 'quote' as const, l }))].slice(0, 10)
  const nRisk = top.filter((x) => x.kind === 'risk').length
  return (
    <div className="panel">
      <div className="panel-h"><div>
        <div className="panel-t">Top 10 opportunities</div>
        <div className="panel-s">{book.data ? <>{nRisk ? <><b>{nRisk} at-risk commercial polic{nRisk === 1 ? 'y' : 'ies'} to save</b> (service){risks.length > nRisk ? ` of ${risks.length}` : ''}, then </> : 'No accounts at risk — '}the biggest open commercial quotes from the AgencyZoom pipeline (producers) · {q.count} open quotes, {money0(q.total)} quoted since {us(q.from)}</> : 'Checking the book for accounts at risk…'}</div>
      </div></div>
      <div className="panel-b" style={{ overflowX: 'auto' }}>
        {!top.length ? <div className="empty">Nothing at risk and no open commercial quotes from the last {WINDOW_DAYS} days.</div> : (
          <table className="dect"><thead><tr><th>#</th><th>Type</th><th>Client</th><th>What</th><th className="tr">Premium</th><th>Who works it</th><th>Since</th></tr></thead>
            <tbody>{top.map((x, i) => x.kind === 'risk' ? (
              <tr key={'r' + x.r.policy.id} className="opp-risk">
                <td className="mono">{i + 1}</td>
                <td><span className="opp-tag opp-tag-risk">At risk · service</span></td>
                <td style={{ fontWeight: 700 }}><a href="#" onClick={(e) => { e.preventDefault(); go(`/books/${bookTab(x.r.account.book)}?open=${encodeURIComponent(x.r.account.id)}`) }} style={{ color: 'inherit' }}>{x.r.account.name}</a></td>
                <td>{x.r.policy.product || 'Policy'}{x.r.policy.location ? ` · ${String(x.r.policy.location).split(' · ')[0]}` : ''}<div style={{ color: '#C0392B', fontWeight: 700, fontSize: 12 }}>{x.r.issue}</div></td>
                <td className="tr mono" style={{ fontWeight: 700 }}>{x.r.premium ? money0(x.r.premium) : '—'}</td>
                <td>Service{x.r.account.producer ? ` · ${x.r.account.producer}` : ''}</td>
                <td>{x.r.policy.expiration ? us(x.r.policy.expiration) : '—'}</td>
              </tr>
            ) : (() => { const l = x.l, d = ago(l.quoteDay, asOf); return (
              <tr key={'q' + String(l.leadId || l.name)}>
                <td className="mono">{i + 1}</td>
                <td><span className="opp-tag opp-tag-quote">Quote · producer</span></td>
                <td style={{ fontWeight: 700 }}>{l.url ? <a href={l.url} target="_blank" rel="noopener" style={{ color: 'inherit' }}>{l.name}</a> : l.name}</td>
                <td>{l.lines || '—'}{l.carriers ? <div style={{ color: 'var(--muted)', fontSize: 12 }}>{l.carriers}{l.leadSource ? ` · ${l.leadSource}` : ''}</div> : null}</td>
                <td className="tr mono" style={{ fontWeight: 700 }}>{money0(l.quotedPremium)}</td>
                <td>{l.producer || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{us(l.quoteDay)} <span style={{ color: d > 30 ? '#B7791F' : 'var(--muted)', fontSize: 11 }}>· {d}d ago</span></td>
              </tr>
            ) })())}</tbody>
          </table>
        )}
        {(risks.length > nRisk || personal.length > 0) && <div className="empty" style={{ marginTop: 8 }}>{[risks.length > nRisk && `${risks.length - nRisk} more commercial polic${risks.length - nRisk === 1 ? 'y' : 'ies'} at risk beyond the top 10`, personal.length > 0 && `${personal.length} personal-lines polic${personal.length === 1 ? 'y' : 'ies'} at risk (${[...new Set(personal.map((r) => r.issue.split(' ·')[0].replace(/ — .*/, '')))].slice(0, 3).join(', ')}) — ${money0(personal.reduce((t, r) => t + r.premium, 0))} of premium`].filter(Boolean).join(' · ')} — see Books of Business.</div>}
      </div>
    </div>
  )
}
