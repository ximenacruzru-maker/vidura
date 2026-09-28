// Reports › Commissions (engine.js renderCommissionsBody + reconSection): what each producer is owed for a folio
// under the plan in force on its first day, with the Excel / PDF / CSV files, and the carrier-statement check that
// holds back sales the carrier never paid on.
import { useState } from 'react'
import { commRecalc, reconExcluded, reconSave, reconStore } from '../../lib/perf/commission'
import {
  commDisplayBuckets, commPlanSummary, downloadCommissionCsv, downloadCommissionExcel, printCommissionStatements,
  reconAggregate, reconMatch, reconParse, reconReadFile,
} from '../../lib/perf/commissionFiles'
import { wbFolioKeys, type Json, type PerfData } from '../../lib/perf/data'
import { money0 } from '../../lib/perf/executive'
import { wbFolioLabel } from '../../lib/perf/reports'
import { ICO } from '../executive/parts'

const note = { fontSize: 12, color: 'var(--beaver)', background: 'var(--paper)', borderLeft: '3px solid var(--gold)', padding: '12px 14px', lineHeight: 1.6 } as const

export function Commissions({ D, folio, setFolio, agency, agencyShort }: { D: PerfData; folio: string | null; setFolio: (k: string) => void; agency: string; agencyShort: string }) {
  const [, bump] = useState(0)
  const [msg, setMsg] = useState('')
  const keys = wbFolioKeys(D)
  const k = folio && D.WB_DATA.folio[folio] ? folio : keys[0]
  const r = D.COMM_RESULTS[k] || { plan: D.COMM_SEED, results: {} }
  const plan = r.plan
  const legacy = Object.entries((D.WB_DATA.commissionsByFolio || {})[k] || {}).sort((a: any, b: any) => b[1].totalCommission - a[1].totalCommission) as [string, Json][]
  const owed = legacy.reduce((t, [, x]) => t + x.totalCommission, 0)
  const prem = legacy.reduce((t, [, x]) => t + x.totalPremium, 0)
  const qualified = legacy.filter(([, x]) => x.qualifies).length
  const excluded = reconExcluded(k).size
  const bks = commDisplayBuckets(plan)
  const results = (Object.values(r.results) as Json[]).sort((a, b) => b.total - a.total)
  const bonuses: Json[] = plan.bonuses || []
  const refresh = () => { commRecalc(D); bump((n) => n + 1) }

  return <>
    <div className="panel"><div className="panel-b">
      <p style={{ ...note, margin: '0 0 10px', fontWeight: 700 }}>Producers are paid on the previous, fully-closed folio's results — not the in-progress current folio shown by default. The current folio is a live running total for tracking qualification progress; payroll runs once the folio closes.</p>
      <p style={{ ...note, margin: '0 0 14px' }}><strong>{plan.name} (v{plan.version}, effective {plan.effectiveFrom}).</strong> {commPlanSummary(D, plan)} <a className="cm-link" href="#/commission-setup">Commission Setup ›</a></p>
      <div className="fbar">
        <div className="fb-g"><label className="fl">Folio</label>
          <select className="f" value={k} onChange={(e) => setFolio(e.target.value)}>{keys.map((x) => <option key={x} value={x}>{wbFolioLabel(D, x)}</option>)}</select></div>
        <button className="hd-kai" style={{ height: 42, fontSize: 13 }} onClick={() => downloadCommissionExcel(D, k)}>{ICO.doc}<span>Download Excel (all producers)</span></button>
        <button className="mc-btn" style={{ height: 42 }} onClick={() => printCommissionStatements(D, k, agency)}>Print statements (PDF)</button>
        <button className="mc-btn" style={{ height: 42 }} onClick={() => downloadCommissionCsv(D, k, agencyShort)}>CSV</button>
        {excluded > 0 && <span className="status risk" style={{ marginLeft: 'auto' }}>{excluded} sale{excluded === 1 ? '' : 's'} excluded after carrier reconciliation</span>}
      </div>
    </div></div>
    <div className="scgrid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
      <div className="sccard"><div className="sccard-l">Total Commission Owed</div><div className="sccard-v">{money0(owed)}</div><div className="sccard-s">payable per {plan.name}</div></div>
      <div className="sccard"><div className="sccard-l">Producers Qualified</div><div className="sccard-v">{qualified} of {legacy.length}</div><div className="sccard-s">this folio</div></div>
      <div className="sccard"><div className="sccard-l">Total Premium</div><div className="sccard-v">{money0(prem)}</div><div className="sccard-s">confirmed{excluded ? ' · after exclusions' : ''}, this folio</div></div>
    </div>
    <div className="panel">
      <div className="panel-h"><div><div className="panel-t">Detailed Calculation</div><div className="panel-s">{wbFolioLabel(D, k)} · every column follows the plan in force on the folio’s first day</div></div></div>
      <div className="panel-b" style={{ overflowX: 'auto' }}>
        <table className="dect">
          <thead><tr><th>Producer</th><th className="tr">Total Premium</th><th className="tr">Life</th><th className="tr">Qualifies?</th><th className="tr">Tier</th>
            {bks.map((b) => <th key={'p' + b.key} className="tr">{b.label} prem</th>)}
            {bks.map((b) => <th key={'c' + b.key} className="tr">Comm {b.label}</th>)}
            {bonuses.map((b) => <th key={'b' + b.key} className="tr">{b.label}</th>)}
            <th className="tr">Total Comm</th><th>Files</th></tr></thead>
          <tbody>
            {results.map((x) => (
              <tr key={x.producer}>
                <td style={{ fontWeight: 600, color: 'var(--bistre)' }}>{x.producer}</td>
                <td className="tr mono">{money0(x.totalPremium)}</td><td className="tr mono">{x.life}</td>
                <td className="tr">{x.qualifies ? <span style={{ color: '#1F7A4D', fontWeight: 700 }}>Yes — {(100 * x.tierRate).toFixed(0)}%</span> : <span style={{ color: 'var(--muted)' }}>Not qualified</span>}</td>
                <td className="tr mono">{x.qualifies ? (100 * x.tierRate).toFixed(0) + '%' : '—'}</td>
                {bks.map((b) => <td key={'p' + b.key} className="tr mono">{money0(x.buckets[b.key].premium)}</td>)}
                {bks.map((b) => <td key={'c' + b.key} className="tr mono">{money0(x.buckets[b.key].commission)}</td>)}
                {bonuses.map((b) => <td key={'b' + b.key} className="tr mono">{money0(x.bonuses[b.key] || 0)}</td>)}
                <td className="tr mono" style={{ fontWeight: 700 }}>{money0(x.total)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="doc-dl" onClick={() => downloadCommissionExcel(D, k, x.producer)}>{ICO.doc}<span>Excel</span></button>{' '}
                  <button className="doc-dl" onClick={() => printCommissionStatements(D, k, agency, x.producer)}>PDF</button>
                </td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700, borderTop: '2px solid var(--line)' }}>
              <td>TOTAL</td><td className="tr mono">{money0(prem)}</td><td className="tr mono">{legacy.reduce((t, [, x]) => t + x.lifePolicies, 0)}</td>
              <td className="tr">{qualified} of {legacy.length}</td><td className="tr">—</td>
              {bks.map((b) => <td key={'p' + b.key} className="tr mono">{money0(results.reduce((t, x) => t + x.buckets[b.key].premium, 0))}</td>)}
              {bks.map((b) => <td key={'c' + b.key} className="tr mono">{money0(results.reduce((t, x) => t + x.buckets[b.key].commission, 0))}</td>)}
              {bonuses.map((b) => <td key={'b' + b.key} className="tr mono">{money0(results.reduce((t, x) => t + (x.bonuses[b.key] || 0), 0))}</td>)}
              <td className="tr mono">{money0(owed)}</td><td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <Recon D={D} k={k} msg={msg} setMsg={setMsg} onChange={refresh} />
  </>
}

const ORDER: Record<string, number> = { cancelled: 0, nonrenewal: 0, missing: 1, matched: 2 }

function Recon({ D, k, msg, setMsg, onChange }: { D: PerfData; k: string; msg: string; setMsg: (m: string) => void; onChange: () => void }) {
  const t: Json | null = reconStore()[k] || null
  const ex = reconExcluded(k)
  const upload = async (input: HTMLInputElement) => {
    const file = input.files && input.files[0]
    if (!file) return
    try {
      setMsg('Reading ' + file.name + '…')
      const rows = reconParse(await reconReadFile(file))
      if (!rows.length) { setMsg('No policy rows could be read from that file. Try the CSV or Excel export of the statement.'); return }
      const agg = reconAggregate(rows)
      setMsg('Matching ' + rows.length + ' statement rows (' + agg.length + ' policies) against AgencyZoom…')
      const m = reconMatch(D, k, agg), store = reconStore(), old = store[k] || {}, decisions: Record<string, string> = { ...(old.decisions || {}) }
      m.results.forEach((x) => { if (decisions[x.id] == null && x.suggest === 'exclude') decisions[x.id] = 'exclude' })
      store[k] = {
        fileName: file.name, uploadedAt: new Date().toISOString(), rowsRead: rows.length,
        matches: m.results.map((x) => ({ id: x.id, client: x.row.client, line: x.row.line, premium: x.row.premium, producer: x.row.producer,
          stmt: x.stmt ? { insured: x.stmt.insured, policy: x.stmt.policy, premium: x.stmt.premium, commission: x.stmt.commission, status: x.stmt.status } : null,
          score: x.score, state: x.state, suggest: x.suggest })),
        extra: m.extra.slice(0, 200), decisions,
      }
      reconSave(store)
      setMsg('Done — ' + m.results.filter((x) => x.state === 'matched').length + ' matched, ' + m.results.filter((x) => x.state === 'cancelled' || x.state === 'nonrenewal').length +
        ' flagged by the carrier, ' + m.results.filter((x) => x.state === 'missing').length + ' not on the statement.')
      onChange()
    } catch (e: any) { setMsg('Could not read the statement: ' + (e?.message || e)) }
    input.value = ''
  }
  const decide = (id: string, v: string) => {
    const s = reconStore(); if (!s[k]) return
    if (v === 'auto') delete s[k].decisions[id]; else s[k].decisions[id] = v
    reconSave(s); onChange()
  }
  const clear = () => {
    if (!confirm('Remove the uploaded statement and all exclusions for this folio?')) return
    const s = reconStore(); delete s[k]; reconSave(s); onChange()
  }
  const decision = (x: Json) => (t!.decisions[x.id] || (x.suggest === 'exclude' ? 'exclude' : 'include'))

  return (
    <div className="panel">
      <div className="panel-h">
        <div><div className="panel-t">Carrier statement reconciliation</div>
          <div className="panel-s">{t ? <>Statement <b>{t.fileName}</b> · {t.rowsRead} rows read · uploaded {t.uploadedAt.slice(0, 10)} · {ex.size} sale{ex.size === 1 ? '' : 's'} excluded from pay</>
            : 'Upload the carrier’s commission statement (eFolio export: CSV, Excel or PDF) for ' + wbFolioLabel(D, k) + ' to check every AgencyZoom sale was actually paid on before producers are paid.'}</div></div>
        <div className="dr-btns" style={{ margin: 0 }}>
          <label className="brief-s" style={{ cursor: 'pointer' }}>Upload statement<input type="file" accept=".csv,.xlsx,.xls,.pdf" style={{ display: 'none' }} onChange={(e) => upload(e.target)} /></label>
          {t && <button className="brief-s" onClick={clear}>Remove</button>}
        </div>
      </div>
      <div className="panel-b">
        <div id="rcStatus" className="cm-status">{msg}</div>
        {!t ? <p className="an-fn" style={{ margin: 0 }}>Without a statement every confirmed AgencyZoom sale is paid. With one, cancellations, chargebacks and policies that never issued are flagged and excluded automatically — you can override any row.</p> : <>
          <div className="scgrid" style={{ gridTemplateColumns: 'repeat(4,1fr)', margin: '6px 0 12px' }}>
            <div className="sccard"><div className="sccard-l">Matched &amp; paid</div><div className="sccard-v">{t.matches.filter((x: Json) => x.state === 'matched').length}</div><div className="sccard-s">of {t.matches.length} AgencyZoom sales</div></div>
            <div className="sccard"><div className="sccard-l">Cancelled / chargeback</div><div className="sccard-v">{t.matches.filter((x: Json) => x.state === 'cancelled' || x.state === 'nonrenewal').length}</div><div className="sccard-s">flagged by the statement</div></div>
            <div className="sccard"><div className="sccard-l">Not on statement</div><div className="sccard-v">{t.matches.filter((x: Json) => x.state === 'missing').length}</div><div className="sccard-s">decide before paying</div></div>
            <div className="sccard"><div className="sccard-l">Excluded from pay</div><div className="sccard-v">{money0(t.matches.filter((x: Json) => decision(x) === 'exclude').reduce((s: number, x: Json) => s + (x.premium || 0), 0))}</div><div className="sccard-s">{ex.size} sales held back</div></div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="dect"><thead><tr><th>AgencyZoom sale</th><th>Producer</th><th className="tr">Premium</th><th>On statement</th><th>Carrier status</th><th>Decision</th></tr></thead>
              <tbody>{t.matches.slice().sort((a: Json, b: Json) => ORDER[a.state] - ORDER[b.state]).map((x: Json) => (
                <tr key={x.id} style={decision(x) === 'exclude' ? { background: '#fff5f5' } : undefined}>
                  <td><strong>{x.client}</strong><div className="wk-note">{x.line}</div></td><td>{x.producer}</td><td className="tr mono">{money0(x.premium || 0)}</td>
                  <td style={{ fontSize: 11 }}>{x.stmt ? <>{x.stmt.insured}{x.stmt.policy ? ' · ' + x.stmt.policy : ''}{x.stmt.commission != null ? ' · comm ' + money0(x.stmt.commission) : ''} <span style={{ color: 'var(--muted)' }}>({Math.round(100 * x.score)}% match)</span></> : <span className="status warn">Not found</span>}</td>
                  <td><span className={'status ' + (x.state === 'matched' ? 'good' : x.state === 'missing' ? 'warn' : 'risk')}>{x.state === 'matched' ? 'Paid' : x.state === 'missing' ? 'Missing' : (x.stmt && x.stmt.status) || 'Cancelled'}</span></td>
                  <td><select className="f wk-st" value={t.decisions[x.id] == null ? 'auto' : t.decisions[x.id]} onChange={(e) => decide(x.id, e.target.value)}>
                    <option value="auto">Auto ({x.suggest === 'exclude' ? 'exclude' : 'pay'})</option><option value="include">Pay</option><option value="exclude">Exclude</option>
                  </select></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {t.extra.length > 0 && (
            <details className="today-done" style={{ marginTop: 12 }}>
              <summary>{t.extra.length} statement rows with no AgencyZoom sale this folio ›</summary>
              <table className="dect" style={{ marginTop: 8 }}><thead><tr><th>Insured</th><th>Policy</th><th className="tr">Premium</th><th className="tr">Commission</th><th>Status</th></tr></thead>
                <tbody>{t.extra.slice(0, 60).map((x: Json, i: number) => (
                  <tr key={i}><td>{x.insured}</td><td className="mono">{x.policy}</td><td className="tr mono">{x.premium != null ? money0(x.premium) : '—'}</td>
                    <td className="tr mono">{x.commission != null ? money0(x.commission) : '—'}</td><td>{x.status}</td></tr>
                ))}</tbody>
              </table>
              <p className="an-fn">Usually renewals, prior-folio business or policies AgencyZoom has under another name.</p>
            </details>
          )}
        </>}
      </div>
    </div>
  )
}
