import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { useFolio } from '../components/FolioPicker'
import { Empty, ErrorBox, Loading, PageHead, Panel } from '../components/ui'
import { getSdrPeriods, getSdrTransfers } from '../lib/data'
import { mdy, money2, pct, shortDate, todayPacific } from '../lib/format'
import { checkFor, folioFor, nextPay, stepPay } from '../lib/payday'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'
import { useSyncStamp } from '../lib/syncEvents'
import { workedMinutes } from './Licensing'

/** My Pay: your own pay on a payday, laid out like a pay stub — hours × your rate, plus on the 21st your commission
 *  (producers) and SDR bonus — with the hours, policies and transfers behind each line. Only you (and the agency
 *  admins) see it: the database returns only your own hours, sales and transfers, and the commission calculator
 *  only your own line; where someone can see more (an admin, or whoever runs payroll), this page keeps to theirs. */

interface Staff { name: string; hourly: boolean; rate: number | null; active: boolean; left_on: string | null }
interface Punch { id: number; name: string; work_date: string; start_time: string | null; end_time: string | null; breaks: [string, string][]; edited: boolean }
interface Comm {
  producer: string; totalPremium: number; policies: number; qualifies: boolean; tierRate: number; total: number
  buckets: Record<string, { key: string; label: string; premium: number; commission: number; rate: number }>
  bonuses: Record<string, number>
  rows: { client: string; carrier: string; line: string; premium: number; sale_date: string; bucket: string }[]
}
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`

export default function MyPay() {
  const { me } = useAuth()
  const names = useMemo(() => new Set([me?.display_name, me?.producer_name].filter(Boolean).flatMap((n) => [n!.trim().toLowerCase(), n!.trim().split(/\s+/)[0].toLowerCase()])), [me])
  const mine = (n: string | null | undefined) => !!n && names.has(n.trim().toLowerCase())
  const [pay, setPay] = useState(() => nextPay(todayPacific()))
  const check = checkFor(pay)
  const { folios } = useFolio()
  const folio = folioFor(pay, folios)
  const synced = useSyncStamp()
  const earnsCommission = ['producer', 'protege', 'admin'].includes(me?.role || '')

  const hours = useAsync(async () => {
    const staff = await supabase.from('hr_staff').select('name, hourly, rate, active, left_on').then((r) => { if (r.error) throw r.error; return r.data as Staff[] })
    const row = staff.find((s) => names.has(s.name.trim().toLowerCase())) || null
    if (!row) return { row, punches: [] as Punch[] }
    const { data, error } = await supabase.from('hr_punches').select('*').eq('name', row.name).gte('work_date', check.from).lte('work_date', check.to).order('work_date')
    if (error) throw error
    return { row, punches: data as Punch[] }
  }, [check.from, check.to, names])
  const comm = useAsync(async () => {
    if (!folio || !earnsCommission) return null
    const { data, error } = await supabase.functions.invoke('commissions', { body: { folio: folio.start_date } })
    if (error) {
      const msg = await (error as any).context?.json?.().then((j: any) => j.error).catch(() => null)
      throw new Error(msg || error.message)
    }
    return { mine: ((data.results || []) as Comm[]).find((r) => mine(r.producer)) || null, plan: data.plan as { name: string; buckets: { key: string; label: string }[] } }
  }, [folio?.start_date, earnsCommission, synced])
  const periods = useAsync(getSdrPeriods, [])
  const period = check.commission ? periods.data?.find((p) => p.pay_date === pay) : undefined
  const sdr = useAsync(async () => (period ? (await getSdrTransfers(period.month)).filter((t) => mine(t.sdr)) : []), [period?.month, names])

  const row = hours.data?.row
  const mins = (hours.data?.punches || []).reduce((a, p) => a + workedMinutes(p), 0)
  const hourlyPay = row?.hourly && row.rate ? Math.round((mins / 60) * row.rate * 100) / 100 : 0
  const c = comm.data?.mine
  const qb = Number(period?.qualified_transfer_bonus) || 0, bb = Number(period?.bound_policy_bonus) || 0
  const qualified = (sdr.data || []).filter((t) => t.az_qualifies).length, bound = (sdr.data || []).filter((t) => t.bound).length
  const bonus = qualified * qb + bound * bb
  const total = hourlyPay + (c?.total || 0) + bonus

  const err = hours.error || comm.error || periods.error || sdr.error
  const loading = !hours.data || (check.commission && earnsCommission && folio && comm.loading && !comm.data)
  const lines: { label: string; detail: string; amount: number }[] = []
  if (row?.hourly) lines.push({ label: 'Hourly pay', detail: `${hm(mins)} × ${row.rate != null ? money2(row.rate) + '/hr' : 'no rate set'} · ${shortDate(check.from)} – ${shortDate(check.to, true)}`, amount: hourlyPay })
  if (check.commission && earnsCommission && (c || folio)) lines.push({ label: 'Commission', detail: folio ? `Folio ${shortDate(folio.start_date)} – ${shortDate(folio.end_date, true)}${c ? ` · ${c.policies} policies · ${c.qualifies ? 'qualified' : 'not qualified'} · tier ${pct(c.tierRate)}` : ' · no sales credited to you'}` : 'Folio not set up yet', amount: c?.total || 0 })
  if (check.commission && (sdr.data?.length || me?.role === 'sdr' || me?.role === 'va')) lines.push({ label: 'SDR bonus', detail: period ? `${period.period_label} transfers · ${qualified} qualified × $${qb} + ${bound} bound × $${bb}` : 'No SDR month for this payday', amount: bonus })

  return (
    <>
      <PageHead kicker="Workspace" title="My Pay" sub="Your pay on each payday. Only you and the agency admins can see these numbers." />
      <Panel title={`Payday ${mdy(pay)}`} sub={check.commission ? 'The 21st pays hours for the 1st–15th, plus your commission for last month’s folio and SDR bonus for last month’s transfers. What you earn in the folio open now is paid next month.' : 'The 5th pays hours for the 16th to the end of last month. Commission and SDR bonuses are paid on the 21st.'}
        right={<div className="filters">
          <button className="btn-ghost" onClick={() => setPay(stepPay(pay, -1))} aria-label="Previous payday">‹ {shortDate(stepPay(pay, -1))}</button>
          <button className="btn-ghost" onClick={() => setPay(stepPay(pay, 1))} aria-label="Next payday">{shortDate(stepPay(pay, 1))} ›</button>
        </div>}>
        {err ? <ErrorBox error={err} /> : loading ? <Loading what="Adding up your pay" /> : lines.length ? (
          <table className="tbl paystub">
            <tbody>
              {lines.map((l) => (
                <tr key={l.label}><td><div className="strong">{l.label}</div><div className="sub">{l.detail}</div></td><td className="r mono">{money2(l.amount)}</td></tr>
              ))}
              <tr className="paystub-total"><td className="strong">Total {pay > todayPacific() ? 'so far' : ''}</td><td className="r mono strong">{money2(total)}</td></tr>
            </tbody>
          </table>
        ) : <Empty>Nothing to show for this payday. If you think that’s wrong, ask an admin to check your pay setup under HR.</Empty>}
        {!err && !loading && pay > todayPacific() && lines.length > 0 && <div className="sub" style={{ marginTop: 8 }}>This payday hasn’t happened yet: the figures grow as hours, sales and transfers come in.</div>}
      </Panel>

      {row?.hourly && (hours.data?.punches.length || 0) > 0 && (
        <Panel title="My hours" sub={`${shortDate(check.from)} – ${shortDate(check.to, true)} · ${hm(mins)} worked`}>
          <table className="tbl">
            <thead><tr><th>Date</th><th>In</th><th>Out</th><th>Breaks</th><th className="r">Worked</th></tr></thead>
            <tbody>{hours.data!.punches.map((p) => (
              <tr key={p.id}><td>{mdy(p.work_date)}</td><td>{p.start_time}</td><td>{p.end_time}</td><td className="sub">{(p.breaks || []).map((b) => b.join('–')).join(', ')}</td><td className="r">{hm(workedMinutes(p))}</td></tr>
            ))}</tbody>
          </table>
        </Panel>
      )}

      {check.commission && c && comm.data && (
        <Panel title="My commission" sub={`${comm.data.plan.name} · ${c.policies} policies · ${money2(c.totalPremium)} premium credited to you`}>
          <table className="tbl">
            <thead><tr><th>Bucket</th><th className="r">Premium</th><th className="r">Rate</th><th className="r">Commission</th></tr></thead>
            <tbody>
              {comm.data.plan.buckets.map((b) => { const x = c.buckets[b.key]; return x && x.premium ? (
                <tr key={b.key}><td>{b.label}</td><td className="r mono">{money2(x.premium)}</td><td className="r">{pct(x.rate)}</td><td className="r mono">{money2(x.commission)}</td></tr>) : null })}
              {Object.entries(c.bonuses || {}).filter(([, v]) => v).map(([k, v]) => <tr key={k}><td>{k}</td><td /><td /><td className="r mono">{money2(v)}</td></tr>)}
              <tr className="paystub-total"><td className="strong">Commission</td><td /><td /><td className="r mono strong">{money2(c.total)}</td></tr>
            </tbody>
          </table>
          <details className="plan" style={{ marginTop: 10 }}>
            <summary className="strong" style={{ cursor: 'pointer' }}>The {c.rows.length} policies behind it</summary>
            <table className="tbl inner">
              <thead><tr><th>Sold</th><th>Customer</th><th>Line</th><th>Carrier</th><th>Bucket</th><th className="r">Premium</th></tr></thead>
              <tbody>{c.rows.map((x, i) => (
                <tr key={i}><td className="mono">{shortDate(x.sale_date)}</td><td>{x.client}</td><td>{x.line}</td><td>{x.carrier}</td><td>{x.bucket}</td><td className="r mono">{money2(x.premium)}</td></tr>
              ))}</tbody>
            </table>
          </details>
        </Panel>
      )}

      {check.commission && (sdr.data?.length || 0) > 0 && (
        <Panel title="My SDR transfers" sub={<>{period?.period_label} · {qualified} qualified · {bound} bound · how this month is going is on <Link to="/my-commissions">My Commissions</Link></>}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Transferred</th><th>Client</th><th>Producer</th><th>Status</th><th className="r">Quoted</th><th>Qualifies</th><th>Bound</th></tr></thead>
              <tbody>{sdr.data!.map((t) => (
                <tr key={t.lead_id}><td>{mdy(String(t.date_time).slice(0, 10))}</td><td>{t.client}</td><td>{t.producer}</td><td>{t.status}</td>
                  <td className="r mono">{t.az_quote_premium ? money2(t.az_quote_premium) : '—'}</td>
                  <td><span className={'pill ' + (t.az_qualifies ? 'pill-good' : 'pill-muted')}>{t.az_qualifies ? 'Yes' : 'Not yet'}</span></td>
                  <td>{t.bound ? <span className="pill pill-good">Bound</span> : ''}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  )
}
