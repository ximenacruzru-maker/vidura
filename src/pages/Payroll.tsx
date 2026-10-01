import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { FolioPicker, folioName, useFolio } from '../components/FolioPicker'
import { Empty, ErrorBox, Loading, PageHead, Panel, Tile, Tiles } from '../components/ui'
import { openDoc, type Doc } from '../lib/books'
import { getSdrPeriods, getSdrTransfers } from '../lib/data'
import { downloadSheet } from '../lib/excelExport'
import { addDays, mdy, money2, shortDate, todayPacific } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'
import { workedMinutes } from './Licensing'

/** Office payroll: for one pay period, what everyone in the office is owed — hours × rate for hourly staff, the
 *  producers' commission for the chosen folio and the SDRs' bonus for the chosen month — downloaded as one
 *  workbook, with the payroll files (the provider's report, a signed copy) uploaded back to the period.
 *  For admins and whoever runs payroll (a VA, or anyone given Office payroll on Team & access). */

interface Staff { name: string; role: string | null; hourly: boolean; rate: number | null; active: boolean }
interface Punch { id: number; name: string; work_date: string; start_time: string | null; end_time: string | null; breaks: [string, string][]; edited: boolean }
interface Comm { producer: string; totalPremium: number; policies: number; qualifies: boolean; tierRate: number; total: number }
interface PayDoc extends Doc { created_at?: string }

/** Semi-monthly pay periods: the 1st–15th and the 16th–end of the month. */
function periodOf(day: string) {
  const [y, m, d] = day.split('-').map(Number), pad = (n: number) => String(n).padStart(2, '0')
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return d <= 15 ? { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-15` } : { from: `${y}-${pad(m)}-16`, to: `${y}-${pad(m)}-${pad(last)}` }
}
const first = (n: string) => n.trim().split(/\s+/)[0].toLowerCase()
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`

export default function Payroll() {
  const { me } = useAuth()
  const today = todayPacific()
  // the last pay period that has ended
  const [range, setRange] = useState(() => periodOf(addDays(periodOf(today).from, -1)))
  const step = (dir: -1 | 1) => setRange((r) => periodOf(dir < 0 ? addDays(r.from, -1) : addDays(r.to, 1)))
  const { folio } = useFolio()
  const periods = useAsync(getSdrPeriods, [])
  const [month, setMonth] = useState('')
  // the SDR month paid in this pay period (paid the 21st of the next month), else the latest open one
  useEffect(() => {
    const ps = periods.data || []
    const paid = ps.find((p) => p.pay_date >= range.from && p.pay_date <= range.to)
    setMonth((paid || ps.find((p) => !p.closed) || ps[0])?.month || '')
  }, [periods.data, range.from, range.to])
  const [reload, setReload] = useState(0)

  const hours = useAsync(async () => {
    const [staff, punches] = await Promise.all([
      supabase.from('hr_staff').select('*').order('name').then((r) => { if (r.error) throw r.error; return r.data as Staff[] }),
      supabase.from('hr_punches').select('*').gte('work_date', range.from).lte('work_date', range.to).order('work_date').then((r) => { if (r.error) throw r.error; return r.data as Punch[] }),
    ])
    return { staff, punches }
  }, [range.from, range.to])
  const comm = useAsync(async () => {
    if (!folio) return null
    const { data, error } = await supabase.functions.invoke('commissions', { body: { folio: folio.start_date, scope: 'office' } })
    if (error) {
      const msg = await (error as any).context?.json?.().then((j: any) => j.error).catch(() => null)
      throw new Error(msg || error.message)
    }
    return (data.results || []) as Comm[]
  }, [folio?.start_date])
  const sdr = useAsync(async () => (month ? getSdrTransfers(month) : []), [month])
  const prefix = `${me?.agency_id}/payroll/${range.from}_${range.to}/`
  const files = useAsync(async () => {
    const { data, error } = await supabase.from('documents').select('*').eq('category', 'payroll').like('storage_path', prefix + '%').order('storage_path', { ascending: false })
    if (error) throw error
    return data as PayDoc[]
  }, [prefix, reload])

  const period = periods.data?.find((p) => p.month === month)
  const qb = Number(period?.qualified_transfer_bonus) || 0, bb = Number(period?.bound_policy_bonus) || 0

  const lines = useMemo(() => {
    if (!hours.data) return null
    const hourly = hours.data.staff.filter((s) => s.hourly && s.active).map((s) => {
      const ps = hours.data!.punches.filter((p) => p.name === s.name)
      const mins = ps.reduce((a, p) => a + workedMinutes(p), 0)
      return { name: s.name, role: s.role || '', days: ps.length, mins, rate: s.rate, pay: s.rate ? Math.round((mins / 60) * s.rate * 100) / 100 : 0 }
    })
    const sdrs = new Map<string, { logged: number; qualified: number; bound: number }>()
    for (const t of sdr.data || []) {
      const o = sdrs.get(t.sdr) || { logged: 0, qualified: 0, bound: 0 }
      o.logged++; if (t.az_qualifies) o.qualified++; if (t.bound) o.bound++
      sdrs.set(t.sdr, o)
    }
    // one line per person: SDR tags carry first names, so they join a full name with the same first name
    const people = new Map<string, { name: string; role: string; hours: number; pay: number; comm: number; bonus: number }>()
    const person = (name: string, role = '') => {
      const k = first(name)
      const p = people.get(k) || { name, role, hours: 0, pay: 0, comm: 0, bonus: 0 }
      if (name.length > p.name.length) p.name = name
      if (!p.role) p.role = role
      people.set(k, p); return p
    }
    for (const h of hourly) { const p = person(h.name, h.role); p.hours += h.mins / 60; p.pay += h.pay }
    for (const c of comm.data || []) if (c.total) person(c.producer, 'Producer').comm += c.total
    for (const [n, o] of sdrs) person(n, 'SDR').bonus += o.qualified * qb + o.bound * bb
    const who = [...people.values()].map((p) => ({ ...p, total: p.pay + p.comm + p.bonus })).filter((p) => p.total || p.hours).sort((a, b) => b.total - a.total)
    return { hourly, sdrs, who }
  }, [hours.data, comm.data, sdr.data, qb, bb])

  const label = `${shortDate(range.from)} – ${shortDate(range.to, true)}`
  const download = () => {
    if (!lines) return
    const r2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
    downloadSheet(`Office_Payroll_${range.from}_to_${range.to}.xlsx`, [
      ['Name', 'Role', 'Hours', 'Hourly pay', 'Commission', 'SDR bonus', 'Total pay'],
      ...lines.who.map((p) => [p.name, p.role, r2(p.hours), r2(p.pay), r2(p.comm), r2(p.bonus), r2(p.total)]),
      [], [`Hours · ${label}`],
      ['Name', 'Role', 'Days', 'Hours', 'Rate', 'Hourly pay'],
      ...lines.hourly.map((h) => [h.name, h.role, h.days, r2(h.mins / 60), h.rate != null ? r2(h.rate) : '', r2(h.pay)]),
      [], [`Commission · folio ${folio ? folioName(folio) : ''}`],
      ['Producer', 'Total premium', 'Policies', 'Qualifies', 'Tier rate', 'Commission'],
      ...(comm.data || []).map((c) => [c.producer, r2(c.totalPremium), c.policies, c.qualifies ? 'Yes' : 'No', Math.round(c.tierRate * 1000) / 10 + '%', r2(c.total)]),
      [], [`SDR bonus · ${period?.period_label || month} transfers, paid ${period ? mdy(period.pay_date) : ''} · $${qb} per qualified, $${bb} per bound`],
      ['SDR', 'Transfers', 'Qualified', 'Bound', 'SDR bonus'],
      ...[...lines.sdrs].map(([n, o]) => [n, o.logged, o.qualified, o.bound, r2(o.qualified * qb + o.bound * bb)]),
      [], ['Daily punches'],
      ['Name', 'Date', 'Start', 'End', 'Breaks', 'Worked hours'],
      ...(hours.data?.punches || []).map((p) => [p.name, p.work_date, p.start_time, p.end_time, (p.breaks || []).map((x) => x.join('-')).join('; '), r2(workedMinutes(p) / 60)]),
    ], { sheet: 'Office payroll' })
  }

  const err = hours.error || comm.error || sdr.error || periods.error
  return (
    <>
      <PageHead kicker="Agency" title="Office payroll" sub="Everyone’s pay for a pay period: hours × rate, commission and SDR bonus. Download it for the payroll run, then upload the payroll files back here." />
      <Panel title={`Pay period ${label}`} right={<div className="filters">
        <button className="btn-ghost" onClick={() => step(-1)} aria-label="Previous pay period">‹ Previous</button>
        <input className="fld" type="date" value={range.from} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} aria-label="From" />
        <input className="fld" type="date" value={range.to} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} aria-label="To" />
        <button className="btn-ghost" onClick={() => step(1)} aria-label="Next pay period">Next ›</button>
      </div>}>
        <div className="filters" style={{ marginBottom: 10 }}>
          <FolioPicker />
          <label className="picker" style={{ maxWidth: '100%' }}>SDR month
            <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ maxWidth: '100%' }}>
              {(periods.data || []).map((p) => <option key={p.month} value={p.month}>{p.period_label}{p.closed ? ' (paid)' : ''}</option>)}
            </select>
          </label>
          <button className="btn-primary" onClick={download} disabled={!lines || !!err}>Download Excel</button>
        </div>
        {err ? <ErrorBox error={err} /> : !lines ? <Loading what="Adding up payroll" /> : (
          <>
            <Tiles>
              <Tile label="Total payroll" value={money2(lines.who.reduce((s, p) => s + p.total, 0))} sub={`${lines.who.length} people`} />
              <Tile label="Hourly pay" value={money2(lines.who.reduce((s, p) => s + p.pay, 0))} sub={`${hm(lines.hourly.reduce((s, h) => s + h.mins, 0))} worked`} />
              <Tile label="Commission" value={comm.loading && !comm.data ? '…' : money2(lines.who.reduce((s, p) => s + p.comm, 0))} sub={folio ? folioName(folio) : ''} />
              <Tile label="SDR bonus" value={money2(lines.who.reduce((s, p) => s + p.bonus, 0))} sub={period ? `${period.period_label} · paid ${shortDate(period.pay_date)}` : ''} />
            </Tiles>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Name</th><th>Role</th><th className="r">Hours</th><th className="r">Hourly pay</th><th className="r">Commission</th><th className="r">SDR bonus</th><th className="r">Total pay</th></tr></thead>
                <tbody>{lines.who.map((p) => (
                  <tr key={p.name}><td className="strong">{p.name}</td><td>{p.role}</td><td className="r">{p.hours ? hm(p.hours * 60) : '—'}</td>
                    <td className="r mono">{p.pay ? money2(p.pay) : '—'}</td><td className="r mono">{p.comm ? money2(p.comm) : '—'}</td><td className="r mono">{p.bonus ? money2(p.bonus) : '—'}</td>
                    <td className="r mono strong">{money2(p.total)}</td></tr>
                ))}</tbody>
              </table>
            </div>
            {!lines.who.length && <Empty>Nobody has pay in this period yet.</Empty>}
            <div className="sub" style={{ marginTop: 8 }}>Hours come from the timesheets for these dates; commission from the folio picked above; SDR bonuses from the month picked above. The download has each part in detail, with the daily punches.</div>
          </>
        )}
      </Panel>
      <PayrollFiles files={files.data} error={files.error} prefix={prefix} label={label} range={range} onDone={() => setReload((n) => n + 1)} />
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
          title: `Payroll ${label}: ${f.name}`, file_name: f.name, mime: f.type || 'application/octet-stream', storage_path: path, size_bytes: f.size, admin_only: true, uploaded: true,
        })
        if (error) throw error
      }
      setBusy(null); onDone()
    } catch (e) { setBusy('Upload failed: ' + String((e as Error)?.message || e)) }
  }
  return (
    <Panel title="Payroll files" sub={`Files for ${label}, seen only by admins and whoever runs payroll.`} right={<>
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
