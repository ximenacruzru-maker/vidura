import { useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { useFolio, folioName } from '../components/FolioPicker'
import { Empty, ErrorBox, Loading, PageHead, Panel, Tile, Tiles } from '../components/ui'
import { getSdrPeriods, getSdrQuoteNumbers, getSdrTransfers } from '../lib/data'
import { downloadSheet } from '../lib/excelExport'
import { mdy, money2, todayPacific } from '../lib/format'
import { folioFor } from '../lib/payday'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

/** Commissions: the commission sheet for one 21st payday, for whoever runs payroll — every producer's commission for
 *  the folio that closed last month and every SDR's bonus for last month's transfers, in one spreadsheet. No hours,
 *  pay rates or salaries (those stay on Office Payroll, owners and admins only). */

interface CommRow { client: string; carrier: string; line: string; premium: number; sale_date: string; bucket: string }
interface CommBucket { key: string; label: string; premium: number; rate: number; commission: number }
interface Comm { producer: string; totalPremium: number; policies: number; qualifies: boolean; tierRate: number; total: number; rows?: CommRow[]; buckets?: Record<string, CommBucket>; bonuses?: Record<string, number>; splitShare?: number }
const pad = (n: number) => String(n).padStart(2, '0')
/** The 21st paydays around today: the next one first, then the last few. */
function paydays(today: string) {
  const [y, m, d] = today.split('-').map(Number)
  const start = y * 12 + (m - 1) + (d > 21 ? 1 : 0)
  return Array.from({ length: 6 }, (_, i) => { const t = start - i; return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}-21` })
}

export default function CommissionSheet() {
  const today = todayPacific()
  const days = useMemo(() => paydays(today), [today])
  const [pay, setPay] = useState(days[0])
  const { folios } = useFolio()
  const folio = folioFor(pay, folios)
  const periods = useAsync(getSdrPeriods, [])
  const period = periods.data?.find((p) => p.pay_date === pay)
  const comm = useAsync(async () => {
    if (!folio) return [] as Comm[]
    const { data, error } = await supabase.functions.invoke('commissions', { body: { folio: folio.start_date, scope: 'office' } })
    if (error) { const msg = await (error as any).context?.json?.().then((j: any) => j.error).catch(() => null); throw new Error(msg || error.message) }
    return ((data.results || []) as Comm[]).sort((a, b) => b.total - a.total)
  }, [folio?.start_date])
  const sdr = useAsync(async () => (period ? getSdrTransfers(period.month) : []), [period?.month])
  const apex = useAsync(async () => (period ? getSdrQuoteNumbers(period.month) : new Map()), [period?.month])

  const qb = Number(period?.qualified_transfer_bonus) || 0, bb = Number(period?.bound_policy_bonus) || 0
  const sdrs = useMemo(() => {
    const m = new Map<string, { logged: number; qualified: number; bound: number; qOnly: number; missing: number }>()
    for (const t of sdr.data || []) {
      const o = m.get(t.sdr) || { logged: 0, qualified: 0, bound: 0, qOnly: 0, missing: 0 }
      // a bound transfer earns the bound bonus in place of the qualified one ($35 total, not $15 + $35)
      o.logged++; if (t.az_qualifies) o.qualified++; if (t.bound) o.bound++; else if (t.az_qualifies) o.qOnly++
      if (!apex.data?.get(t.lead_id)) o.missing++
      m.set(t.sdr, o)
    }
    return [...m].map(([name, o]) => ({ name, ...o, bonus: o.qOnly * qb + o.bound * bb })).sort((a, b) => b.bonus - a.bonus)
  }, [sdr.data, apex.data, qb, bb])
  // owners and admins also see how SDR transfers turn into sales, per producer and per SDR (Rhon's view doesn't)
  const { me } = useAuth()
  const owner = me?.role === 'owner' || me?.role === 'admin'
  const close = useMemo(() => {
    type Row = { name: string; transfers: number; quoted: number; sold: number; premium: number }
    const by = (key: (t: { sdr: string; producer: string }) => string) => {
      const m = new Map<string, Row>()
      for (const t of sdr.data || []) {
        const k = key(t) || 'Unassigned'
        const o = m.get(k) || { name: k, transfers: 0, quoted: 0, sold: 0, premium: 0 }
        o.transfers++; if (t.az_qualifies) o.quoted++; if (t.bound) { o.sold++; o.premium += Number(t.bound_premium) || 0 }
        m.set(k, o)
      }
      return [...m.values()].sort((a, b) => b.sold / (b.transfers || 1) - a.sold / (a.transfers || 1) || b.transfers - a.transfers)
    }
    return { producers: by((t) => t.producer), sdrs: by((t) => t.sdr), pairs: by((t) => `${t.sdr} → ${t.producer || 'Unassigned'}`) }
  }, [sdr.data])
  const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0)
  // the best closer: highest close rate on SDR transfers, among producers with at least 3 (so 1 of 1 doesn't win)
  const best = close.producers.find((r) => r.name !== 'Unassigned' && r.transfers >= 3 && r.sold > 0)
  const prodTotal = (comm.data || []).reduce((s, c) => s + c.total, 0)
  const sdrTotal = sdrs.reduce((s, x) => s + x.bonus, 0)
  const err = comm.error || sdr.error || periods.error || apex.error
  const ready = comm.data && sdr.data && apex.data && periods.data

  const download = () => {
    const r2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
    const folioLabel = folio ? `${folioName(folio)} (${mdy(folio.start_date)} – ${mdy(folio.end_date)})` : 'not set up'
    downloadSheet(`Commissions_${pay}.xlsx`, [
      ['Name', 'Type', 'Commission due'],
      ...(comm.data || []).map((c) => [c.producer, 'Producer commission', r2(c.total)]),
      ...sdrs.map((s) => [s.name, 'SDR bonus', r2(s.bonus)]),
      [], ['Producer commission'],
      ['Producer', 'Total premium', 'Policies', 'Qualifies', 'Tier rate', 'Commission'],
      ...(comm.data || []).map((c) => [c.producer, r2(c.totalPremium), c.policies, c.qualifies ? 'Yes' : 'No', Math.round(c.tierRate * 1000) / 10 + '%', r2(c.total)]),
      [], ['SDR bonus'],
      ['SDR', 'Transfers', 'Qualified', 'Bound', 'SDR bonus', 'Missing Apex quote #'],
      ...sdrs.map((s) => [s.name, s.logged, s.qualified, s.bound, r2(s.bonus), s.missing]),
      [], ['SDR transfers to reconcile — match each Apex quote # to the bonus it earns'],
      ['SDR', 'Transferred', 'Client', 'Producer', 'AgencyZoom lead #', 'Apex quote #', 'Quoted premium', 'Qualified', 'Bound', 'Bonus'],
      ...[...(sdr.data || [])].sort((a, b) => a.sdr.localeCompare(b.sdr) || String(a.date_time).localeCompare(String(b.date_time))).map((t) => [
        t.sdr, String(t.date_time).slice(0, 10), t.client, t.producer, t.lead_id, apex.data?.get(t.lead_id)?.quote_number || 'MISSING',
        r2(Number(t.az_quote_premium) || 0), t.az_qualifies ? 'Yes' : 'No', t.bound ? 'Yes' : 'No', r2(t.bound ? bb : t.az_qualifies ? qb : 0)]),
      [], ['About this sheet'],
      ['Item', 'Detail'],
      ['Payday', mdy(pay)],
      ['Producer commission', `folio ${folioLabel}`],
      ['SDR bonus', `${period?.period_label || 'no SDR month for this payday'} transfers · $${qb} per qualified, $${bb} per bound (in place of the $${qb})`],
    ], {
      sheet: `Commissions ${pay}`, emphasize: /^commission due$/i,
      // one tab per producer: every sale in the folio, and how the commission adds up
      tabs: [...(owner ? [{
        name: 'SDR transfers to sold',
        rows: [
          ['Producer', 'SDR transfers received', 'Quoted', 'Sold', 'Transfer → sold %', 'Transfer → sold, of quoted %', 'Sold premium'],
          ...close.producers.map((r) => [r.name, r.transfers, r.quoted, r.sold, pctOf(r.sold, r.transfers), pctOf(r.sold, r.quoted), r2(r.premium)]),
          [], ['By SDR — transfers sent and how many sold'],
          ['SDR', 'Transfers sent', 'Quoted', 'Sold', 'Transfer → sold %', 'Transfer → sold, of quoted %', 'Sold premium'],
          ...close.sdrs.map((r) => [r.name, r.transfers, r.quoted, r.sold, pctOf(r.sold, r.transfers), pctOf(r.sold, r.quoted), r2(r.premium)]),
          [], ['SDR → producer — who closes whose transfers'],
          ['SDR → producer', 'Transfers', 'Quoted', 'Sold', 'Transfer → sold %', 'Transfer → sold, of quoted %', 'Sold premium'],
          ...close.pairs.map((r) => [r.name, r.transfers, r.quoted, r.sold, pctOf(r.sold, r.transfers), pctOf(r.sold, r.quoted), r2(r.premium)]),
          [], ['About this tab'],
          ['Item', 'Detail'],
          ['Transfers from', `${period?.period_label || '—'} SDR transfers`],
          ['Transfer → sold', 'Only SDR transfers count, never a producer’s other sales. SDR transfers sold ÷ SDR transfers; "of quoted" = sold ÷ SDR transfers that got a real quote.'],
        ],
      }] : []), ...(comm.data || []).map((c) => ({
        name: c.producer,
        rows: [
          ['Sale date', 'Client', 'Carrier', 'Line', 'Bucket', 'Premium'],
          ...[...(c.rows || [])].sort((a, b) => a.sale_date.localeCompare(b.sale_date)).map((r) => [r.sale_date, r.client, r.carrier, r.line, r.bucket, r2(r.premium)]),
          [], ['How the commission adds up'],
          ['Bucket', 'Premium', 'Rate', 'Commission'],
          ...Object.values(c.buckets || {}).filter((b) => b.premium || b.commission).map((b) => [b.label, r2(b.premium), Math.round(b.rate * 1000) / 10 + '%', r2(b.commission)]),
          ...Object.entries(c.bonuses || {}).filter(([, v]) => v).map(([k, v]) => [`Bonus: ${k}`, '', '', r2(v)]),
          [], ['Summary'],
          ['Item', 'Detail'],
          ['Producer', c.producer],
          ['Folio', folioLabel],
          ['Policies', String(c.policies)],
          ['Total premium', '$' + r2(c.totalPremium)],
          ['Qualifies', c.qualifies ? 'Yes' : 'No'],
          ['Tier rate', Math.round(c.tierRate * 1000) / 10 + '%'],
          ...(c.splitShare && c.splitShare !== 1 ? [['Split share', Math.round(c.splitShare * 100) + '%']] : []),
          ['Commission due', '$' + r2(c.total)],
        ],
      }))],
    })
  }

  return (
    <>
      <PageHead kicker="Agency Management" title="Commissions" sub="The commission sheet for each 21st payday: every producer’s commission and every SDR’s bonus, in one spreadsheet." />
      <Panel title={`Payday ${mdy(pay)}`} sub={`Producer commission for the folio ${folio ? `${mdy(folio.start_date)} – ${mdy(folio.end_date)}` : '(not set up yet)'} · SDR bonus for ${period?.period_label || 'last month'} transfers`}
        right={<div className="filters">
          <select className="fld" value={pay} onChange={(e) => setPay(e.target.value)} aria-label="Payday">
            {days.map((d, i) => <option key={d} value={d}>{mdy(d)}{i === 0 ? ' (next payday)' : ''}</option>)}
          </select>
          <button className="btn-primary" onClick={download} disabled={!ready || !!err}>Download commission sheet</button>
        </div>}>
        {err ? <ErrorBox error={err} /> : !ready ? <Loading what="Adding up commissions" /> : (
          <Tiles>
            <Tile label="Total due" value={money2(prodTotal + sdrTotal)} sub={`paid ${mdy(pay)}`} tone="good" />
            <Tile label="Producer commission" value={money2(prodTotal)} sub={`${(comm.data || []).length} producers`} />
            <Tile label="SDR bonus" value={money2(sdrTotal)} sub={`${sdrs.length} SDRs · ${(sdr.data || []).length} transfers`} />
            <Tile label="Missing Apex quote #" value={sdrs.reduce((s, x) => s + x.missing, 0)} sub="transfers without a quote # yet" tone={sdrs.some((x) => x.missing) ? 'warn' : 'good'} />
          </Tiles>
        )}
      </Panel>
      {ready && !err && <>
        <Panel title="Producer commission" sub={folio ? `Folio ${mdy(folio.start_date)} – ${mdy(folio.end_date)}` : ''}>
          {(comm.data || []).length ? (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Producer</th><th className="r">Total premium</th><th className="r">Policies</th><th>Qualifies</th><th className="r">Tier rate</th><th className="r">Commission</th></tr></thead>
              <tbody>{(comm.data || []).map((c) => (
                <tr key={c.producer}><td><b>{c.producer}</b></td><td className="r mono">{money2(c.totalPremium)}</td><td className="r">{c.policies}</td>
                  <td><span className={'pill ' + (c.qualifies ? 'pill-good' : 'pill-muted')}>{c.qualifies ? 'Yes' : 'No'}</span></td>
                  <td className="r">{Math.round(c.tierRate * 1000) / 10}%</td><td className="r mono"><b>{money2(c.total)}</b></td></tr>
              ))}</tbody>
            </table></div>
          ) : <Empty>No producer commission for this payday (the folio isn’t set up, or nothing was sold).</Empty>}
        </Panel>
        <Panel title="SDR bonus" sub={period ? `${period.period_label} transfers · $${qb} per qualified, $${bb} per bound` : 'No SDR month for this payday'}>
          {sdrs.length ? (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>SDR</th><th className="r">Transfers</th><th className="r">Qualified</th><th className="r">Bound</th><th className="r">Missing quote #</th><th className="r">Bonus</th></tr></thead>
              <tbody>{sdrs.map((s) => (
                <tr key={s.name}><td><b>{s.name}</b></td><td className="r">{s.logged}</td><td className="r">{s.qualified}</td><td className="r">{s.bound}</td>
                  <td className="r">{s.missing ? <span className="pill pill-warn">{s.missing}</span> : '0'}</td><td className="r mono"><b>{money2(s.bonus)}</b></td></tr>
              ))}</tbody>
            </table></div>
          ) : <Empty>No SDR transfers for this payday.</Empty>}
        </Panel>
        {owner && (
          <Panel title="SDR transfers → sold" sub={`${period?.period_label || 'Last month'} SDR transfers only, not a producer’s other sales · sold rate = SDR transfers sold ÷ SDR transfers · owners and admins only`}>
            {best && <div className="cs-best"><span className="cs-best-k">Best at closing SDR transfers</span><b>{best.name}</b><span>{pctOf(best.sold, best.transfers)}% · {best.sold} sold of {best.transfers} SDR transfers · {money2(best.premium)}</span></div>}
            {(sdr.data || []).length ? <div className="cs-close">
              <CloseTable title="By producer — SDR transfers received" who="Producer" rows={close.producers} pct={pctOf} best={best?.name} />
              <CloseTable title="By SDR — transfers sent" who="SDR" rows={close.sdrs} pct={pctOf} />
            </div> : <Empty>No SDR transfers for this payday.</Empty>}
          </Panel>
        )}
      </>}
    </>
  )
}

function CloseTable({ title, who, rows, pct, best }: { title: string; who: string; rows: { name: string; transfers: number; quoted: number; sold: number; premium: number }[]; pct: (a: number, b: number) => number; best?: string }) {
  return (
    <div>
      <div className="cs-close-h">{title}</div>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>{who}</th><th className="r">SDR transfers</th><th className="r">Quoted</th><th className="r">Sold</th><th className="r">Transfer → sold</th><th className="r">Sold premium</th></tr></thead>
        <tbody>{rows.map((r) => {
          const p = pct(r.sold, r.transfers)
          return (
            <tr key={r.name}><td><b>{r.name}</b>{r.name === best && <span className="pill pill-good cs-best-pill">Best</span>}</td><td className="r">{r.transfers}</td><td className="r">{r.quoted}</td><td className="r">{r.sold}</td>
              <td className="r"><span className={'pill ' + (p >= 20 ? 'pill-good' : p >= 10 ? 'pill-warn' : 'pill-muted')}>{p}%</span><small className="cs-sub"> {pct(r.sold, r.quoted)}% of quoted</small></td>
              <td className="r mono">{money2(r.premium)}</td></tr>
          )
        })}</tbody>
      </table></div>
    </div>
  )
}
