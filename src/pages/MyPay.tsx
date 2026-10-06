import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { useFolio } from '../components/FolioPicker'
import { Empty, ErrorBox, Loading, PageHead, Panel } from '../components/ui'
import { getSdrPeriods, getSdrTransfers } from '../lib/data'
import { mdy, money0, money2, pct, shortDate, todayPacific } from '../lib/format'
import { agencyBonus, checkFor, folioFor, nextPay, salaryCheck, stepPay, type BonusTier } from '../lib/payday'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'
import { useSyncStamp } from '../lib/syncEvents'
import { takeHome, type FilingStatus } from '../lib/takeHome'
import { workedMinutes } from './Licensing'

/** My Pay: your own pay on a payday, laid out like a pay stub — hours × your rate (or your salary), plus on the 21st your
 *  commission (producers), SDR bonus, or a salaried person's cash bonus on the agency's premium for the folio — with the hours, policies and transfers behind each line. Only you (and the agency
 *  admins) see it: the database returns only your own hours, sales and transfers, and the commission calculator
 *  only your own line; where someone can see more (an admin, or whoever runs payroll), this page keeps to theirs. */

interface Staff { name: string; hourly: boolean; rate: number | null; active: boolean; left_on: string | null; salary_annual: number | null; bonus_tiers: BonusTier[] | null }
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
  // filing status for the take-home estimate, remembered on this device
  const [filing, setFiling] = useState<FilingStatus>(() => { try { return localStorage.getItem('declara_filing_status') === 'married' ? 'married' : 'single' } catch { return 'single' } })
  const pickFiling = (f: FilingStatus) => { setFiling(f); try { localStorage.setItem('declara_filing_status', f) } catch { /* private window */ } }

  const hours = useAsync(async () => {
    const staff = await supabase.from('hr_staff').select('name, hourly, rate, active, left_on, salary_annual, bonus_tiers').then((r) => { if (r.error) throw r.error; return r.data as Staff[] })
    const row = staff.find((s) => names.has(s.name.trim().toLowerCase())) || null
    if (!row) return { row, punches: [] as Punch[] }
    const { data, error } = await supabase.from('hr_punches').select('*').eq('name', row.name).gte('work_date', check.from).lte('work_date', check.to).order('work_date')
    if (error) throw error
    return { row, punches: data as Punch[] }
  }, [check.from, check.to, names])
  // salaried staff are paid a salary and cash bonuses instead of commission
  const salaried = !!hours.data?.row?.salary_annual
  const earnsCommission = !!hours.data && !salaried && ['producer', 'protege', 'admin'].includes(me?.role || '')
  const tiers = hours.data?.row?.bonus_tiers
  const agencyPrem = useAsync(async () => {
    if (!folio || !tiers?.length) return null
    const { data, error } = await supabase.rpc('agency_premium', { p_from: folio.start_date, p_to: folio.end_date })
    if (error) throw error
    return Number(data) || 0
  }, [folio?.start_date, folio?.end_date, tiers?.length, synced])
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
  const salary = salaried ? salaryCheck(row?.salary_annual) : 0
  const cash = check.commission && agencyPrem.data != null ? agencyBonus(tiers, agencyPrem.data) : { amount: 0, min: 0 }
  const total = hourlyPay + salary + (c?.total || 0) + bonus + cash.amount

  // estimated take-home for salaried staff: salary as regular pay, the cash bonus as a supplemental payment
  const net = salaried ? takeHome(hourlyPay + salary, (c?.total || 0) + bonus + cash.amount, filing) : null
  const err = hours.error || comm.error || periods.error || sdr.error || agencyPrem.error
  const loading = !hours.data || (check.commission && earnsCommission && folio && comm.loading && !comm.data) || (check.commission && tiers?.length && folio && agencyPrem.loading && agencyPrem.data == null)
  // what's in the check, one short line each
  const lines: { label: string; detail: string; amount: number }[] = []
  const folioName = folio ? `${shortDate(folio.start_date)} – ${shortDate(folio.end_date, true)}` : ''
  const firstTier = tiers?.length ? Math.min(...tiers.map((t) => Number(t.min))) : 0
  if (row?.hourly) lines.push({ label: 'Hours', detail: `${hm(mins)} at ${row.rate != null ? money2(row.rate) + '/hr' : '(no rate set)'}`, amount: hourlyPay })
  if (salaried) lines.push({ label: 'Salary', detail: `${money0(Number(row!.salary_annual))} a year, split into 24 checks`, amount: salary })
  if (check.commission && tiers?.length) lines.push({ label: 'Agency bonus', detail: !folio ? 'Folio not set up yet' : cash.amount ? `Agency wrote ${money0(agencyPrem.data || 0)} last folio` : `Agency wrote ${money0(agencyPrem.data || 0)} last folio · needed ${money0(firstTier)}`, amount: cash.amount })
  if (check.commission && earnsCommission && (c || folio)) lines.push({ label: 'Commission', detail: !folio ? 'Folio not set up yet' : c ? `${c.policies} policies sold ${folioName}` : `No sales credited to you ${folioName}`, amount: c?.total || 0 })
  if (check.commission && (sdr.data?.length || me?.role === 'sdr' || me?.role === 'va')) lines.push({ label: 'SDR bonus', detail: period ? `${period.period_label}: ${qualified} qualified, ${bound} bound` : 'No SDR month for this payday', amount: bonus })
  const upcoming = pay > todayPacific()
  const weekday = new Date(pay + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

  return (
    <>
      <PageHead kicker="Workspace" title="My Pay" sub="Only you and the agency admins can see this." />
      <section className="panel pay-card">
        <div className="pay-nav">
          <button className="btn-ghost" onClick={() => setPay(stepPay(pay, -1))} aria-label="Previous payday">‹ {shortDate(stepPay(pay, -1))}</button>
          <div className="pay-day"><div className="pay-k">{upcoming ? 'Next paycheck' : 'Paycheck'}</div><div className="strong">{weekday}</div></div>
          <button className="btn-ghost" onClick={() => setPay(stepPay(pay, 1))} aria-label="Next payday">{shortDate(stepPay(pay, 1))} ›</button>
        </div>
        {err ? <ErrorBox error={err} /> : loading ? <Loading what="Adding up your pay" /> : !lines.length ? (
          <Empty>Nothing to show for this payday. If you think that’s wrong, ask an admin to check your pay setup under HR.</Empty>
        ) : (
          <>
            <div className="pay-big">
              <div className="pay-k">{net ? 'You take home about' : upcoming ? 'Your pay so far' : 'Your pay'}</div>
              <div className="pay-amt">{money2(net ? net.net : total)}</div>
              {net && <div className="sub">{money2(total)} before taxes · {money2(net.deductions)} in taxes</div>}
            </div>
            <table className="tbl paystub">
              <tbody>
                {lines.map((l) => (
                  <tr key={l.label}><td><div className="strong">{l.label}</div><div className="sub">{l.detail}</div></td><td className="r mono">{money2(l.amount)}</td></tr>
                ))}
                {net && <tr><td><div className="strong">Taxes</div><div className="sub">Estimated for San Jose, CA</div></td><td className="r mono">−{money2(net.deductions)}</td></tr>}
                <tr className="paystub-total"><td className="strong">{net ? 'Take-home (estimate)' : 'Total'}</td><td className="r mono strong">{money2(net ? net.net : total)}</td></tr>
              </tbody>
            </table>
            {net && (
              <details className="pay-taxes">
                <summary>See the taxes</summary>
                <div className="filters" style={{ margin: '10px 0' }}>
                  <select value={filing} onChange={(e) => pickFiling(e.target.value as FilingStatus)} aria-label="Filing status">
                    <option value="single">Single</option><option value="married">Married filing jointly</option>
                  </select>
                </div>
                <table className="tbl inner">
                  <tbody>{net.lines.map((l) => <tr key={l.label}><td>{l.label}</td><td className="r mono">−{money2(l.amount)}</td></tr>)}</tbody>
                </table>
                <div className="sub" style={{ marginTop: 8 }}>An estimate: your real check depends on your W-4 and things like 401(k) or health insurance. Bonuses are withheld at the flat bonus rates.</div>
              </details>
            )}
            {upcoming && <div className="sub pay-note">This payday hasn’t happened yet, so these numbers can still change.</div>}
          </>
        )}
      </section>

      {salaried && tiers?.length ? <BonusTracker tiers={tiers} folios={folios} synced={synced} /> : null}

      {row?.hourly && (hours.data?.punches.length || 0) > 0 && (
        <Panel title="My hours" sub={`${shortDate(check.from)} – ${shortDate(check.to, true)} · ${hm(mins)}`}>
          <table className="tbl">
            <thead><tr><th>Date</th><th>In</th><th>Out</th><th>Breaks</th><th className="r">Worked</th></tr></thead>
            <tbody>{hours.data!.punches.map((p) => (
              <tr key={p.id}><td>{mdy(p.work_date)}</td><td>{p.start_time}</td><td>{p.end_time}</td><td className="sub">{(p.breaks || []).map((b) => b.join('–')).join(', ')}</td><td className="r">{hm(workedMinutes(p))}</td></tr>
            ))}</tbody>
          </table>
        </Panel>
      )}

      {check.commission && c && comm.data && (
        <Panel title="How your commission adds up" sub={`${c.policies} policies · ${money2(c.totalPremium)} premium`}>
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

/** Salaried staff: how the folio open now is going toward the next cash bonus (paid the month after it closes). */
function BonusTracker({ tiers, folios, synced }: { tiers: BonusTier[]; folios: { start_date: string; end_date: string; in_progress?: boolean }[]; synced: unknown }) {
  const open = folios.find((f) => f.in_progress) || folios.find((f) => f.start_date <= todayPacific() && f.end_date >= todayPacific())
  const prem = useAsync(async () => {
    if (!open) return null
    const { data, error } = await supabase.rpc('agency_premium', { p_from: open.start_date, p_to: open.end_date })
    if (error) throw error
    return Number(data) || 0
  }, [open?.start_date, open?.end_date, synced])
  if (!open || prem.data == null) return null
  const sorted = [...tiers].sort((a, b) => Number(a.min) - Number(b.min))
  const now = agencyBonus(tiers, prem.data)
  const next = sorted.find((t) => Number(t.min) > prem.data!)
  return (
    <Panel title="Bonus tracker" sub={`This folio, ${shortDate(open.start_date)} – ${shortDate(open.end_date, true)} · paid next month`}>
      <div className="pay-big" style={{ textAlign: 'left', padding: 0 }}>
        <div className="pay-k">The agency has written</div>
        <div className="pay-amt" style={{ fontSize: 28 }}>{money0(prem.data)}</div>
        <div className="sub">{now.amount ? `Your bonus so far: ${money0(now.amount)}. ` : ''}{next ? `${money0(Number(next.min) - prem.data)} more to reach ${money0(Number(next.amount))}.` : 'Top bonus reached!'}</div>
      </div>
      {/* one step per bonus: each fills from the bonus before it to this one */}
      <div className="pay-steps" style={{ gridTemplateColumns: `repeat(${sorted.length}, 1fr)` }} role="img" aria-label={`${money0(prem.data)} written`}>
        {sorted.map((t, i) => {
          const lo = i ? Number(sorted[i - 1].min) : 0, hi = Number(t.min)
          const fill = Math.max(0, Math.min(1, (prem.data! - lo) / (hi - lo)))
          return (
            <div key={t.min} className={'pay-step' + (fill >= 1 ? ' hit' : '')}>
              <div className="pay-bar"><div className="pay-fill" style={{ width: fill * 100 + '%' }} /></div>
              <div className="strong">{money0(Number(t.amount))}</div>
              <div className="sub">at {money0(hi)}</div>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
