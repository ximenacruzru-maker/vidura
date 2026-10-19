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
    <CloseRates transfers={sd.transfers} month={m} label={meta.periodLabel || m} />
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

type Close = { name: string; transfers: number; quoted: number; sold: number; premium: number }
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0)
function closeBy(list: Json[], key: (t: Json) => string): Close[] {
  const m = new Map<string, Close>()
  for (const t of list) {
    const k = key(t) || 'Unassigned'
    const o = m.get(k) || { name: k, transfers: 0, quoted: 0, sold: 0, premium: 0 }
    o.transfers++; if (t.azQualifies) o.quoted++; if (t.bound) { o.sold++; o.premium += Number(t.boundPremium) || 0 }
    m.set(k, o)
  }
  return [...m.values()].sort((a, b) => b.sold / (b.transfers || 1) - a.sold / (a.transfers || 1) || b.transfers - a.transfers)
}
// best closer: highest close rate among those with at least 3 transfers (so 1 of 1 doesn't win)
const bestOf = (rows: Close[]) => rows.find((r) => r.name !== 'Unassigned' && r.transfers >= 3 && r.sold > 0)

/** Transfer → sale close rate: of the transfers each producer received (and each SDR sent), how many were sold —
 *  for the pay period picked above and for every period on file. Shows who closes SDR transfers best. */
function CloseRates({ transfers, month, label }: { transfers: Json[]; month: string; label: string }) {
  const mine = transfers.filter((t) => t.month === month)
  const sets = [
    { title: 'By producer — transfers received', who: 'Producer', mo: closeBy(mine, (t) => t.producer), all: closeBy(transfers, (t) => t.producer) },
    { title: 'By SDR — transfers sent', who: 'SDR', mo: closeBy(mine, (t) => t.sdr), all: closeBy(transfers, (t) => t.sdr) },
  ]
  const best = bestOf(sets[0].mo), bestAll = bestOf(sets[0].all)
  const tone = (p: number) => ({ fontWeight: 700, color: p >= 20 ? '#1F7A4D' : p >= 10 ? '#B7791F' : 'var(--muted)' })
  return (
    <div className="panel">
      <div className="panel-h"><div><div className="panel-t">Transfer → sale close rate</div><div className="panel-s">{label} and all periods on file · close rate = sold ÷ transfers · best closer needs at least 3 transfers</div></div></div>
      <div className="panel-b">
        <div className="scgrid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: 14 }}>
          <div className="sccard"><div className="sccard-l">Best closer · {label}</div><div className="sccard-v">{best ? best.name : '—'}</div><div className="sccard-s">{best ? `${pct(best.sold, best.transfers)}% · ${best.sold} sold of ${best.transfers} transfers` : 'not enough transfers yet'}</div></div>
          <div className="sccard"><div className="sccard-l">Best closer · all periods</div><div className="sccard-v">{bestAll ? bestAll.name : '—'}</div><div className="sccard-s">{bestAll ? `${pct(bestAll.sold, bestAll.transfers)}% · ${bestAll.sold} sold of ${bestAll.transfers} transfers` : 'not enough transfers yet'}</div></div>
        </div>
        {sets.map((x) => (
          <div key={x.who} style={{ overflowX: 'auto', marginBottom: 14 }}>
            <div style={{ fontWeight: 700, color: 'var(--bistre)', margin: '4px 0 6px' }}>{x.title}</div>
            <table className="dect"><thead><tr><th>{x.who}</th><th className="tr">Transfers</th><th className="tr">Quoted</th><th className="tr">Sold</th><th className="tr">Close rate</th><th className="tr">Sold premium</th><th className="tr">All periods: transfers</th><th className="tr">sold</th><th className="tr">close rate</th></tr></thead>
              <tbody>{x.all.map((a) => {
                const r = x.mo.find((y) => y.name === a.name) || { name: a.name, transfers: 0, quoted: 0, sold: 0, premium: 0 }
                const p = pct(r.sold, r.transfers), pa = pct(a.sold, a.transfers)
                return (
                  <tr key={a.name}><td style={{ fontWeight: 600, color: 'var(--bistre)' }}>{a.name}{x.who === 'Producer' && best?.name === a.name ? ' ★' : ''}</td>
                    <td className="tr mono">{r.transfers}</td><td className="tr mono">{r.quoted}</td><td className="tr mono">{r.sold}</td>
                    <td className="tr mono" style={r.transfers ? tone(p) : undefined}>{r.transfers ? p + '%' : '—'}</td><td className="tr mono">{money0(r.premium)}</td>
                    <td className="tr mono">{a.transfers}</td><td className="tr mono">{a.sold}</td><td className="tr mono" style={tone(pa)}>{pa}%</td></tr>
                )
              })}</tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  )
}
