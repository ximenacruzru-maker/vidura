import { Fragment, useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { Empty, ErrorBox, Loading, PageHead, Panel, Search, Tabs } from '../components/ui'
import { daysUntil } from '../lib/books'
import { can } from '../lib/access'
import { isAdmin } from '../lib/data'
import { mdy, todayPacific } from '../lib/format'
import { downloadSheet } from '../lib/excelExport'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'
import WorkActivity, { WorkStats, doneDay } from './WorkActivity'
import TeamRecap from '../components/TeamRecap'

export interface WorkItem { id: number; created_by?: string | null; area: string; name: string; kind: string | null; priority: string; entered: string | null; due: string | null; owner: string | null; status: string; note: string | null; source: string; completed_at?: string | null; completed_by?: string | null }
export const STATUSES = ['Not started', 'In Process', 'Waiting on client', 'Completed']
const PRIS = ['Critical', 'High', 'Normal', 'Low']
export const isDone = (w: WorkItem) => /complete|done|resolved|closed/i.test(w.status)

/** a note on a work item: the running thread of what was done */
export interface WorkNote { id: number; item_id: number; body: string; author: string | null; created_by: string | null; created_at: string }
export async function getWorkNotes() {
  const { data, error } = await supabase.from('work_item_notes').select('id, item_id, body, author, created_by, created_at').order('created_at').limit(5000)
  return error ? [] : (data as WorkNote[])
}
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })

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
  // a completed item stays on the list (below the open ones) so the work done is on record; the activity report counts it
  const [status, setStatus] = useState('all')
  const [tab, setTab] = useState<'queue' | 'activity'>('queue')
  const [area, setArea] = useState('all')
  const [owner, setOwner] = useState('all')
  const [q, setQ] = useState('')
  const [draft, setDraft] = useState<Partial<WorkItem> | null>(null)
  const [stats, setStats] = useState(false)
  // on a phone the window scrolls under a pinned top bar, so the pinned counts sit just below it (its height varies by theme)
  const [pinTop, setPinTop] = useState<number | undefined>(undefined)
  useEffect(() => {
    const tb = document.querySelector<HTMLElement>('.topbar')
    const fit = () => setPinTop(tb && getComputedStyle(tb).position === 'sticky' && window.matchMedia('(max-width: 860px)').matches ? tb.offsetHeight : undefined)
    fit(); window.addEventListener('resize', fit)
    const ro = tb ? new ResizeObserver(fit) : null; if (tb) ro!.observe(tb)
    return () => { window.removeEventListener('resize', fit); ro?.disconnect() }
  }, [])
  const admin = isAdmin(me?.role)
  const manager = admin || can(me, 'work_manager') // whoever runs the queue sees and assigns everything
  const { data: work, error } = useAsync(getWork, [reload])
  const [noteTick, setNoteTick] = useState(0)
  const { data: notes } = useAsync(getWorkNotes, [reload, noteTick])
  const [opened, setOpened] = useState<number | null>(null)
  const notesOf = (id: number) => (notes || []).filter((n) => n.item_id === id)
  const { data: people } = useAsync(async () => {
    const { data } = await supabase.from('staff_directory').select('display_name')
    return ((data || []) as { display_name: string }[]).map((x) => x.display_name.split(' ')[0]).filter(Boolean)
  }, [])
  const data = work

  const head = <PageHead kicker="Workspace" title="Work & Tickets" sub={manager
    ? `Service work, follow-ups and admin tasks for the whole team. You see everyone’s list and assign the work; staff see only what’s assigned to them${admin ? '' : ' (and admins see it all)'}.`
    : 'Your to-dos, plus anything you assigned to someone else. You can assign work to anyone on the team.'} />
  if (error) return <>{head}<ErrorBox error={error} /></>
  if (!data) return <>{head}<Loading /></>
  const open = data.filter((w) => !isDone(w))
  const overdue = open.filter((w) => { const d = daysUntil(w.due, today); return d != null && d < 0 })
  const dueToday = open.filter((w) => w.due === today)
  const weekStart = (() => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10) })()
  const doneThisWeek = data.filter((w) => isDone(w) && (doneDay(w) || '') >= weekStart).length
  const areas = [...new Set(data.map((w) => w.area))].sort()
  const owners = [...new Set([...(people || []), ...(data.map((w) => w.owner).filter(Boolean) as string[])])].sort()
  const late = (w: WorkItem) => { const d = daysUntil(w.due, today); return !isDone(w) && d != null && d < 0 }
  const rows = data
    .filter((w) => (status === 'open' ? !isDone(w) : status === 'all' ? true : status === 'overdue' ? late(w) : status === 'today' ? !isDone(w) && w.due === today
      : status === 'done' ? isDone(w) : w.status === status))
    .filter((w) => area === 'all' || w.area === area)
    .filter((w) => owner === 'all' || w.owner === owner)
    .filter((w) => !q || `${w.name} ${w.note} ${w.owner} ${w.area} ${w.kind}`.toLowerCase().includes(q.toLowerCase()))
    // newest first: open work by when it was entered (newest on top), then completed work, most recently completed first
    .sort((a, b) => (isDone(a) !== isDone(b) ? (isDone(a) ? 1 : -1)
      : isDone(a) ? (b.completed_at || '').localeCompare(a.completed_at || '') || b.id - a.id
      : (b.entered || '').localeCompare(a.entered || '') || b.id - a.id))

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
      {/* the counts stay pinned at the top while the list scrolls; each one filters the queue */}
      <div className="wq-sticky" style={pinTop != null ? { top: pinTop } : undefined}>
        <div className="wq-stats">
          {([['open', 'Open', open.length, `across ${new Set(open.map((w) => w.area)).size} areas`, ''],
            ['overdue', 'Overdue', overdue.length, overdue.length ? 'oldest due ' + mdy([...overdue].sort((a, b) => (a.due! < b.due! ? -1 : 1))[0].due!) : 'nothing past due', overdue.length ? 'warn' : 'good'],
            ['today', 'Due today', dueToday.length, dueToday.length ? 'due ' + mdy(today) : 'nothing due today', ''],
            ['done', 'Completed', data.length - open.length, `${doneThisWeek} this week`, 'good']] as const).map(([k, l, v, sub, tone]) => (
            <button key={k} className={'wq-stat' + (tone ? ' wq-' + tone : '') + (tab === 'queue' && status === k ? ' on' : '')} onClick={() => { setTab('queue'); setStatus(status === k ? 'all' : k) }} aria-pressed={tab === 'queue' && status === k}>
              <span className="wq-stat-l">{l}</span><b className="wq-stat-v">{v}</b><span className="wq-stat-s">{sub}</span>
            </button>
          ))}
        </div>
        <div className="wq-bar">
          <Tabs tabs={[{ key: 'queue' as const, label: 'Queue' }, { key: 'activity' as const, label: 'Activity report' }]} value={tab} onChange={setTab} />
          <div className="wq-bar-r">
            {manager && <TeamRecap className="btn-ghost wq-stats-btn" label="📧 Team recap" />}
            <button className="btn-primary wq-stats-btn" onClick={() => setStats(true)}>📊 Who closed what</button>
          </div>
        </div>
      </div>
      <WorkStats open={stats} onClose={() => setStats(false)} work={data} manager={manager} />
      {tab === 'activity' ? <WorkActivity work={data} owners={owners} manager={manager} /> : <Panel title="Queue" sub={`${rows.length} shown`} right={
        <div className="filters">
          <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All</option><option value="open">Open</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="done">Completed (all)</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
          <select value={area} onChange={(e) => setArea(e.target.value)}><option value="all">All areas</option>{areas.map((a) => <option key={a}>{a}</option>)}</select>
          <select value={owner} onChange={(e) => setOwner(e.target.value)}><option value="all">Everyone</option>{owners.map((a) => <option key={a}>{a}</option>)}</select>
          <Search value={q} onChange={setQ} />
          <button className="btn-primary" onClick={() => setDraft(draft ? null : { priority: 'Normal', status: 'Not started', owner: me?.display_name?.split(' ')[0] })}>{draft ? 'Cancel' : '+ New item'}</button>
          <button className="btn-ghost" onClick={() => downloadSheet(`work-queue-${today}.xlsx`, [['Area', 'Item', 'Type', 'Priority', 'Entered', 'Due', 'Owner', 'Status', 'Completed', 'Completed by', 'Note'], ...rows.map((w) => [w.area, w.name, w.kind, w.priority, w.entered, w.due, w.owner, w.status, doneDay(w), w.completed_by || null, w.note])], { sheet: 'Work queue' })}>Export</button>
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
          <div className="tbl-wrap wq-tbl">
            <table className="tbl">
              <thead><tr><th>Item</th><th>Priority</th><th>Due</th><th>Owner</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((w) => {
                  const d = daysUntil(w.due, today)
                  const ns = notesOf(w.id), last = ns[ns.length - 1]
                  return (
                    <Fragment key={w.id}>
                    <tr className={isDone(w) ? 'wq-done' : undefined}>
                      <td><div className="strong">{w.name}</div><div className="sub">{w.area}{w.kind ? ' · ' + w.kind : ''}{w.note ? ' — ' + w.note : ''}</div>
                        {last && opened !== w.id && <button type="button" className="wq-last" onClick={() => setOpened(w.id)}>💬 <b>{(last.author || 'Someone').split(' ')[0]}</b> {when(last.created_at)}: {last.body.length > 120 ? last.body.slice(0, 119) + '…' : last.body}</button>}
                        {isDone(w) && <div className="sub wq-done-by">✓ Completed{doneDay(w) ? ' ' + mdy(doneDay(w)!) : ''}{w.completed_by ? ' by ' + w.completed_by : ''}</div>}</td>
                      <td><span className={'pill ' + (/critical|urgent/i.test(w.priority) ? 'pill-bad' : /high/i.test(w.priority) ? 'pill-warn' : 'pill-muted')}>{w.priority}</span></td>
                      <td style={{ whiteSpace: 'nowrap' }}>{w.due ? mdy(w.due) : '—'} {!isDone(w) && d != null && d < 0 && <span className="pill pill-bad">late</span>}</td>
                      <td>{w.owner}{!manager && w.created_by === session?.user.id && !(w.owner || '').toLowerCase().startsWith(first) && <div className="sub">assigned by you</div>}</td>
                      <td><select value={STATUSES.includes(w.status) ? w.status : ''} onChange={(e) => patch(w.id, { status: e.target.value })}>{!STATUSES.includes(w.status) && <option value="">{w.status}</option>}{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></td>
                      <td className="r" style={{ whiteSpace: 'nowrap' }}>
                        <button className={'linkbtn wq-nbtn' + (opened === w.id ? ' on' : '')} onClick={() => setOpened(opened === w.id ? null : w.id)} aria-expanded={opened === w.id}>💬 Notes{ns.length ? ` (${ns.length})` : ''}</button> · <button className="linkbtn" onClick={() => setDraft(w)}>Edit</button>
                        {admin && !isDone(w) && <> · <button className="linkbtn" onClick={() => remove(w.id)}>Delete</button></>}
                      </td>
                    </tr>
                    {opened === w.id && <tr className="wq-notes-row"><td colSpan={6}><NotesThread item={w} notes={ns} me={session?.user.id} admin={admin} onChange={() => setNoteTick((n) => n + 1)} /></td></tr>}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty>Nothing here.</Empty>}
      </Panel>}
    </>
  )
}

/** The notes on one item: who wrote what and when, and a box to add one. */
function NotesThread({ item, notes, me, admin, onChange }: { item: WorkItem; notes: WorkNote[]; me?: string; admin: boolean; onChange: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const add = async () => {
    if (!text.trim()) return
    setBusy(true)
    const { error } = await supabase.from('work_item_notes').insert({ item_id: item.id, body: text.trim() })
    setBusy(false)
    if (error) alert(error.message); else { setText(''); onChange() }
  }
  const del = async (id: number) => {
    if (!confirm('Delete this note?')) return
    const { error } = await supabase.from('work_item_notes').delete().eq('id', id)
    if (error) alert(error.message); else onChange()
  }
  return (
    <div className="wq-notes">
      {notes.length ? notes.map((n) => (
        <div key={n.id} className="wq-note">
          <div className="wq-note-h"><b>{n.author || 'Someone'}</b><span>{when(n.created_at)}</span>
            {(admin || n.created_by === me) && <button type="button" className="linkbtn" onClick={() => del(n.id)} aria-label="Delete note">×</button>}</div>
          <div className="wq-note-b">{n.body}</div>
        </div>
      )) : <div className="sub">No notes yet. Write what you did, what you’re waiting on, or the next step.</div>}
      <div className="wq-note-add">
        <textarea className="fld" rows={2} value={text} placeholder="Add a note: what you did, who you spoke to, what’s next" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add() }} aria-label={`Add a note to ${item.name}`} />
        <button type="button" className="btn-primary" onClick={add} disabled={busy || !text.trim()}>{busy ? 'Saving…' : 'Add note'}</button>
      </div>
    </div>
  )
}
