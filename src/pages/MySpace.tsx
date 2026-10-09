import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { ErrorBox, Loading, PageHead, Panel, Tile, Tiles } from '../components/ui'
import { daysUntil, getBookPolicies } from '../lib/books'
import { getFolios, getPolicies, getQuotes, isAdmin, type Policy, type QuoteLead } from '../lib/data'
import { addDays, mdy, money0, todayPacific } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'
import { RetentionTiles } from './Retention'
import { getWork, isDone } from './WorkQueue'

interface Item { id: number; area: string | null; name: string; priority: string | null; due_time: string | null; sort: number; active: boolean }
interface Lead { lead_id: string; name: string; producer: string; quoted_premium: number; quote_day: string | null; entered_stage: string | null; stage: string | null; tags: string | null; url: string | null }
/** Quote history (quote_leads) only goes back to this day, so the closing rate is measured from here. */
const QUOTES_FROM = '2026-07-20'
const pctTxt = (n: number) => (Math.round(n * 1000) / 10).toFixed(1) + '%'

export default function MySpace() {
  const { me, session } = useAuth()
  const admin = isAdmin(me?.role)
  const today = todayPacific()
  const first = (me?.display_name || '').split(' ')[0]
  const [reload, setReload] = useState(0)
  const [newItem, setNewItem] = useState('')
  const owner = me?.role === 'owner'
  // the retention role takes no new-business leads: My Space shows the retention scorecard instead of the pipeline
  const retentionRole = !!(me?.access as Record<string, unknown> | undefined)?.retention
  const [day, setDay] = useState(today)
  const rateFrom = today.slice(0, 4) + '-01-01'
  const yearFrom = today.slice(0, 4) + '-01-01' > QUOTES_FROM ? today.slice(0, 4) + '-01-01' : QUOTES_FROM
  const { data, error } = useAsync(async () => {
    const [items, ticks, work, book, folios, pipe, soldYr, quotesYr, history] = await Promise.all([
      supabase.from('checklist_items').select('*').eq('active', true).order('sort').then((r) => { if (r.error) throw r.error; return r.data as Item[] }),
      supabase.from('checklist_ticks').select('item_id,done').eq('day', today).then((r) => { if (r.error) throw r.error; return r.data as { item_id: number; done: boolean }[] }),
      getWork(), getBookPolicies(), getFolios(),
      supabase.from('az_pipeline').select('lead_id,name,producer,quoted_premium,quote_day,entered_stage,stage,tags,url').then((r) => (r.error ? [] : (r.data as Lead[]))),
      getPolicies(yearFrom, today), getQuotes(yearFrom, today),
      // AgencyZoom leads created since Jan 1 that were quoted or won: the closing rate's base
      supabase.from('az_lead_history').select('producer,quote_date,status').or(`quote_date.gte.${rateFrom},status.eq.2`).limit(10000)
        .then((r) => (r.error ? [] : (r.data as { producer: string; quote_date: string | null; status: number }[]))),
    ])
    return { items, ticks, work, book, folios, pipe, soldYr, quotesYr, history }
  }, [reload, today, yearFrom, rateFrom])

  const date = new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
  const head = <PageHead kicker={`${first ? first + '’s' : 'My'} space`} title={date} />
  if (error) return <>{head}<ErrorBox error={error} /></>
  if (!data) return <>{head}<Loading /></>

  // whose numbers: the owner sees the agency's, everyone else only their own (admins included)
  const names = new Set([me?.display_name, me?.producer_name].filter(Boolean).flatMap((n) => [n!.trim().toLowerCase(), n!.trim().split(/\s+/)[0].toLowerCase()]))
  const mineP = (p: string | null | undefined) => owner || (!!p && (names.has(p.trim().toLowerCase()) || names.has(p.trim().split(/\s+/)[0].toLowerCase())))
  const sum = (xs: { v: number }[]) => xs.reduce((a, x) => a + x.v, 0)
  const folio = data.folios.find((f) => f.in_progress) || data.folios[0]
  const pipe = data.pipe.filter((l) => mineP(l.producer)).map((l) => ({ ...l, quoted_premium: Number(l.quoted_premium) || 0 }))
  const prem = (ls: Lead[]) => ls.reduce((a, l) => a + l.quoted_premium, 0)
  const pipeFolio = folio ? pipe.filter((l) => l.quote_day && l.quote_day >= folio.start_date && l.quote_day <= folio.end_date) : []
  // high confidence = tagged "High Confidence" in AgencyZoom; every other quoted lead counts as low
  const isHigh = (l: Lead) => /\bhigh confidence\b/i.test(l.tags || '')
  const high = pipe.filter(isHigh), low = pipe.filter((l) => !isHigh(l))
  const sold: Policy[] = data.soldYr.filter((p) => mineP(p.producer))
  const quotes: QuoteLead[] = data.quotesYr.filter((q) => mineP(q.producer))
  // closing rate since Jan 1: AgencyZoom leads won ÷ leads quoted (a won lead counts as quoted even without a quote date)
  const rated = data.history.filter((h) => mineP(h.producer))
  const won = rated.filter((h) => Number(h.status) === 2).length
  const closeRate = rated.length ? won / rated.length : 0
  const soldFolio = folio ? sold.filter((p) => p.sale_date >= folio.start_date && p.sale_date <= folio.end_date) : []
  const writtenFolio = sum(soldFolio.map((p) => ({ v: p.premium })))
  const estimate = writtenFolio + prem(pipe) * closeRate
  const dayQuotes = quotes.filter((q) => q.quote_day === day), dayAdded = pipe.filter((l) => (l.quote_day || l.entered_stage) === day)
  const daySold = sold.filter((p) => p.sale_date === day)
  const who = owner ? 'Agency' : 'My'
  const done = new Set(data.ticks.filter((t) => t.done).map((t) => t.item_id))
  const pct = data.items.length ? Math.round((done.size / data.items.length) * 100) : 0
  const mine = data.work.filter((w) => !isDone(w) && first && (w.owner || '').toLowerCase().startsWith(first.toLowerCase()))
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
      {retentionRole ? <RetentionTiles name={me?.producer_name || me?.display_name || ''} /> : <>
      <Tiles>
        <Tile label={`${who} quoted pipeline · this folio`} value={money0(prem(pipeFolio))}
          sub={`${pipeFolio.length} open quote${pipeFolio.length === 1 ? '' : 's'}${folio ? ' since ' + mdy(folio.start_date) : ''} · ${money0(prem(pipe))} in pipeline overall`} />
        <Tile label="High confidence" value={money0(prem(high))} sub={`${high.length} lead${high.length === 1 ? '' : 's'} tagged High Confidence`} tone="good" />
        <Tile label="Low confidence" value={money0(prem(low))} sub={`${low.length} lead${low.length === 1 ? '' : 's'} not tagged High Confidence`} tone={low.length ? 'warn' : undefined} />
        <Tile label={owner ? 'Agency closing rate' : 'My closing rate'} value={pctTxt(closeRate)}
          sub={`${won} won of ${rated.length} quoted since ${mdy(rateFrom)}`} />
        <Tile label="Estimated folio close-out" value={money0(estimate)}
          sub={`${money0(writtenFolio)} written + ${money0(prem(pipe))} pipeline × ${pctTxt(closeRate)}`} tone="good" />
      </Tiles>
      <Panel title="Look up a day" sub={owner ? 'What the agency quoted, added to the pipeline and sold on the day you pick.' : 'What you quoted, added to your pipeline and sold on the day you pick.'}
        right={<input type="date" className="fld" value={day} max={today} onChange={(e) => setDay(e.target.value || today)} aria-label="Day" />}>
        <Tiles>
          <Tile label="Quoted" value={money0(dayQuotes.reduce((a, q) => a + q.quoted_premium, 0))} sub={`${dayQuotes.length} quote${dayQuotes.length === 1 ? '' : 's'} on ${mdy(day)}`} />
          <Tile label="Added to pipeline" value={money0(prem(dayAdded))} sub={`${dayAdded.length} lead${dayAdded.length === 1 ? '' : 's'} still in the quoted pipeline`} />
          <Tile label="Sold" value={money0(daySold.reduce((a, p) => a + p.premium, 0))} sub={`${daySold.length} polic${daySold.length === 1 ? 'y' : 'ies'}`} />
        </Tiles>
      </Panel>
      </>}
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
