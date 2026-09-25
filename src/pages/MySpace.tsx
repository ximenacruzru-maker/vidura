import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { ErrorBox, Loading, PageHead, Panel, Tile, Tiles } from '../components/ui'
import { daysUntil, getBookPolicies } from '../lib/books'
import { getPolicies, getQuotes, isAdmin } from '../lib/data'
import { addDays, mdy, money0, todayPacific } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'
import { getWork, isDone } from './WorkQueue'

interface Item { id: number; area: string | null; name: string; priority: string | null; due_time: string | null; sort: number; active: boolean }

export default function MySpace() {
  const { me, session } = useAuth()
  const admin = isAdmin(me?.role)
  const today = todayPacific()
  const first = (me?.display_name || '').split(' ')[0]
  const [reload, setReload] = useState(0)
  const [newItem, setNewItem] = useState('')
  const { data, error } = useAsync(async () => {
    const [items, ticks, work, sold, quotes, book] = await Promise.all([
      supabase.from('checklist_items').select('*').eq('active', true).order('sort').then((r) => { if (r.error) throw r.error; return r.data as Item[] }),
      supabase.from('checklist_ticks').select('item_id,done').eq('day', today).then((r) => { if (r.error) throw r.error; return r.data as { item_id: number; done: boolean }[] }),
      getWork(), getPolicies(today, today), getQuotes(today, today), getBookPolicies(),
    ])
    return { items, ticks, work, sold, quotes, book }
  }, [reload, today])

  const date = new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
  const head = <PageHead kicker={`${first ? first + '’s' : 'My'} space`} title={date} />
  if (error) return <>{head}<ErrorBox error={error} /></>
  if (!data) return <>{head}<Loading /></>

  const done = new Set(data.ticks.filter((t) => t.done).map((t) => t.item_id))
  const pct = data.items.length ? Math.round((done.size / data.items.length) * 100) : 0
  const mine = data.work.filter((w) => !isDone(w) && first && (w.owner || '').toLowerCase().startsWith(first.toLowerCase()))
  const overdue = data.work.filter((w) => !isDone(w) && (daysUntil(w.due, today) ?? 0) < 0)
  const renew14 = data.book.filter((p) => { const d = daysUntil(p.expiration, today); return d != null && d >= 0 && d <= 14 })

  const tick = async (id: number, on: boolean) => {
    const { error } = await supabase.from('checklist_ticks').upsert({ user_id: session!.user.id, day: today, item_id: id, done: on })
    if (error) alert(error.message); else setReload((n) => n + 1)
  }
  const add = async () => {
    if (!newItem.trim()) return
    const { error } = await supabase.from('checklist_items').insert({ name: newItem.trim(), sort: (data.items.at(-1)?.sort ?? 0) + 1 })
    if (error) alert(error.message); else { setNewItem(''); setReload((n) => n + 1) }
  }
  const retire = async (id: number) => {
    const { error } = await supabase.from('checklist_items').update({ active: false }).eq('id', id)
    if (error) alert(error.message); else setReload((n) => n + 1)
  }

  return (
    <>
      {head}
      <Tiles>
        <Tile label="Checklist" value={`${done.size}/${data.items.length}`} sub={`${pct}% done today`} tone={pct === 100 ? 'good' : undefined} />
        <Tile label="My open work" value={mine.length} sub={<Link to="/work">open the queue</Link>} />
        <Tile label={admin ? "Overdue (team)" : "My overdue"} value={overdue.length} tone={overdue.length ? 'warn' : 'good'} />
        <Tile label={admin ? "Sold today" : "I sold today"} value={data.sold.length} sub={money0(data.sold.reduce((s, p) => s + p.premium, 0)) + ' written'} />
        <Tile label={admin ? "Quoted today" : "I quoted today"} value={data.quotes.length} sub={money0(data.quotes.reduce((s, q) => s + q.quoted_premium, 0))} />
      </Tiles>
      <div className="grid2">
        <Panel title="Daily checklist" sub="Ticks are yours and reset each morning.">
          <div className="prog-row"><span>{done.size} of {data.items.length}</span><div className="progress"><i style={{ width: pct + '%' }} /></div><span>{pct}%</span></div>
          {data.items.map((it) => (
            <label key={it.id} className={'check' + (done.has(it.id) ? ' done' : '')}>
              <input type="checkbox" checked={done.has(it.id)} onChange={(e) => tick(it.id, e.target.checked)} />
              <div style={{ flex: 1 }}>
                <div className="check-t">{it.name}</div>
                <div className="sub">{[it.area, it.priority, it.due_time].filter(Boolean).join(' · ')}</div>
              </div>
              {admin && <button className="linkbtn" onClick={(e) => { e.preventDefault(); retire(it.id) }}>remove</button>}
            </label>
          ))}
          {admin && (
            <div className="row-actions" style={{ marginTop: 10 }}>
              <input className="fld" placeholder="Add a daily task for everyone" value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
              <button className="btn-ghost" onClick={add}>Add</button>
            </div>
          )}
        </Panel>
        <div>
          <Panel title="My open work" sub={first ? `Items assigned to ${first}` : undefined}>
            {mine.length ? (
              <table className="tbl"><tbody>{mine.slice(0, 10).map((w) => (
                <tr key={w.id}><td><div className="strong">{w.name}</div><div className="sub">{w.area} · {w.priority}</div></td><td className="r">{w.due ? mdy(w.due) : ''}</td></tr>
              ))}</tbody></table>
            ) : <div className="sub">Nothing assigned to you.</div>}
          </Panel>
          <Panel title="Renewing in the next 14 days" sub={<Link to="/books/farmers?renewals=1">All renewals</Link>}>
            {renew14.length ? (
              <table className="tbl"><tbody>{renew14.sort((a, b) => (a.expiration! < b.expiration! ? -1 : 1)).slice(0, 10).map((p) => (
                <tr key={p.id}><td><div className="strong">{p.insured}</div><div className="sub">{p.product} · {p.carrier}</div></td><td className="r">{mdy(p.expiration!)}</td></tr>
              ))}</tbody></table>
            ) : <div className="sub">No renewals through {mdy(addDays(today, 14))}.</div>}
          </Panel>
        </div>
      </div>
    </>
  )
}
