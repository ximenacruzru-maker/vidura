// Call lists: clients handed to one person to call (Rhon's retention call list, for one). The person works their list
// on My Space and here: tap the number to dial, mark how the call went and note what the client said. The owner and
// admins open anyone's list here to see the progress and every result (the report).
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { Empty, ErrorBox, Loading, PageHead, Tile, Tiles } from '../components/ui'
import { agencyName, isAdmin } from '../lib/data'
import { mdy, todayPacific } from '../lib/format'
import { downloadCallListPdf } from '../lib/callListPdf'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

export type CallResult = 'no_answer' | 'voicemail' | 'reached' | 'not_interested' | 'wrong_number'
export interface CallItem { id: number; assignee: string; list_name: string; list_date: string; first_name: string | null; last_name: string | null; phone: string | null; line: string | null; opportunity_date: string | null; result: CallResult | null; notes: string | null; called_at: string | null; called_by: string | null }
export const RESULT_LABEL: Record<CallResult, string> = { reached: 'Reached', voicemail: 'Left voicemail', no_answer: 'No answer', not_interested: 'Not interested', wrong_number: 'Wrong number' }
const RESULTS = Object.keys(RESULT_LABEL) as CallResult[]
const fullName = (r: CallItem) => [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Client'
const dial = (s: string | null) => (s || '').replace(/\D/g, '')

/** every call-list row the signed-in person can see: their own, or (owner/admin) everyone's */
export async function getCallItems() {
  const out: CallItem[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('call_list_items').select('*').order('list_date', { ascending: false }).order('opportunity_date').order('id').range(from, from + 999)
    if (error) throw error
    out.push(...(data as CallItem[]))
    if (!data || data.length < 1000) break
  }
  return out
}
/** one list's numbers: how many called, reached and so on */
export function callStats(rows: CallItem[]) {
  const by = Object.fromEntries(RESULTS.map((k) => [k, rows.filter((r) => r.result === k).length])) as Record<CallResult, number>
  const called = rows.filter((r) => r.result).length
  return { total: rows.length, called, left: rows.length - called, by, lastCall: rows.map((r) => r.called_at || '').sort().pop() || null }
}
/** the lists, newest first, as { key, assignee, name, date, rows } */
export function groupLists(rows: CallItem[]) {
  const m = new Map<string, { key: string; assignee: string; name: string; date: string; rows: CallItem[] }>()
  for (const r of rows) {
    const key = `${r.assignee}|${r.list_name}|${r.list_date}`
    if (!m.has(key)) m.set(key, { key, assignee: r.assignee, name: r.list_name, date: r.list_date, rows: [] })
    m.get(key)!.rows.push(r)
  }
  return [...m.values()].sort((a, b) => b.date.localeCompare(a.date) || a.assignee.localeCompare(b.assignee))
}

/** The page: your own list, or (owner/admin) pick whose. `?who=Name` opens that person's. */
export default function CallLists() {
  const { me } = useAuth()
  const admin = isAdmin(me?.role)
  const [params, setParams] = useSearchParams()
  const [reload, setReload] = useState(0)
  const { data, error } = useAsync(getCallItems, [reload])
  const lists = useMemo(() => groupLists(data || []), [data])
  const people = [...new Set(lists.map((l) => l.assignee))]
  const who = params.get('who') || (admin ? people[0] : me?.producer_name || me?.display_name) || ''
  const mine = lists.filter((l) => l.assignee.toLowerCase() === who.toLowerCase())
  const head = <PageHead kicker="Call lists" title={admin ? `${who || 'Call lists'}${who ? '’s call list' : ''}` : 'My call list'}
    sub={admin ? 'Who was called, how each call went and what the client said.' : 'Tap a number to call, then mark how it went and note what the client said.'}
    right={admin && people.length > 1 ? <select className="fld" value={who} onChange={(e) => setParams({ who: e.target.value })} aria-label="Whose list">{people.map((p) => <option key={p}>{p}</option>)}</select> : undefined} />
  if (error) return <>{head}<ErrorBox error={error} /></>
  if (!data) return <>{head}<Loading /></>
  if (!mine.length) return <>{head}<Empty>No call list assigned{admin && who ? ` to ${who}` : ''} yet.</Empty></>
  return <>{head}{mine.map((l) => <CallListBlock key={l.key} list={l} onChange={() => setReload((n) => n + 1)} report={admin} />)}</>
}

/** On My Space: the signed-in person's own open list(s), if they have one. */
export function MyCallList({ name }: { name: string }) {
  const [reload, setReload] = useState(0)
  const { data } = useAsync(getCallItems, [reload])
  const lists = groupLists((data || []).filter((r) => r.assignee.toLowerCase() === name.toLowerCase())).filter((l) => l.rows.some((r) => !r.result))
  if (!lists.length) return null
  return <>{lists.map((l) => <CallListBlock key={l.key} list={l} onChange={() => setReload((n) => n + 1)} compact />)}</>
}

function CallListBlock({ list, onChange, report, compact }: { list: ReturnType<typeof groupLists>[number]; onChange: () => void; report?: boolean; compact?: boolean }) {
  const { me } = useAuth()
  const s = callStats(list.rows)
  const [busy, setBusy] = useState(false)
  const pdf = async () => {
    setBusy(true)
    try { await downloadCallListPdf(list, todayPacific(), agencyName(me)) } catch (e) { alert('The report could not be made: ' + String((e as Error)?.message || e)) } finally { setBusy(false) }
  }
  const [show, setShow] = useState<'todo' | 'done' | 'all'>(compact ? 'todo' : report ? 'all' : 'todo')
  const rows = list.rows.filter((r) => (show === 'all' ? true : show === 'todo' ? !r.result : !!r.result))
  const pct = s.total ? Math.round((s.called / s.total) * 100) : 0
  return (
    <section className="panel cl">
      <div className="panel-h cl-h">
        <div>
          <div className="panel-t">📞 {list.name}</div>
          <div className="panel-s">{list.assignee} · list of {mdy(list.date)} · {s.called} of {s.total} called · {s.by.reached} reached{s.lastCall ? ` · last call ${new Date(s.lastCall).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}</div>
        </div>
        <div className="cl-acts"><button type="button" className="btn-ghost" onClick={pdf} disabled={busy}>{busy ? 'Making…' : '⬇ Download PDF'}</button>
        <div className="cf-seg">{(['todo', 'done', 'all'] as const).map((k) => <button key={k} className={show === k ? 'on' : ''} onClick={() => setShow(k)}>{k === 'todo' ? `To call (${s.left})` : k === 'done' ? `Called (${s.called})` : `All (${s.total})`}</button>)}</div></div>
      </div>
      <div className="cl-bar" role="img" aria-label={`${pct}% called`}><i style={{ width: pct + '%' }} /></div>
      {report && (
        <div className="cl-tiles"><Tiles>
          <Tile label="Called" value={`${s.called} / ${s.total}`} sub={`${pct}% of the list`} tone={s.left ? undefined : 'good'} />
          <Tile label="Reached" value={s.by.reached} sub={`${s.by.not_interested} not interested`} tone="good" />
          <Tile label="Voicemail · no answer" value={`${s.by.voicemail} · ${s.by.no_answer}`} sub={`${s.by.wrong_number} wrong number${s.by.wrong_number === 1 ? '' : 's'}`} />
          <Tile label="Still to call" value={s.left} tone={s.left ? 'warn' : 'good'} />
        </Tiles></div>
      )}
      <div className="cl-rows">
        {rows.slice(0, compact ? 12 : rows.length).map((r) => <CallRow key={r.id} r={r} onChange={onChange} />)}
        {!rows.length && <div className="rr-s">{show === 'todo' ? 'Everyone on the list has been called. 🎉' : 'No calls marked yet.'}</div>}
        {compact && rows.length > 12 && <a className="cl-more" href={`#/call-lists?who=${encodeURIComponent(list.assignee)}`}>See all {rows.length} to call →</a>}
      </div>
    </section>
  )
}

function CallRow({ r, onChange }: { r: CallItem; onChange: () => void }) {
  const [notes, setNotes] = useState(r.notes || '')
  const save = async (patch: Partial<CallItem>) => {
    const { error } = await supabase.from('call_list_items').update(patch).eq('id', r.id)
    if (error) alert(error.message); else onChange()
  }
  return (
    <div className={'cl-row' + (r.result ? ' cl-done' : '')}>
      <div className="cl-who">
        <b>{fullName(r)}</b>
        <span>{[r.line, r.opportunity_date && `renews ${mdy(r.opportunity_date)}`].filter(Boolean).join(' · ')}</span>
        {r.phone && <a href={`tel:${dial(r.phone)}`} className="cl-tel">📱 {r.phone}</a>}
      </div>
      <div className="cl-res">
        {RESULTS.map((k) => <button key={k} type="button" className={'cl-b cl-' + k + (r.result === k ? ' on' : '')} onClick={() => save({ result: r.result === k ? null : k })}>{RESULT_LABEL[k]}</button>)}
        {r.called_at && <small>{r.called_by ? r.called_by + ' · ' : ''}{new Date(r.called_at).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small>}
      </div>
      <textarea className="fld" rows={2} value={notes} placeholder="What the client said, next step" onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (r.notes || '') && save({ notes: notes || null })} aria-label={`Notes for ${fullName(r)}`} />
    </div>
  )
}
