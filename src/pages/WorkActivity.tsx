// Work & Tickets › Activity report: what the team logged and finished over a period — new items, items completed
// (and by whom), how long they took, and what is still open — overall and person by person, with the completed
// items listed. A manager (or admin) sees everyone; staff see the items they can see on the queue. Exports to Excel.
import { useMemo, useState } from 'react'
import { Empty, Panel, Tile, Tiles } from '../components/ui'
import { daysUntil } from '../lib/books'
import { downloadSheet } from '../lib/excelExport'
import { mdy, todayPacific } from '../lib/format'
import { isDone, type WorkItem } from './WorkQueue'

/** the Pacific day an item was completed (its completion stamp; older items without one use nothing) */
export const doneDay = (w: Pick<WorkItem, 'completed_at'>) => (w.completed_at ? new Date(w.completed_at).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) : null)

const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)
const first = (s: string | null | undefined) => (s || '').trim().split(/\s+/)[0] || ''
const avg = (xs: number[]) => (xs.length ? (xs.reduce((t, x) => t + x, 0) / xs.length).toFixed(1) : '—')

type Period = 'week' | 'lastweek' | 'month' | 'lastmonth' | '30' | 'custom'
const PERIODS: [Period, string][] = [['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['lastmonth', 'Last month'], ['30', 'Last 30 days'], ['custom', 'Custom dates']]

export default function WorkActivity({ work, owners, manager }: { work: WorkItem[]; owners: string[]; manager: boolean }) {
  const today = todayPacific()
  const [period, setPeriod] = useState<Period>('week')
  const [from, setFrom] = useState(addDays(today, -6)), [to, setTo] = useState(today)
  const [who, setWho] = useState('all')
  const mon = addDays(today, -((new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7))
  const range: [string, string] = period === 'week' ? [mon, today] : period === 'lastweek' ? [addDays(mon, -7), addDays(mon, -1)]
    : period === 'month' ? [today.slice(0, 8) + '01', today] : period === 'lastmonth' ? [addDays(today.slice(0, 8) + '01', -1).slice(0, 8) + '01', addDays(today.slice(0, 8) + '01', -1)]
    : period === '30' ? [addDays(today, -29), today] : [from <= to ? from : to, from <= to ? to : from]
  const [a, b] = range
  const label = period === 'custom' ? `${mdy(a)} – ${mdy(b)}` : `${PERIODS.find((p) => p[0] === period)![1]} · ${mdy(a)} – ${mdy(b)}`

  // an item belongs to the person it's assigned to; "completed by" is who marked it done
  const mine = (w: WorkItem) => who === 'all' || first(w.owner).toLowerCase() === who.toLowerCase()
  const pool = work.filter(mine)
  const created = pool.filter((w) => w.entered && w.entered >= a && w.entered <= b)
  const completed = pool.filter((w) => isDone(w) && (doneDay(w) || '') >= a && (doneDay(w) || '') <= b)
    .sort((x, y) => (y.completed_at || '').localeCompare(x.completed_at || ''))
  const openNow = pool.filter((w) => !isDone(w))
  const overdue = openNow.filter((w) => { const d = daysUntil(w.due, today); return d != null && d < 0 })
  const took = (w: WorkItem) => (w.entered && doneDay(w) ? Math.max(0, daysBetween(w.entered, doneDay(w)!)) : null)
  const onTime = completed.filter((w) => !w.due || (doneDay(w) || '') <= w.due).length

  const people = useMemo(() => {
    const names = [...new Set([...owners.map(first), ...work.map((w) => first(w.owner))].filter(Boolean))].sort()
    return names.map((n) => {
      const is = (w: WorkItem) => first(w.owner).toLowerCase() === n.toLowerCase()
      const done = completed.filter(is)
      return { n, created: created.filter(is).length, done: done.length, days: avg(done.map(took).filter((x): x is number => x != null)),
        open: openNow.filter(is).length, overdue: overdue.filter(is).length }
    }).filter((p) => p.created || p.done || p.open)
  }, [owners, work, completed, created, openNow, overdue])

  const exportXlsx = () => downloadSheet(`work-activity-${a}-to-${b}.xlsx`,
    [['Person', 'New items', 'Completed', 'Avg days to complete', 'Open now', 'Overdue now'], ...people.map((p) => [p.n, p.created, p.done, p.days === '—' ? null : Number(p.days), p.open, p.overdue])],
    { sheet: 'By person', tabs: [
      { name: 'Completed', rows: [['Completed', 'Completed by', 'Item', 'Area', 'Type', 'Owner', 'Entered', 'Due', 'Days to complete', 'Note'],
        ...completed.map((w) => [doneDay(w), w.completed_by || null, w.name, w.area, w.kind, w.owner, w.entered, w.due, took(w), w.note])] },
      { name: 'New items', rows: [['Entered', 'Item', 'Area', 'Type', 'Owner', 'Priority', 'Due', 'Status', 'Note'], ...created.map((w) => [w.entered, w.name, w.area, w.kind, w.owner, w.priority, w.due, w.status, w.note])] },
      { name: 'Open now', rows: [['Item', 'Area', 'Type', 'Owner', 'Priority', 'Entered', 'Due', 'Status', 'Note'], ...openNow.map((w) => [w.name, w.area, w.kind, w.owner, w.priority, w.entered, w.due, w.status, w.note])] },
    ] })

  return (
    <>
      <Panel title="Activity report" sub={`${label}${who === 'all' ? '' : ' · ' + who}`} right={
        <div className="filters">
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">{PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {period === 'custom' && <><input className="fld" type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <input className="fld" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} aria-label="To" /></>}
          {manager && <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Person"><option value="all">Everyone</option>{[...new Set(owners.map(first).filter(Boolean))].sort().map((o) => <option key={o}>{o}</option>)}</select>}
          <button className="btn-ghost" onClick={exportXlsx}>Export</button>
        </div>}>
        <Tiles>
          <Tile label="Completed" value={completed.length} sub={completed.length ? `${onTime} on time · avg ${avg(completed.map(took).filter((x): x is number => x != null))} days` : 'none in this period'} tone={completed.length ? 'good' : undefined} />
          <Tile label="New items" value={created.length} sub="logged in this period" />
          <Tile label="Open now" value={openNow.length} sub={who === 'all' ? 'across the team' : 'assigned to ' + who} />
          <Tile label="Overdue now" value={overdue.length} tone={overdue.length ? 'warn' : 'good'} sub={overdue.length ? 'past their due date' : 'nothing past due'} />
        </Tiles>
        {manager && who === 'all' && (people.length ? (
          <div className="tbl-wrap" style={{ marginTop: 12 }}>
            <table className="tbl">
              <thead><tr><th>Person</th><th className="r">New items</th><th className="r">Completed</th><th className="r">Avg days to complete</th><th className="r">Open now</th><th className="r">Overdue now</th></tr></thead>
              <tbody>{people.map((p) => (
                <tr key={p.n} style={{ cursor: 'pointer' }} onClick={() => setWho(p.n)}>
                  <td className="strong">{p.n}</td><td className="r">{p.created}</td><td className="r strong">{p.done}</td><td className="r">{p.days}</td><td className="r">{p.open}</td>
                  <td className="r">{p.overdue ? <span className="pill pill-bad">{p.overdue}</span> : 0}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>) : <Empty>No activity in this period.</Empty>)}
      </Panel>
      <Panel title="Completed in this period" sub={`${completed.length} item${completed.length === 1 ? '' : 's'}`}>
        {completed.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Completed</th><th>Item</th><th>Owner</th><th>Completed by</th><th className="r">Days</th></tr></thead>
              <tbody>{completed.map((w) => (
                <tr key={w.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{mdy(doneDay(w)!)}</td>
                  <td><div className="strong">{w.name}</div><div className="sub">{w.area}{w.kind ? ' · ' + w.kind : ''}{w.note ? ' — ' + w.note : ''}</div></td>
                  <td>{w.owner || '—'}</td><td>{w.completed_by || '—'}</td><td className="r">{took(w) ?? '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty>Nothing completed in this period.</Empty>}
      </Panel>
    </>
  )
}
