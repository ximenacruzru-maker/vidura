import { useState } from 'react'
import { useAuth } from '../auth'
import { Empty, ErrorBox, Loading, PageHead, Panel, Tabs, Tile, Tiles } from '../components/ui'
import { daysUntil, getDocs, openDoc } from '../lib/books'
import { can } from '../lib/access'
import { addDays, mdy, money2, todayPacific } from '../lib/format'
import { downloadSheet } from '../lib/excelExport'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'
import { RenewPill } from './Books'

interface License { id: number; name: string; role: string | null; state: string | null; authority: string | null; license_type: string | null; number: string | null; effective: string | null; expires: string | null; quals: { q: string; eff: string }[]; verify_url: string | null; document_id: string | null; archived_on: string | null; archived_reason: string | null }
interface Staff { name: string; role: string | null; hourly: boolean; rate: number | null; active: boolean; hired_on: string | null; left_on: string | null; leave_reason: string | null }
interface Punch { id: number; name: string; work_date: string; start_time: string | null; end_time: string | null; breaks: [string, string][]; edited: boolean }

/** "9:15AM" -> minutes after midnight */
export function clock(t: string | null) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP])M$/i.exec((t || '').trim())
  if (!m) return null
  let h = Number(m[1]) % 12
  if (m[3].toUpperCase() === 'P') h += 12
  return h * 60 + Number(m[2])
}
export function workedMinutes(p: Punch) {
  const s = clock(p.start_time), e = clock(p.end_time)
  if (s == null || e == null || e <= s) return 0
  const br = (p.breaks || []).reduce((a, [b1, b2]) => { const x = clock(b1), y = clock(b2); return a + (x != null && y != null && y > x ? y - x : 0) }, 0)
  return e - s - br
}
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`

export default function Licensing() {
  const { me } = useAuth()
  const admin = can(me, 'hr')
  const [tab, setTab] = useState<'licenses' | 'time' | 'staff'>('licenses')
  const tabs = [{ key: 'licenses' as const, label: 'Licenses' }, ...(admin ? [{ key: 'time' as const, label: 'Timesheets' }, { key: 'staff' as const, label: 'Staff & pay rates' }] : [])]
  return (
    <>
      <PageHead kicker="People" title={admin ? 'HR & licensing' : 'Licensing'} sub={admin ? 'Licenses for everyone; timesheets and pay rates are visible to admins only.' : undefined} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'licenses' && <Licenses admin={admin} />}
      {tab === 'time' && admin && <Timesheets />}
      {tab === 'staff' && admin && <StaffRates />}
    </>
  )
}

/** Last day and reason, asked when someone leaves; null if cancelled. */
function askLeaving(name: string) {
  const day = prompt(`${name}'s last day (YYYY-MM-DD):`, todayPacific())
  if (!day) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { alert('Use a date like 2026-09-17.'); return null }
  const why = prompt('Why they left (kept in their employment record):', 'Resigned') ?? ''
  return { day, why: why.trim() }
}

function Licenses({ admin }: { admin: boolean }) {
  const today = todayPacific()
  const [reload, setReload] = useState(0)
  const { data, error } = useAsync(async () => {
    const [lic, docs] = await Promise.all([
      supabase.from('licenses').select('*').order('expires').then((r) => { if (r.error) throw r.error; return r.data as License[] }),
      getDocs(),
    ])
    return { lic, docs }
  }, [reload])
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  // archived licenses (people who left) are kept, but out of the active list and the renewal count
  const active = data.lic.filter((l) => !l.archived_on), archived = data.lic.filter((l) => l.archived_on).sort((a, b) => (b.archived_on! < a.archived_on! ? -1 : 1))
  const soon = active.filter((l) => { const d = daysUntil(l.expires, today); return d != null && d <= 90 })
  const archive = async (l: License) => {
    const a = askLeaving(l.name); if (!a) return
    const { error } = await supabase.from('licenses').update({ archived_on: a.day, archived_reason: a.why ? `${a.why} — last day ${mdy(a.day)}` : `Last day ${mdy(a.day)}` }).eq('id', l.id)
    if (error) alert(error.message); else setReload((n) => n + 1)
  }
  const restore = async (l: License) => {
    if (!confirm(`Put ${l.name}'s license back in the active list?`)) return
    const { error } = await supabase.from('licenses').update({ archived_on: null, archived_reason: null }).eq('id', l.id)
    if (error) alert(error.message); else setReload((n) => n + 1)
  }
  const card = (l: License) => {
    const doc = data.docs.find((d) => d.id === l.document_id)
    return (
      <div key={l.id} className="card">
        <div className="card-t">{l.name}</div>
        <div className="sub">{l.role} · {l.state} {l.license_type}</div>
        <div><b className="mono">#{l.number}</b></div>
        <div className="card-s">Effective {l.effective ? mdy(l.effective) : '—'} · expires {l.expires ? mdy(l.expires) : '—'} {!l.archived_on && <RenewPill days={daysUntil(l.expires, today)} />}</div>
        {l.quals?.length > 0 && <div className="card-s">{l.quals.map((q) => q.q + (q.eff ? ` (${q.eff})` : '')).join(' · ')}</div>}
        {l.archived_on && <div className="card-s"><span className="pill pill-muted">Archived {mdy(l.archived_on)}</span> {l.archived_reason}</div>}
        <div className="row-actions">
          {doc && <button className="linkbtn" onClick={() => openDoc(doc)}>View license</button>}
          {l.verify_url && <a href={l.verify_url} target="_blank" rel="noreferrer">Verify with {l.authority?.replace('California ', 'CA ') || 'state'} ↗</a>}
          {admin && (l.archived_on ? <button className="linkbtn" onClick={() => restore(l)}>Restore</button> : <button className="linkbtn" onClick={() => archive(l)}>Archive</button>)}
        </div>
      </div>
    )
  }
  return (
    <>
      <Tiles>
        <Tile label="Licensed staff" value={active.length} sub={archived.length ? `${archived.length} archived` : undefined} />
        <Tile label="Renewing within 90 days" value={soon.length} sub={soon.map((l) => l.name.split(' ')[0]).join(', ') || 'none'} tone={soon.length ? 'warn' : 'good'} />
      </Tiles>
      <div className="cards">{active.map(card)}</div>
      {archived.length > 0 && (
        <Panel title={`Archived licenses (${archived.length})`} sub="People who have left the agency. Kept for the record; not counted for renewals.">
          <div className="cards">{archived.map(card)}</div>
        </Panel>
      )}
    </>
  )
}

function Timesheets() {
  const today = todayPacific()
  const [from, setFrom] = useState(addDays(today, -13))
  const [to, setTo] = useState(today)
  const [reload, setReload] = useState(0)
  const [edit, setEdit] = useState<Partial<Punch> | null>(null)
  const { data, error } = useAsync(async () => {
    const [staff, punches] = await Promise.all([
      supabase.from('hr_staff').select('*').order('name').then((r) => { if (r.error) throw r.error; return r.data as Staff[] }),
      supabase.from('hr_punches').select('*').gte('work_date', from).lte('work_date', to).order('work_date', { ascending: false }).then((r) => { if (r.error) throw r.error; return r.data as Punch[] }),
    ])
    return { staff, punches }
  }, [from, to, reload])
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const hourly = data.staff.filter((s) => s.hourly && s.active)
  const rows = hourly.map((s) => {
    const mins = data.punches.filter((p) => p.name === s.name).reduce((a, p) => a + workedMinutes(p), 0)
    return { s, mins, pay: s.rate ? (mins / 60) * s.rate : null, days: data.punches.filter((p) => p.name === s.name).length }
  })

  const save = async () => {
    if (!edit?.name || !edit.work_date) { alert('Pick a person and a date.'); return }
    for (const t of [edit.start_time, edit.end_time]) if (t && clock(t) == null) { alert('Times should look like 9:15AM.'); return }
    const b = (edit.breaks || []).filter(([x, y]) => x && y)
    const { error } = await supabase.from('hr_punches').upsert({ name: edit.name, work_date: edit.work_date, start_time: edit.start_time || null, end_time: edit.end_time || null, breaks: b, edited: true }, { onConflict: 'agency_id,name,work_date' })
    if (error) alert(error.message); else { setEdit(null); setReload((n) => n + 1) }
  }

  return (
    <>
      <Panel title="Pay period" right={<div className="filters">
        <input className="fld" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="fld" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <button className="btn-ghost" onClick={() => setEdit({ work_date: today, breaks: [['', '']] })}>+ Add or fix a day</button>
        <button className="btn-ghost" onClick={() => downloadSheet(`timesheets-${from}-to-${to}.xlsx`, [
          ['Name', 'Date', 'Start', 'End', 'Breaks', 'Worked (h)'],
          ...data.punches.map((p) => [p.name, p.work_date, p.start_time, p.end_time, (p.breaks || []).map((x) => x.join('-')).join('; '), (workedMinutes(p) / 60).toFixed(2)]),
        ], { sheet: 'Timesheets' })}>Export Excel</button>
      </div>}>
        {edit && (
          <div className="plan">
            <div className="form-grid">
              <label>Person<select className="fld" value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })}><option value="">—</option>{hourly.map((s) => <option key={s.name}>{s.name}</option>)}</select></label>
              <label>Date<input className="fld" type="date" value={edit.work_date || ''} onChange={(e) => setEdit({ ...edit, work_date: e.target.value })} /></label>
              <label>Start<input className="fld" placeholder="9:00AM" value={edit.start_time || ''} onChange={(e) => setEdit({ ...edit, start_time: e.target.value })} /></label>
              <label>End<input className="fld" placeholder="5:00PM" value={edit.end_time || ''} onChange={(e) => setEdit({ ...edit, end_time: e.target.value })} /></label>
              <label>Break out<input className="fld" placeholder="1:00PM" value={edit.breaks?.[0]?.[0] || ''} onChange={(e) => setEdit({ ...edit, breaks: [[e.target.value, edit.breaks?.[0]?.[1] || '']] })} /></label>
              <label>Break in<input className="fld" placeholder="1:30PM" value={edit.breaks?.[0]?.[1] || ''} onChange={(e) => setEdit({ ...edit, breaks: [[edit.breaks?.[0]?.[0] || '', e.target.value]] })} /></label>
            </div>
            <div className="row-actions" style={{ marginTop: 10 }}><button className="btn-primary" onClick={save}>Save day</button><button className="btn-ghost" onClick={() => setEdit(null)}>Cancel</button></div>
          </div>
        )}
        <table className="tbl">
          <thead><tr><th>Person</th><th className="r">Days</th><th className="r">Hours</th><th className="r">Rate</th><th className="r">Gross pay</th></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.s.name}><td className="strong">{r.s.name}</td><td className="r">{r.days}</td><td className="r">{hm(r.mins)}</td><td className="r">{r.s.rate != null ? money2(r.s.rate) : '—'}</td><td className="r mono">{r.pay != null ? money2(r.pay) : '—'}</td></tr>)}
          </tbody>
        </table>
      </Panel>
      <Panel title="Daily punches" sub="Click a day to correct it.">
        {data.punches.length ? (
          <table className="tbl">
            <thead><tr><th>Date</th><th>Person</th><th>In</th><th>Out</th><th>Breaks</th><th className="r">Worked</th></tr></thead>
            <tbody>
              {data.punches.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => setEdit({ ...p, breaks: p.breaks?.length ? p.breaks : [['', '']] })}>
                  <td>{mdy(p.work_date)}</td><td>{p.name}</td><td>{p.start_time}</td><td>{p.end_time}</td>
                  <td className="sub">{(p.breaks || []).map((b) => b.join('–')).join(', ')}</td>
                  <td className="r">{hm(workedMinutes(p))} {p.edited && <span className="pill pill-muted">edited</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>No punches in this period.</Empty>}
      </Panel>
    </>
  )
}

function StaffRates() {
  const [reload, setReload] = useState(0)
  const { data, error } = useAsync(async () => { const r = await supabase.from('hr_staff').select('*').order('name'); if (r.error) throw r.error; return r.data as Staff[] }, [reload])
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading />
  const update = async (name: string, patch: Partial<Staff>) => {
    const { error } = await supabase.from('hr_staff').update(patch).eq('name', name)
    if (error) alert(error.message); else setReload((n) => n + 1)
  }
  // someone leaving: record the last day and why rather than just switching them off
  const leave = (s: Staff) => { const a = askLeaving(s.name); if (a) update(s.name, { active: false, left_on: a.day, leave_reason: a.why || null }) }
  const rehire = (s: Staff) => { if (confirm(`Make ${s.name} current staff again? Their last employment dates stay in the note.`)) update(s.name, { active: true, leave_reason: s.left_on ? `Previously left ${mdy(s.left_on)}${s.leave_reason ? ' (' + s.leave_reason + ')' : ''}` : s.leave_reason, left_on: null }) }
  const current = data.filter((s) => s.active), former = data.filter((s) => !s.active).sort((a, b) => ((b.left_on || '') < (a.left_on || '') ? -1 : 1))
  return (
    <>
      <Panel title="Staff & pay rates" sub="Admins only. Changes save immediately.">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Role</th><th>Started</th><th>Hourly</th><th className="r">Rate</th><th></th></tr></thead>
          <tbody>
            {current.map((s) => (
              <tr key={s.name}>
                <td className="strong">{s.name}</td>
                <td>{s.role}</td>
                <td><input className="fld" type="date" defaultValue={s.hired_on || ''} onBlur={(e) => { const v = e.target.value || null; if (v !== s.hired_on) update(s.name, { hired_on: v }) }} aria-label={`${s.name} start date`} /></td>
                <td><input type="checkbox" checked={s.hourly} onChange={(e) => update(s.name, { hourly: e.target.checked })} /></td>
                <td className="r"><input className="fld" style={{ width: 100, textAlign: 'right' }} type="number" step="0.25" defaultValue={s.rate ?? ''} onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== s.rate) update(s.name, { rate: v }) }} /></td>
                <td className="r"><button className="linkbtn" onClick={() => leave(s)}>Left the agency…</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {former.length > 0 && (
        <Panel title={`Former staff (${former.length})`} sub="Employment records for people who have left: kept, and out of timesheets and payroll.">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Role</th><th>Started</th><th>Last day</th><th>Reason</th><th className="r">Last rate</th><th></th></tr></thead>
            <tbody>
              {former.map((s) => (
                <tr key={s.name}>
                  <td className="strong">{s.name}</td>
                  <td>{s.role}</td>
                  <td>{s.hired_on ? mdy(s.hired_on) : '—'}</td>
                  <td><input className="fld" type="date" defaultValue={s.left_on || ''} onBlur={(e) => { const v = e.target.value || null; if (v !== s.left_on) update(s.name, { left_on: v }) }} aria-label={`${s.name} last day`} /></td>
                  <td><input className="fld" defaultValue={s.leave_reason || ''} onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== s.leave_reason) update(s.name, { leave_reason: v }) }} aria-label={`${s.name} reason`} /></td>
                  <td className="r">{s.rate != null ? money2(s.rate) : '—'}</td>
                  <td className="r"><button className="linkbtn" onClick={() => rehire(s)}>Rehire</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  )
}
