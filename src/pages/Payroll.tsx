import { useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { useFolio } from '../components/FolioPicker'
import { Empty, ErrorBox, Loading, PageHead, Panel, Tile, Tiles } from '../components/ui'
import { openDoc, type Doc } from '../lib/books'
import { getSdrPeriods, getSdrQuoteNumbers, getSdrTransfers } from '../lib/data'
import { downloadSheet } from '../lib/excelExport'
import { mdy, money2, shortDate, todayPacific } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'
import { agencyBonus, checkFor, folioFor, nextPay, stepPay } from '../lib/payday'
import { workedMinutes } from './Licensing'
import { bonusCounts, folioBonus } from '../lib/retention'
import { payrollLines, type Comm, type Punch, type Staff } from '../lib/payrollCalc'

/** Office payroll: what everyone in the office is owed on one payday, downloaded as one workbook, with the payroll
 *  files (the provider's report, a signed copy) uploaded back to that payday. Payroll is paid twice a month:
 *    the 21st — hours for the 1st–15th, plus producers' commission and SDR bonuses, a month behind (Oct 21 pays the
 *               folio that closed Sep 20, and September's transfers)
 *    the 5th  — hours for the 16th–end of the previous month (no commission)
 *  Salaried staff get 1/24 of their salary every payday, no commission, and on the 21st a cash bonus on the agency's
 *  premium for the folio.
 *  For the owner and admins only: it shows everyone's pay. */

interface PayDoc extends Doc { created_at?: string }

const hm = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`

/** The payday dropdown: the next two paydays and the past year's, newest first (plus the one picked, if older). */
function paydays(picked: string) {
  let d = stepPay(stepPay(nextPay(todayPacific()), 1), 1)
  const out: string[] = []
  for (let i = 0; i < 28; i++) { out.push(d); d = stepPay(d, -1) }
  return out.includes(picked) ? out : [...out, picked]
}

export default function Payroll() {
  const { me } = useAuth()
  // the next payday to get ready
  const [pay, setPay] = useState(() => nextPay(todayPacific()))
  const check = checkFor(pay)
  const { folios } = useFolio()
  const folio = folioFor(pay, folios)
  const periods = useAsync(getSdrPeriods, [])
  // SDR bonuses are paid on the 21st for the previous month's transfers
  const period = check.commission ? periods.data?.find((p) => p.pay_date === pay) : undefined
  const [reload, setReload] = useState(0)

  const hours = useAsync(async () => {
    const [staff, punches] = await Promise.all([
      supabase.from('hr_staff').select('*').order('name').then((r) => { if (r.error) throw r.error; return r.data as Staff[] }),
      supabase.from('hr_punches').select('*').gte('work_date', check.from).lte('work_date', check.to).order('work_date').then((r) => { if (r.error) throw r.error; return r.data as Punch[] }),
    ])
    return { staff, punches }
  }, [check.from, check.to])
  const comm = useAsync(async () => {
    if (!folio) return null
    const { data, error } = await supabase.functions.invoke('commissions', { body: { folio: folio.start_date, scope: 'office' } })
    if (error) {
      const msg = await (error as any).context?.json?.().then((j: any) => j.error).catch(() => null)
      throw new Error(msg || error.message)
    }
    return (data.results || []) as Comm[]
  }, [folio?.start_date])
  const sdr = useAsync(async () => (period ? getSdrTransfers(period.month) : []), [period?.month])
  // the Apex quote # each SDR entered per transfer, for reconciling the SDR bonus
  const apex = useAsync(async () => (period ? getSdrQuoteNumbers(period.month) : new Map()), [period?.month])
  // the agency's premium for the folio paid on the 21st: salaried staff's cash bonuses ride on it
  const agencyPrem = useAsync(async () => {
    if (!folio) return null
    const { data, error } = await supabase.rpc('agency_premium', { p_from: folio.start_date, p_to: folio.end_date })
    if (error) throw error
    return Number(data) || 0
  }, [folio?.start_date, folio?.end_date])
  // gated folio bonuses (the retention role): the folio paid today, only when its four gates are met
  const gated = useAsync(async () => {
    const list = (hours.data?.staff || []).filter((s) => s.salary_annual && s.bonus_period === 'folio_gated' && s.bonus_tiers?.length && s.active)
    if (!folio || !bonusCounts(folio) || !list.length) return {} as Record<string, Awaited<ReturnType<typeof folioBonus>>>
    const out: Record<string, Awaited<ReturnType<typeof folioBonus>>> = {}
    for (const s of list) out[s.name] = await folioBonus(s.name, s.bonus_tiers, folio, todayPacific())
    return out
  }, [hours.data, folio?.start_date, folio?.end_date])
  const prefix = `${me?.agency_id}/payroll/${pay}/`
  const files = useAsync(async () => {
    const { data, error } = await supabase.from('documents').select('*').eq('category', 'payroll').like('storage_path', prefix + '%').order('storage_path', { ascending: false })
    if (error) throw error
    return data as PayDoc[]
  }, [prefix, reload])

  const qb = Number(period?.qualified_transfer_bonus) || 0, bb = Number(period?.bound_policy_bonus) || 0

  const lines = useMemo(() => (hours.data ? payrollLines({ staff: hours.data.staff, punches: hours.data.punches, comm: comm.data || [], sdr: sdr.data || [], qb, bb, check, agencyPrem: agencyPrem.data ?? null, gated: gated.data || {} }) : null),
    [hours.data, comm.data, sdr.data, qb, bb, check, agencyPrem.data, gated.data])

  const hoursLabel = `${shortDate(check.from)} – ${shortDate(check.to, true)}`
  const folioLabel = folio ? `${shortDate(folio.start_date)} – ${shortDate(folio.end_date, true)}` : ''
  const label = `${mdy(pay)} payroll`
  const download = () => {
    if (!lines) return
    const r2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
    downloadSheet(`Office_Payroll_${pay}.xlsx`, [
      ['Name', 'Role', 'Hours', 'Hourly pay', 'Salary', 'Commission', 'SDR bonus', 'Agency bonus', 'Total pay'],
      ...lines.who.map((p) => [p.name, p.role, r2(p.hours), r2(p.pay), r2(p.salary), r2(p.comm), r2(p.bonus), r2(p.cash), r2(p.total)]),
      [], [`Hours · ${hoursLabel}`],
      ['Name', 'Role', 'Days', 'Hours', 'Rate', 'Hourly pay'],
      ...lines.hourly.map((h) => [h.name, h.role, h.days, r2(h.mins / 60), h.rate != null ? r2(h.rate) : '', r2(h.pay)]),
      ...(check.commission ? [
        [], [`Commission · folio ${folioLabel || 'not found'}`],
        ['Producer', 'Total premium', 'Policies', 'Qualifies', 'Tier rate', 'Commission'],
        ...(comm.data || []).map((c) => [c.producer, r2(c.totalPremium), c.policies, c.qualifies ? 'Yes' : 'No', Math.round(c.tierRate * 1000) / 10 + '%', r2(c.total)]),
        [], [`SDR bonus · ${period?.period_label || '—'} transfers · $${qb} per qualified, $${bb} per bound (in place of the $${qb})`],
        ['SDR', 'Transfers', 'Qualified', 'Bound', 'SDR bonus', 'Missing Apex quote #'],
        ...[...lines.sdrs].map(([n, o]) => [n, o.logged, o.qualified, o.bound, r2(o.qOnly * qb + o.bound * bb), (sdr.data || []).filter((t) => t.sdr === n && !apex.data?.get(t.lead_id)).length]),
        [], [`SDR transfers to reconcile · ${period?.period_label || '—'} · match each Apex quote # to the bonus it earns`],
        ['SDR', 'Transferred', 'Client', 'Producer', 'AgencyZoom lead #', 'Apex quote #', 'Quoted premium', 'Qualified', 'Bound', 'Bonus', 'Quote # entered by', 'Entered'],
        ...[...(sdr.data || [])].sort((a, b) => a.sdr.localeCompare(b.sdr) || String(a.date_time).localeCompare(String(b.date_time))).map((t) => {
          const q = apex.data?.get(t.lead_id)
          return [t.sdr, String(t.date_time).slice(0, 10), t.client, t.producer, t.lead_id, q?.quote_number || 'MISSING', r2(Number(t.az_quote_premium) || 0),
            t.az_qualifies ? 'Yes' : 'No', t.bound ? 'Yes' : 'No', r2(t.bound ? bb : t.az_qualifies ? qb : 0), q?.entered_by || '', q ? String(q.updated_at).slice(0, 10) : '']
        }),
        ...(lines.salaried.length ? [
          [], [`Agency bonus · folio ${folioLabel || 'not found'} · agency premium ${r2(agencyPrem.data || 0)}`],
          ['Name', 'Annual salary', 'Bonus tiers', 'Agency bonus', 'Measured on', 'Gates'],
          ...lines.salaried.map((s) => { const mb = gated.data?.[s.name]; return [s.name, r2(Number(s.salary_annual)), (s.bonus_tiers || []).map((t) => `${t.min}: ${t.amount}`).join('; '),
            s.bonus_period === 'folio_gated' ? r2(mb?.amount || 0) : r2(agencyBonus(s.bonus_tiers, agencyPrem.data || 0).amount),
            ...(mb ? [`folio ${mb.period.start_date} to ${mb.period.end_date} agency premium ${r2(mb.premium)}`, mb.eligible ? 'all gates met' : 'on hold: ' + mb.gates.filter((g) => !g.ok).map((g) => g.label).join(', ')] : [])] }),
        ] : []),
      ] : []),
      [], ['Daily punches'],
      ['Name', 'Date', 'Start', 'End', 'Breaks', 'Worked hours'],
      ...(hours.data?.punches || []).map((p) => [p.name, p.work_date, p.start_time, p.end_time, (p.breaks || []).map((x) => x.join('-')).join('; '), r2(workedMinutes(p) / 60)]),
    ], { sheet: `Payroll ${pay}` })
  }

  const err = hours.error || comm.error || sdr.error || apex.error || periods.error || agencyPrem.error || gated.error
  return (
    <>
      <PageHead kicker="Agency Management" title="Office Payroll" sub="Payroll is paid on the 5th and the 21st: the 5th for hours from the 16th to the end of the month, the 21st for hours from the 1st to the 15th, plus commission for last month’s folio and SDR bonuses for last month’s transfers. Download it for the payroll run, then upload the payroll files back here." />
      <Panel title={`Payday ${mdy(pay)}`} sub={check.commission ? `Hours ${hoursLabel} · commission for the folio ${folioLabel || 'closed last month (not set up yet)'} · SDR bonus for ${period?.period_label || 'last month'} transfers` : `Hours ${hoursLabel} · no commission on the 5th (commission is paid on the 21st)`}
        right={<div className="filters">
          <button className="btn-ghost" onClick={() => setPay(stepPay(pay, -1))} aria-label="Previous payday">‹</button>
          <select className="fld pay-pick" value={pay} onChange={(e) => setPay(e.target.value)} aria-label="Payday">
            {paydays(pay).map((d) => <option key={d} value={d}>{mdy(d)}{d.endsWith('-21') ? ' · hours + commission' : ' · hours'}{d === nextPay(todayPacific()) ? ' (next payday)' : ''}</option>)}
          </select>
          <button className="btn-ghost" onClick={() => setPay(stepPay(pay, 1))} aria-label="Next payday">›</button>
          <button className="btn-primary" onClick={download} disabled={!lines || !!err || (check.commission && !apex.data)}>Download Excel</button>
        </div>}>
        {err ? <ErrorBox error={err} /> : !lines ? <Loading what="Adding up payroll" /> : (
          <>
            <Tiles>
              <Tile label="Total payroll" value={money2(lines.who.reduce((s, p) => s + p.total, 0))} sub={`${lines.who.length} people`} />
              <Tile label="Hourly pay" value={money2(lines.who.reduce((s, p) => s + p.pay, 0))} sub={`${hm(lines.hourly.reduce((s, h) => s + h.mins, 0))} worked · ${hoursLabel}`} />
              {check.commission && <Tile label="Commission" value={comm.loading && !comm.data ? '…' : money2(lines.who.reduce((s, p) => s + p.comm, 0))} sub={folioLabel || 'folio not set up yet'} />}
              {lines.salaried.length > 0 && <Tile label="Salary" value={money2(lines.who.reduce((s, p) => s + p.salary, 0))} sub={`${lines.salaried.length} salaried · 1/24 of the year`} />}
              {check.commission && lines.salaried.length > 0 && <Tile label="Agency bonus" value={agencyPrem.data == null ? '…' : money2(lines.who.reduce((s, p) => s + p.cash, 0))} sub={agencyPrem.data == null ? folioLabel : `agency wrote ${money2(agencyPrem.data)}`} />}
              {check.commission && <Tile label="SDR bonus" value={money2(lines.who.reduce((s, p) => s + p.bonus, 0))} sub={period ? `${period.period_label} transfers` : 'no SDR month for this payday'} />}
            </Tiles>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Name</th><th>Role</th><th className="r">Hours</th><th className="r">Hourly pay</th><th className="r">Salary</th>{check.commission && <><th className="r">Commission</th><th className="r">SDR bonus</th><th className="r">Agency bonus</th></>}<th className="r">Total pay</th></tr></thead>
                <tbody>{lines.who.map((p) => (
                  <tr key={p.name}><td className="strong">{p.name}</td><td>{p.role}</td><td className="r">{p.hours ? hm(p.hours * 60) : '—'}</td>
                    <td className="r mono">{p.pay ? money2(p.pay) : '—'}</td><td className="r mono">{p.salary ? money2(p.salary) : '—'}</td>
                    {check.commission && <><td className="r mono">{p.comm ? money2(p.comm) : '—'}</td><td className="r mono">{p.bonus ? money2(p.bonus) : '—'}</td><td className="r mono">{p.cash ? money2(p.cash) : '—'}</td></>}
                    <td className="r mono strong">{money2(p.total)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            {!lines.who.length && <Empty>Nobody has pay on this payday yet.</Empty>}
            <div className="sub" style={{ marginTop: 8 }}>Hours come from the timesheets. Someone whose last day falls in the period still gets their final hours here. The download has each part in detail, with the daily punches.</div>
          </>
        )}
      </Panel>
      <PayrollFiles files={files.data} error={files.error} prefix={prefix} label={label} range={{ from: pay, to: pay }} onDone={() => setReload((n) => n + 1)} />
    </>
  )
}

function PayrollFiles({ files, error, prefix, label, range, onDone }: { files: PayDoc[] | null | undefined; error: unknown; prefix: string; label: string; range: { from: string; to: string }; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const upload = async (list: FileList | null) => {
    if (!list?.length) return
    try {
      for (const f of Array.from(list)) {
        setBusy(`Uploading ${f.name}…`)
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
        const safe = f.name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(-80)
        const path = `${prefix}${stamp}-${safe}`
        const up = await supabase.storage.from('documents').upload(path, f, { contentType: f.type || 'application/octet-stream' })
        if (up.error) throw up.error
        const { error } = await supabase.from('documents').insert({
          id: `payroll-${range.from}-${stamp}-${Math.random().toString(36).slice(2, 7)}`, category: 'payroll', account_id: null, policy_number: null,
          title: `${label}: ${f.name}`, file_name: f.name, mime: f.type || 'application/octet-stream', storage_path: path, size_bytes: f.size, admin_only: true, uploaded: true,
        })
        if (error) throw error
      }
      setBusy(null); onDone()
    } catch (e) { setBusy('Upload failed: ' + String((e as Error)?.message || e)) }
  }
  return (
    <Panel title="Payroll files" sub={`Files for ${label}, seen only by the owner and admins.`} right={<>
      <input ref={input} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = '' }} />
      <button className="btn-ghost" onClick={() => input.current?.click()} disabled={!!busy && busy.startsWith('Uploading')}>Upload files</button>
    </>}>
      {busy && <div className="note-box" role="status">{busy}</div>}
      {error ? <ErrorBox error={error} /> : !files ? <Loading /> : files.length ? (
        <table className="tbl">
          <thead><tr><th>File</th><th>Uploaded</th><th></th></tr></thead>
          <tbody>{files.map((d) => (
            <tr key={d.id}><td className="strong">{d.file_name}</td><td className="sub">{d.created_at ? new Date(d.created_at).toLocaleString('en-US') : ''}</td>
              <td className="r"><div className="row-actions" style={{ justifyContent: 'flex-end' }}><button className="linkbtn" onClick={() => openDoc(d)}>Open</button><button className="linkbtn" onClick={() => openDoc(d, true)}>Download</button></div></td></tr>
          ))}</tbody>
        </table>
      ) : <Empty>No payroll files for this period yet. Upload the payroll provider’s report or the signed payroll here.</Empty>}
    </Panel>
  )
}
