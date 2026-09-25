import { Fragment, useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { FolioPicker, folioName, useFolio } from '../components/FolioPicker'
import { Empty, ErrorBox, Loading, PageHead, Panel, Tabs, Tile, Tiles } from '../components/ui'
import { getSdrPeriods, getSdrTransfers, type SdrPeriod } from '../lib/data'
import { downloadCsv, mdy, money0, money2, pct, shortDate } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

/** My Pay: each person sees only their own commission and/or SDR bonus. The database only returns
 *  their own sales and transfers, and the commission calculator only returns their own row. */
export default function MyPay() {
  const { me } = useAuth()
  const producer = me?.role === 'producer' || me?.role === 'protege'
  const sdr = me?.role === 'sdr'
  const [tab, setTab] = useState<'comm' | 'sdr'>(sdr ? 'sdr' : 'comm')
  const tabs = [...(producer ? [{ key: 'comm' as const, label: 'My commission' }] : []), ...(sdr || producer ? [{ key: 'sdr' as const, label: 'My SDR bonus' }] : [])]
  return (
    <>
      <PageHead kicker="Workspace" title="My Pay" sub="Only you (and the agency admins) can see these numbers." />
      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={setTab} />}
      {!producer && !sdr ? <Empty>Your role doesn’t earn commission or SDR bonuses. Ask an admin if that’s wrong.</Empty>
        : tab === 'comm' && producer ? <MyCommission /> : <MySdrPay />}
    </>
  )
}

interface Result {
  producer: string
  totalPremium: number
  policies: number
  life: number
  qualifies: boolean
  tierRate: number
  buckets: Record<string, { key: string; label: string; premium: number; commission: number; rate: number }>
  bonuses: Record<string, number>
  total: number
  rows: { client: string; carrier: string; line: string; premium: number; sale_date: string; bucket: string }[]
}
interface Resp {
  folio: { start_date: string; end: string; in_progress: boolean }
  plan: { name: string; summary: string; buckets: { key: string; label: string }[] }
  scope: 'all' | 'self'
  results: Result[]
}

export function MyCommission() {
  const { me } = useAuth()
  const { folio } = useFolio()
  const [open, setOpen] = useState<string | null>('__all')
  const { data, error, loading } = useAsync(async () => {
    if (!folio) return null
    const { data, error } = await supabase.functions.invoke('commissions', { body: { folio: folio.start_date } })
    if (error) {
      const msg = await (error as any).context?.json?.().then((j: any) => j.error).catch(() => null)
      throw new Error(msg || error.message)
    }
    return data as Resp
  }, [folio?.start_date])

  const admin = false
  void me
  const title = 'My commission'
  if (error) return <><Panel title={title} right={<FolioPicker />}><span /></Panel><ErrorBox error={error} /></>
  if (!data || (loading && !data)) return <><Panel title={title} right={<FolioPicker />}><span /></Panel><Loading what="Calculating" /></>

  const { plan, results } = data
  const totalComm = results.reduce((s, r) => s + r.total, 0)
  const bucketKeys = plan.buckets.map((b) => b.key)

  const exportCsv = () => downloadCsv(`Ironwood_Commissions_${folio?.start_date}.csv`, [
    ['Producer', 'Total premium', 'Policies', 'Life (weighted)', 'Qualifies', 'Tier rate',
      ...plan.buckets.flatMap((b) => [`${b.label} premium`, `${b.label} commission`]), 'Bonuses', 'Total commission'],
    ...results.map((r) => [r.producer, r.totalPremium.toFixed(2), r.policies, r.life, r.qualifies ? 'Yes' : 'No', pct(r.tierRate),
      ...bucketKeys.flatMap((k) => [r.buckets[k]?.premium.toFixed(2) || '0.00', r.buckets[k]?.commission.toFixed(2) || '0.00']),
      Object.values(r.bonuses || {}).reduce((a, b) => a + b, 0).toFixed(2), r.total.toFixed(2)]),
    [],
    ['Policy detail'],
    ['Producer', 'Sold', 'Customer', 'Line', 'Carrier', 'Bucket', 'Premium'],
    ...results.flatMap((r) => r.rows.map((x) => [r.producer, mdy(x.sale_date), x.client, x.line, x.carrier, x.bucket, x.premium.toFixed(2)])),
  ])

  return (
    <>
      <div className="filters" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="sub">{folio ? folioName(folio) + (folio.in_progress ? ' · running total, not final until the folio closes' : '') : ''}</div>
        <FolioPicker />
      </div>
      {results[0] && (
        <Tiles>
          <Tile label="My commission" value={money2(results[0].total)} sub={folio?.in_progress ? 'running total this folio' : 'for this folio'} tone={results[0].qualifies ? 'good' : undefined} />
          <Tile label="Premium credited to me" value={money0(results[0].totalPremium)} sub={`${results[0].policies} policies · ${results[0].life} life`} />
          <Tile label="Qualified" value={results[0].qualifies ? 'Yes' : 'Not yet'} sub={`tier rate ${pct(results[0].tierRate)}`} />
        </Tiles>
      )}
      {admin && (
        <Tiles>
          <Tile label="Total commission" value={money0(totalComm)} sub={`${results.filter((r) => r.qualifies).length} of ${results.length} producers qualify`} />
          <Tile label="Premium written" value={money0(results.reduce((s, r) => s + r.totalPremium, 0))} sub={`${results.reduce((s, r) => s + r.policies, 0)} policies`} />
        </Tiles>
      )}
      <Panel title={plan.name} sub={plan.summary} right={<button className="btn-ghost" onClick={exportCsv} disabled={!results.length}>Download CSV</button>}>
        {results.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Producer</th><th className="r">Premium</th><th className="r">Policies</th><th className="r">Life</th><th>Qualifies</th><th className="r">Tier</th>
                  {plan.buckets.map((b) => <th key={b.key} className="r">{b.label}</th>)}<th className="r">Bonus</th><th className="r">Commission</th></tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <Fragment key={r.producer}>
                    <tr className="clickable" onClick={() => setOpen((open === r.producer || open === '__all') ? null : r.producer)}>
                      <td className="strong">{(open === r.producer || open === '__all') ? '▾ ' : '▸ '}{r.producer}</td>
                      <td className="r mono">{money0(r.totalPremium)}</td>
                      <td className="r">{r.policies}</td>
                      <td className="r">{r.life}</td>
                      <td><span className={'pill ' + (r.qualifies ? 'pill-good' : 'pill-muted')}>{r.qualifies ? 'Yes' : 'Not yet'}</span></td>
                      <td className="r">{pct(r.tierRate)}</td>
                      {bucketKeys.map((k) => <td key={k} className="r mono">{money0(r.buckets[k]?.commission || 0)}</td>)}
                      <td className="r mono">{money0(Object.values(r.bonuses || {}).reduce((a, b) => a + b, 0))}</td>
                      <td className="r mono strong">{money2(r.total)}</td>
                    </tr>
                    {(open === r.producer || open === '__all') && (
                      <tr className="detail"><td colSpan={8 + bucketKeys.length}>
                        <table className="tbl inner">
                          <thead><tr><th>Sold</th><th>Customer</th><th>Line</th><th>Carrier</th><th>Bucket</th><th className="r">Premium</th></tr></thead>
                          <tbody>{r.rows.map((x, i) => (
                            <tr key={i}><td className="mono">{shortDate(x.sale_date)}</td><td>{x.client}</td><td>{x.line}</td><td>{x.carrier}</td><td>{x.bucket}</td><td className="r mono">{money2(x.premium)}</td></tr>
                          ))}</tbody>
                        </table>
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>{data.scope === 'self' ? 'No sales credited to you in this folio yet.' : 'No sales in this folio yet.'}</Empty>}
      </Panel>
    </>
  )
}

export function MySdrPay() {
  const periods = useAsync(getSdrPeriods, [])
  const [month, setMonth] = useState('')
  useEffect(() => {
    if (!month && periods.data?.length) setMonth((periods.data.find((p) => !p.closed) || periods.data[0]).month)
  }, [periods.data])
  const period: SdrPeriod | undefined = periods.data?.find((p) => p.month === month)
  const transfers = useAsync(async () => (month ? getSdrTransfers(month) : []), [month])

  const picker = (
    <label className="picker">Month
      <select value={month} onChange={(e) => setMonth(e.target.value)}>
        {(periods.data || []).map((p) => <option key={p.month} value={p.month}>{p.period_label}{p.closed ? ' (paid)' : ''}</option>)}
      </select>
    </label>
  )
  if (periods.error || transfers.error) return <><div className="filters" style={{ marginBottom: 12 }}>{picker}</div><ErrorBox error={periods.error || transfers.error} /></>
  if (!period || !transfers.data) return <><div className="filters" style={{ marginBottom: 12 }}>{picker}</div><Loading /></>

  const qb = Number(period.qualified_transfer_bonus) || 0, bb = Number(period.bound_policy_bonus) || 0
  const rows = transfers.data
  const bySdr = new Map<string, { logged: number; qualified: number; bound: number }>()
  rows.forEach((t) => {
    const o = bySdr.get(t.sdr) || { logged: 0, qualified: 0, bound: 0 }
    o.logged++; if (t.az_qualifies) o.qualified++; if (t.bound) o.bound++
    bySdr.set(t.sdr, o)
  })

  return (
    <>
      <div className="filters" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="sub">{`${period.period_label} transfers · paid ${shortDate(period.pay_date, true)} · $${qb} per qualified transfer, $${bb} per bound policy`}</div>
        {picker}
      </div>
      <Tiles>
        {[...bySdr.entries()].map(([sdr, o]) => (
          <Tile key={sdr} label={sdr} value={money0(o.qualified * qb + o.bound * bb)}
            sub={`${o.qualified} qualified · ${o.bound} bound · ${o.logged} logged`} tone={period.closed ? undefined : 'good'} />
        ))}
      </Tiles>
      <Panel title={`${rows.length} transfers`}
        sub="A transfer qualifies once AgencyZoom shows a real quote on the tagged lead. Updated every hour."
        right={<button className="btn-ghost" disabled={!rows.length} onClick={() => downloadCsv(`SDR_${month}.csv`, [
          ['SDR', 'Transferred', 'Client', 'Producer', 'Source', 'Status', 'Quote premium', 'Qualifies', 'Bound', 'Bonus'],
          ...rows.map((t) => [t.sdr, mdy(String(t.date_time).slice(0, 10)), t.client, t.producer, t.lead_source, t.status,
            t.az_quote_premium.toFixed(2), t.az_qualifies ? 'Yes' : 'No', t.bound ? 'Yes' : 'No', ((t.az_qualifies ? qb : 0) + (t.bound ? bb : 0)).toFixed(2)]),
        ])}>Download CSV</button>}>
        {rows.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>SDR</th><th>Transferred</th><th>Client</th><th>Producer</th><th>Status</th><th className="r">Quoted</th><th>Qualifies</th><th>Bound</th></tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.lead_id}>
                    <td className="strong">{t.sdr}</td>
                    <td className="mono">{shortDate(String(t.date_time).slice(0, 10))}</td>
                    <td>{t.url ? <a href={t.url} target="_blank" rel="noreferrer">{t.client}</a> : t.client}</td>
                    <td>{t.producer}</td><td>{t.status}</td>
                    <td className="r mono">{t.az_quote_premium ? money0(t.az_quote_premium) : '—'}</td>
                    <td><span className={'pill ' + (t.az_qualifies ? 'pill-good' : 'pill-muted')}>{t.az_qualifies ? 'Yes' : 'No'}</span></td>
                    <td>{t.bound ? <span className="pill pill-good">Bound</span> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>No transfers credited to you for this month yet.</Empty>}
      </Panel>
    </>
  )
}
