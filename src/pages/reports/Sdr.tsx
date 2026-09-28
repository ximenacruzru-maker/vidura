// Reports › SDR Transfer (engine.js renderSdrBody): each SDR's bonus for a pay period under the bonus rubric, the
// reference-only rows for SDRs not active this period, the year to date, and the transfer log, with Excel and CSV files.
import type { Json, PerfData } from '../../lib/perf/data'
import { money0 } from '../../lib/perf/executive'
import { SDR_ORDER, sdrData, sdrDefaultMonth, sdrDownloadCsv, sdrDownloadCsvAll, sdrDownloadExcel } from '../../lib/perf/sdr'
import { ICO } from '../executive/parts'

const note = { fontSize: 12, color: 'var(--beaver)', background: 'var(--paper)', borderLeft: '3px solid var(--gold)', padding: '12px 14px', lineHeight: 1.6 } as const
const ZERO = { totalLogged: 0, qualifiedTransfers: 0, boundPolicies: 0, totalBonus: 0 }

export function Sdr({ D, month, setMonth, agency }: { D: PerfData; month: string | null; setMonth: (m: string) => void; agency: string }) {
  const sd = sdrData(D)
  const months = Object.keys(sd.byMonth).sort().reverse()
  const m = month && sd.byMonth[month] ? month : sdrDefaultMonth(D)
  const pm: Json = sd.byMonth[m] || { meta: {} }, meta: Json = pm.meta || {}
  const names = SDR_ORDER.filter((n) => pm[n]).concat(Object.keys(pm).filter((n) => n !== 'meta' && !SDR_ORDER.includes(n)))
  const log: Json[] = sd.transfers.filter((t: Json) => t.month === m)
  const active: string[] = sd.activeSdrs || []
  const on = names.filter((n) => active.includes(n)), off = names.filter((n) => !active.includes(n))
  const qb = meta.qualifiedTransferBonus || sd.qualifiedTransferBonus || 15, bb = meta.boundPolicyBonus || sd.boundPolicyBonus || 35
  const sum = (list: string[], k: string) => list.reduce((t, n) => t + (Number((pm[n] || {})[k]) || 0), 0)
  const logged = sum(on, 'totalLogged'), qual = sum(on, 'qualifiedTransfers'), qBonus = sum(on, 'qualifiedBonus'), bound = sum(on, 'boundPolicies')
  const bPrem = sum(on, 'boundPremium'), bBonus = sum(on, 'boundBonus'), total = sum(on, 'totalBonus')
  const ytd: Record<string, typeof ZERO> = {}
  Object.values(sd.byMonth).forEach((p: any) => Object.entries(p).forEach(([n, x]: [string, any]) => {
    if (n === 'meta') return
    const a = (ytd[n] = ytd[n] || { ...ZERO })
    a.totalLogged += x.totalLogged; a.qualifiedTransfers += x.qualifiedTransfers; a.boundPolicies += x.boundPolicies; a.totalBonus += x.totalBonus
  }))
  const cells = (x: Json) => <>
    <td className="tr mono">{x.totalLogged}</td><td className="tr mono">{x.qualifiedTransfers}</td><td className="tr mono">{money0(x.qualifiedBonus)}</td>
    <td className="tr mono">{x.boundPolicies}</td><td className="tr mono">{money0(x.boundPremium || 0)}</td><td className="tr mono">{money0(x.boundBonus)}</td>
  </>
  const head = <><th>SDR</th><th className="tr">Transfers Logged</th><th className="tr">Qualified Transfers</th><th className="tr">Qualified Bonus</th><th className="tr">Bound Policies</th><th className="tr">Bound Premium</th><th className="tr">Bound Bonus</th><th className="tr">Total Bonus</th></>

  return <>
    <div className="panel"><div className="panel-b">
      <p style={{ ...note, margin: '0 0 10px', fontWeight: 700 }}>SDRs are paid one month in arrears — bonuses for transfers logged this month are payable on {meta.payDateLabel || 'the 21st of the following month'}, not before. The current pay period is a live running total for tracking qualification progress; payroll runs once the period closes.</p>
      <p style={{ ...note, margin: '0 0 14px' }}><strong>SDR Performance Bonus Rubric.</strong> Qualified Transfer {money0(qb)} each · Bound Policy {money0(bb)} each — {sd.rule || ''} Pulled from AgencyZoom {sd.pulledAt || ''} (leads carrying the {Object.values(sd.tags || {}).join(' / ')} tags, with their quote records). <strong>Active SDR{active.length === 1 ? '' : 's'}:</strong> {active.join(', ') || '—'}{off.length ? '; ' + off.join(', ') + ' shown below for reference only.' : '.'}</p>
      <div className="fbar">
        <div className="fb-g"><label className="fl">Pay period (transfer month)</label>
          <select className="f" value={m} onChange={(e) => setMonth(e.target.value)}>
            {months.map((x) => <option key={x} value={x}>{(sd.byMonth[x].meta || {}).periodLabel || x} → paid {(sd.byMonth[x].meta || {}).payDateLabel || ''}</option>)}
          </select></div>
        <button className="hd-kai" style={{ height: 42, fontSize: 13 }} onClick={() => sdrDownloadExcel(D, agency, m, null)}>{ICO.doc}<span>Download Excel (all SDRs, one sheet)</span></button>
        <button className="mc-btn" style={{ height: 42 }} onClick={() => sdrDownloadCsvAll(D, m)}>CSV (all SDRs)</button>
      </div>
    </div></div>
    <div className="scgrid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
      <div className="sccard"><div className="sccard-l">Total Bonus Owed</div><div className="sccard-v">{money0(total)}</div><div className="sccard-s">payable per the SDR bonus rubric</div></div>
      <div className="sccard"><div className="sccard-l">Qualified Transfers</div><div className="sccard-v">{qual} of {logged}</div><div className="sccard-s">{meta.periodLabel || m}</div></div>
      <div className="sccard"><div className="sccard-l">Bound Premium</div><div className="sccard-v">{money0(bPrem)}</div><div className="sccard-s">{bound} bound polic{bound === 1 ? 'y' : 'ies'}, this period{meta.closed ? '' : ' · still open, running total'}</div></div>
    </div>
    <div className="panel">
      <div className="panel-h"><div><div className="panel-t">Detailed Calculation</div><div className="panel-s">{meta.periodLabel || m} · every column follows the SDR bonus rubric in force this period</div></div></div>
      <div className="panel-b" style={{ overflowX: 'auto' }}>
        <table className="dect"><thead><tr>{head}<th>Files</th></tr></thead>
          <tbody>
            {on.map((n) => (
              <tr key={n}><td style={{ fontWeight: 600, color: 'var(--bistre)' }}>{n}</td>{cells(pm[n])}
                <td className="tr mono" style={{ fontWeight: 700 }}>{money0(pm[n].totalBonus)}</td>
                <td style={{ whiteSpace: 'nowrap' }}><button className="doc-dl" onClick={() => sdrDownloadExcel(D, agency, m, n)}>{ICO.doc}<span>Excel</span></button>{' '}
                  <button className="doc-dl" onClick={() => sdrDownloadCsv(D, n, m)}>CSV</button></td></tr>
            ))}
            <tr style={{ fontWeight: 700, borderTop: '2px solid var(--line)' }}><td>TOTAL</td><td className="tr mono">{logged}</td><td className="tr mono">{qual}</td><td className="tr mono">{money0(qBonus)}</td>
              <td className="tr mono">{bound}</td><td className="tr mono">{money0(bPrem)}</td><td className="tr mono">{money0(bBonus)}</td><td className="tr mono">{money0(total)}</td><td /></tr>
          </tbody>
        </table>
      </div>
    </div>
    {off.length > 0 && (
      <div className="panel">
        <div className="panel-h"><div><div className="panel-t">Reference only</div><div className="panel-s">Not an active SDR this period — shown for continuity, not included in the totals above</div></div></div>
        <div className="panel-b" style={{ overflowX: 'auto' }}>
          <table className="dect"><thead><tr>{head}</tr></thead>
            <tbody>{off.map((n) => <tr key={n} style={{ color: 'var(--muted)' }}><td>{n}</td>{cells(pm[n])}<td className="tr mono">{money0(pm[n].totalBonus)}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    )}
    <div className="panel">
      <div className="panel-h"><div><div className="panel-t">Year to date</div><div className="panel-s">All pay periods on file</div></div></div>
      <div className="panel-b" style={{ overflowX: 'auto' }}>
        <table className="dect">
          <thead><tr><th>Month</th>{names.map((n) => [
            <th key={n + 't'} className="tr">{n} transfers</th>, <th key={n + 'q'} className="tr">{n} qualified</th>, <th key={n + 'b'} className="tr">{n} bound</th>, <th key={n + '$'} className="tr">{n} bonus</th>])}<th>Paid</th></tr></thead>
          <tbody>
            {months.map((x) => {
              const p = sd.byMonth[x]
              return (
                <tr key={x} style={x === m ? { background: 'var(--paper)', fontWeight: 700 } : undefined}>
                  <td><a href="#" onClick={(e) => { e.preventDefault(); setMonth(x) }} style={{ color: 'var(--bistre)', fontWeight: 600 }}>{(p.meta || {}).periodLabel || x}</a></td>
                  {names.map((n) => { const c = p[n] || ZERO; return [
                    <td key={n + 't'} className="tr mono">{c.totalLogged}</td>, <td key={n + 'q'} className="tr mono">{c.qualifiedTransfers}</td>,
                    <td key={n + 'b'} className="tr mono">{c.boundPolicies}</td>, <td key={n + '$'} className="tr mono">{money0(c.totalBonus)}</td>] })}
                  <td>{(p.meta || {}).payDateLabel || ''}</td>
                </tr>
              )
            })}
            <tr><td style={{ fontWeight: 700, color: 'var(--bistre)' }}>Total</td>
              {names.map((n) => { const c: Json = ytd[n] || {}; const b = { fontWeight: 700 }; return [
                <td key={n + 't'} className="tr mono" style={b}>{c.totalLogged || 0}</td>, <td key={n + 'q'} className="tr mono" style={b}>{c.qualifiedTransfers || 0}</td>,
                <td key={n + 'b'} className="tr mono" style={b}>{c.boundPolicies || 0}</td>, <td key={n + '$'} className="tr mono" style={b}>{money0(c.totalBonus || 0)}</td>] })}
              <td /></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div className="panel">
      <div className="panel-h"><div><div className="panel-t">Transfer Log — {meta.periodLabel || m}</div><div className="panel-s">{log.length} tagged leads, most recent first · quote numbers are AgencyZoom quote IDs · click a name to open the lead</div></div></div>
      <div className="panel-b" style={{ overflowX: 'auto', maxHeight: 560, overflowY: 'auto' }}>
        <table className="dect"><thead><tr><th>Date</th><th>SDR</th><th>Client</th><th>Producer</th><th>Source</th><th>Quote #</th><th className="tr">Quoted</th><th>AZ status</th><th>Outcome</th><th className="tr">Qualifies</th></tr></thead>
          <tbody>{log.map((t, i) => (
            <tr key={i}>
              <td className="mono">{t.dateTime || ''}</td><td>{t.sdr || ''}</td>
              <td style={{ fontWeight: 600, color: 'var(--bistre)' }}><a href={t.url || '#'} target="_blank" rel="noopener" style={{ color: 'inherit' }}>{t.client || ''}</a></td>
              <td>{t.producer || ''}</td><td>{t.leadSource || ''}</td>
              <td className="mono" style={{ fontSize: '10.5px' }}>{(t.quoteIds || []).join(', ') || '—'}</td>
              <td className="tr mono">{t.azQuotePremium ? money0(t.azQuotePremium) : '—'}</td>
              <td>{t.status || ''}{t.stage ? ' · ' + t.stage : ''}{t.lossReason && <> <span style={{ color: 'var(--muted)', fontSize: '10.5px' }}>({t.lossReason})</span></>}</td>
              <td>{t.bound ? <span style={{ color: '#1F7A4D', fontWeight: 700 }}>Bound{t.boundViaLedger ? ' (ledger)' : ''} {money0(t.boundPremium || 0)}</span> : t.outcome || '—'}</td>
              <td className="tr">{t.azQualifies ? <span style={{ color: '#1F7A4D', fontWeight: 700 }}>Yes</span> : <span style={{ color: 'var(--muted)' }}>No</span>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  </>
}
