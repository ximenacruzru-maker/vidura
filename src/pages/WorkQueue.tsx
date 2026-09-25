import { useState } from 'react'
import { useAuth } from '../auth'
import { Empty, ErrorBox, Loading, PageHead, Panel, Search, Tile, Tiles } from '../components/ui'
import { daysUntil } from '../lib/books'
import { isAdmin } from '../lib/data'
import { downloadCsv, mdy, todayPacific } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

export interface WorkItem { id: number; created_by?: string | null; area: string; name: string; kind: string | null; priority: string; entered: string | null; due: string | null; owner: string | null; status: string; note: string | null; source: string }
export const STATUSES = ['Not started', 'In Process', 'Waiting on client', 'Completed']
const PRIS = ['Critical', 'High', 'Normal', 'Low']
export const isDone = (w: WorkItem) => /complete|done|resolved|closed/i.test(w.status)

export async function getWork() {
  const { data, error } = await supabase.from('work_items').select('*').order('due', { ascending: true, nullsFirst: false }).limit(2000)
  if (error) throw error
  return data as WorkItem[]
}

export default function WorkQueue() {
  const { me, session } = useAuth()
  const first = (me?.display_name || '').split(' ')[0].toLowerCase()
  const today = todayPacific()
  const [reload, setReload] = useState(0)
  const [status, setStatus] = useState('open')
  const [area, setArea] = useState('all')
  const [owner, setOwner] = useState('all')
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<Partial<WorkItem> | null>(null)
  const admin = isAdmin(me?.role)
  const { data: work, error } = useAsync(getWork, [reload])
  const { data: people } = useAsync(async () => {
    const { data } = await supabase.from('staff_directory').select('display_name')
    return ((data || []) as { display_name: string }[]).map((x) => x.display_name.split(' ')[0]).filter(Boolean)
  }, [])
  const data = work

  const head = <PageHead kicker="Operations" title={admin ? 'Work queue' : 'My work'} sub={admin
    ? 'Service work, follow-ups and admin tasks for the whole team. You see everyone’s list; staff see only their own.'
    : 'Your to-dos, plus anything you assigned to someone else. You can assign work to anyone on the team.'} />
  if (error) return <>{head}<ErrorBox error={error} /></>
  if (!data) return <>{head}<Loading /></>
  const open = data.filter((w) => !isDone(w))
  const overdue = open.filter((w) => { const d = daysUntil(w.due, today); return d != null && d < 0 })
  const dueToday = open.filter((w) => w.due === today)
  const areas = [...new Set(data.map((w) => w.area))].sort()
  const owners = [...new Set([...(people || []), ...(data.map((w) => w.owner).filter(Boolean) as string[])])].sort()
  const rows = data
    .filter((w) => (status === 'open' ? !isDone(w) : status === 'all' ? true : w.status === status))
    .filter((w) => area === 'all' || w.area === area)
    .filter((w) => owner === 'all' || w.owner === owner)
    .filter((w) => !q || `${w.name} ${w.note} ${w.owner} ${w.area} ${w.kind}`.toLowerCase().includes(q.toLowerCase()))

  const patch = async (id: number, p: Partial<WorkItem>) => {
    const { error } = await supabase.from('work_items').update({ ...p, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) alert(error.message); else setReload((n) => n + 1)
  }
  const remove = async (id: number) => {
    if (!confirm('Delete this work item for everyone?')) return
    const { error } = await supabase.from('work_items').delete().eq('id', id)
    if (error) alert(error.message); else setReload((n) => n + 1)
  }
  const save = async () => {
    if (!draft?.name?.trim()) { alert('Give the work item a name.'); return }
    const row = { area: draft.area || 'General', name: draft.name.trim(), kind: draft.kind || null, priority: draft.priority || 'Normal', due: draft.due || null,
      owner: draft.owner || null, status: draft.status || 'Not started', note: draft.note || null, source: 'Logged by ' + (me?.display_name || 'staff') }
    const { error } = draft.id ? await supabase.from('work_items').update(row).eq('id', draft.id) : await supabase.from('work_items').insert(row)
    if (error) alert(error.message); else { setDraft(null); setReload((n) => n + 1) }
  }

  return (
    <>
      {head}
      <Tiles>
        <Tile label="Open" value={open.length} sub={`across ${new Set(open.map((w) => w.area)).size} areas`} />
        <Tile label="Overdue" value={overdue.length} sub={overdue[0]?.due ? 'oldest due ' + mdy(overdue[0].due) : 'nothing past due'} tone={overdue.length ? 'warn' : 'good'} />
        <Tile label="Due today" value={dueToday.length} />
        <Tile label="Completed" value={data.length - open.length} sub={`of ${data.length} items`} />
      </Tiles>
      <Panel title="Queue" sub={`${rows.length} shown`} right={
        <div className="filters">
          <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open</option><option value="all">All</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
          <select value={area} onChange={(e) => setArea(e.target.value)}><option value="all">All areas</option>{areas.map((a) => <option key={a}>{a}</option>)}</select>
          <select value={owner} onChange={(e) => setOwner(e.target.value)}><option value="all">Everyone</option>{owners.map((a) => <option key={a}>{a}</option>)}</select>
          <Search value={q} onChange={setQ} />
          <button className="btn-primary" onClick={() => setDraft(draft ? null : { priority: 'Normal', status: 'Not started', owner: me?.display_name?.split(' ')[0] })}>{draft ? 'Cancel' : '+ New item'}</button>
          <button className="btn-ghost" onClick={() => downloadCsv(`work-queue-${today}.csv`, [['Area', 'Item', 'Type', 'Priority', 'Entered', 'Due', 'Owner', 'Status', 'Note'], ...rows.map((w) => [w.area, w.name, w.kind, w.priority, w.entered, w.due, w.owner, w.status, w.note])])}>CSV</button>
        </div>}>
        {draft && (
          <div className="plan">
            <div className="form-grid">
              <label style={{ gridColumn: '1 / -1' }}>What needs doing<input className="fld" autoFocus value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
              <label>Area<input className="fld" list="areas" value={draft.area || ''} onChange={(e) => setDraft({ ...draft, area: e.target.value })} /></label>
              <label>Type<input className="fld" value={draft.kind || ''} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} /></label>
              <label>Priority<select className="fld" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>{PRIS.map((p) => <option key={p}>{p}</option>)}</select></label>
              <label>Due<input className="fld" type="date" value={draft.due || ''} onChange={(e) => setDraft({ ...draft, due: e.target.value })} /></label>
              <label>Owner<input className="fld" list="owners" value={draft.owner || ''} onChange={(e) => setDraft({ ...draft, owner: e.target.value })} /></label>
              <label>Status<select className="fld" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>{STATUSES.map((p) => <option key={p}>{p}</option>)}</select></label>
              <label style={{ gridColumn: '1 / -1' }}>Note<textarea className="fld" rows={2} value={draft.note || ''} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></label>
            </div>
            <datalist id="areas">{areas.map((a) => <option key={a} value={a} />)}</datalist>
            <datalist id="owners">{owners.map((a) => <option key={a} value={a} />)}</datalist>
            <div className="row-actions" style={{ marginTop: 10 }}><button className="btn-primary" onClick={save}>{draft.id ? 'Save changes' : 'Add to queue'}</button></div>
          </div>
        )}
        {rows.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Item</th><th>Priority</th><th>Due</th><th>Owner</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((w) => {
                  const d = daysUntil(w.due, today)
                  return (
                    <tr key={w.id}>
                      <td><div className="strong">{w.name}</div><div className="sub">{w.area}{w.kind ? ' · ' + w.kind : ''}{w.note ? ' — ' + w.note : ''}</div></td>
                      <td><span className={'pill ' + (/critical|urgent/i.test(w.priority) ? 'pill-bad' : /high/i.test(w.priority) ? 'pill-warn' : 'pill-muted')}>{w.priority}</span></td>
                      <td style={{ whiteSpace: 'nowrap' }}>{w.due ? mdy(w.due) : '—'} {!isDone(w) && d != null && d < 0 && <span className="pill pill-bad">late</span>}</td>
                      <td>{w.owner}{!admin && w.created_by === session?.user.id && !(w.owner || '').toLowerCase().startsWith(first) && <div className="sub">assigned by you</div>}</td>
                      <td><select value={STATUSES.includes(w.status) ? w.status : ''} onChange={(e) => patch(w.id, { status: e.target.value })}>{!STATUSES.includes(w.status) && <option value="">{w.status}</option>}{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></td>
                      <td className="r" style={{ whiteSpace: 'nowrap' }}>
                        <button className="linkbtn" onClick={() => setDraft(w)}>Edit</button>
                        {admin && <> · <button className="linkbtn" onClick={() => remove(w.id)}>Delete</button></>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty>Nothing here.</Empty>}
      </Panel>
    </>
  )
}
