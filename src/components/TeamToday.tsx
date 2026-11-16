// Team today, at the top of the owner's My Space: each person's focus (sales, retention & renewals, training…), who's
// out, and what they've done today from Declara — sales (life sales flagged), quotes, renewal reviews, calls, work
// completed. The owner marks someone out or changes a focus right on the card. Everyone else sees the life promo here.
import { useState } from 'react'
import { isLife } from '../lib/lifePromo'
import { money0, todayPacific } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

type Staff = { display: string | null; producer: string | null; role: string }
interface Day {
  staff: Staff[]
  completed: { id: number; owner: string | null; by: string | null }[]
  logged: { id: number; source: string }[]
  notes: { author: string | null }[]
  reviews: { name: string; spoke: boolean; call1: string | null; call2: string | null; findings: string | null; notes: string | null }[]
  retention: { name: string }[]
  calls: { by: string; result: string }[]
  sales: { producer: string; line: string | null; carrier: string | null; premium: number }[]
  quotes: { producer: string; premium: number | null }[]
}
const FOCUS = ['Sales', 'Retention & renewals', 'Training', 'Live transfers', 'Calls & work queue', 'Service', 'Commercial']
const byRole = (role: string) => (role === 'va' ? 'Calls & work queue' : role === 'sdr' ? 'Live transfers' : role === 'new_hire' ? 'Training' : 'Sales')
const COLORS = ['#4d60ff', '#01BCAF', '#F79009', '#12B76A', '#8b5cf6', '#FE454E', '#0ea5e9', '#d946ef']

async function load(day: string) {
  const [d, f, s] = await Promise.all([
    supabase.rpc('team_day', { p_day: day }).then((r) => { if (r.error) throw r.error; return r.data as Day | null }),
    supabase.from('team_focus').select('name, focus').then((r) => (r.error ? [] : (r.data as { name: string; focus: string }[]))),
    supabase.from('team_day_status').select('name, out, note').eq('day', day).then((r) => (r.error ? [] : (r.data as { name: string; out: boolean; note: string | null }[]))),
  ])
  return { d, f, s }
}

export default function TeamToday() {
  const today = todayPacific()
  const [tick, setTick] = useState(0)
  const { data, error } = useAsync(() => load(today), [today, tick])
  // nothing to show if the day couldn't be read (not the owner, or offline)
  if (error || !data || !data.d || !Array.isArray(data.d.staff)) return null
  const { d, f, s } = data
  const people = d.staff.filter((x) => x.role !== 'owner').map((x, i) => {
    const name = (x.display || x.producer || '').trim()
    const keys = new Set([x.display, x.producer, x.display?.split(' ')[0], x.producer?.split(' ')[0]].filter(Boolean).map((k) => k!.trim().toLowerCase()))
    const mine = (n: string | null | undefined) => !!n && keys.has(n.trim().replace(/\s+/g, ' ').toLowerCase())
    const sales = d.sales.filter((r) => mine(r.producer)), life = sales.filter((r) => isLife({ line: r.line, carrier: r.carrier })).length
    const quotes = d.quotes.filter((r) => mine(r.producer))
    const reviews = d.reviews.filter((r) => mine(r.name)), worked = reviews.filter((r) => (r.findings || '').trim() || (r.notes || '').trim())
    const reached = worked.filter((r) => r.spoke || r.call1 === 'reached' || r.call2 === 'reached').length
    const doneIds = new Set(d.completed.filter((r) => mine(r.by || r.owner)).map((r) => r.id))
    const logged = d.logged.filter((r) => mine(r.source.replace(/^logged by\s+/i, '')) && !doneIds.has(r.id)).length
    const st = s.find((r) => r.name === name)
    return {
      name, color: COLORS[i % COLORS.length], focus: f.find((r) => r.name === name)?.focus || byRole(x.role), out: !!st?.out, note: st?.note || '',
      sales: sales.length, prem: sales.reduce((a, r) => a + (Number(r.premium) || 0), 0), life, quotes: quotes.length, qprem: quotes.reduce((a, r) => a + (Number(r.premium) || 0), 0),
      reviews: reviews.length, worked: worked.length, reached, calls: d.calls.filter((r) => mine(r.by)).length, done: doneIds.size, logged,
      notes: d.notes.filter((r) => mine(r.author)).length, ret: d.retention.filter((r) => mine(r.name)).length,
    }
  }).filter((p) => p.name)
  const order = (p: (typeof people)[number]) => (p.out ? 1 : 0)
  people.sort((a, b) => order(a) - order(b) || FOCUS.indexOf(a.focus) - FOCUS.indexOf(b.focus) || a.name.localeCompare(b.name))
  const out = people.filter((p) => p.out)
  const sold = people.reduce((a, p) => a + p.sales, 0), prem = people.reduce((a, p) => a + p.prem, 0), life = people.reduce((a, p) => a + p.life, 0)

  const setOut = async (name: string, v: boolean) => {
    const { error: e } = await supabase.from('team_day_status').upsert({ name, day: today, out: v, updated_at: new Date().toISOString() }, { onConflict: 'agency_id,name,day' })
    if (e) alert(e.message); else setTick((n) => n + 1)
  }
  const setFocus = async (name: string, v: string) => {
    let focus = v
    if (v === '__other') { const t = prompt(`What is ${name.split(' ')[0]} focused on?`); if (!t?.trim()) return; focus = t.trim() }
    const { error: e } = await supabase.from('team_focus').upsert({ name, focus, updated_at: new Date().toISOString() }, { onConflict: 'agency_id,name' })
    if (e) alert(e.message); else setTick((n) => n + 1)
  }
  const long = new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })

  return (
    <section className="tt" aria-label="Team today">
      <span className="tt-shine" aria-hidden="true" />
      <div className="tt-head">
        <p className="tt-title">👋 Team today <span>· {long}</span></p>
        <p className="tt-sum">
          {people.length - out.length} in{out.length ? <> · <b>{out.map((p) => p.name.split(' ')[0]).join(' & ')} out</b></> : ''} · {sold} sale{sold === 1 ? '' : 's'} today{sold ? ` (${money0(prem)})` : ''}{life ? <> · <b className="tt-life">🎉 {life} life</b></> : ''}
        </p>
      </div>
      <div className="tt-grid">
        {people.map((p, i) => {
          const bits = [
            p.sales ? `${p.sales} sale${p.sales === 1 ? '' : 's'} · ${money0(p.prem)}` : '',
            p.quotes ? `${p.quotes} quote${p.quotes === 1 ? '' : 's'} · ${money0(p.qprem)}` : '',
            p.reviews ? `${p.worked} of ${p.reviews} reviews worked · ${p.reached} reached` : '',
            p.calls ? `${p.calls} call${p.calls === 1 ? '' : 's'}` : '',
            p.done + p.logged ? `${p.done + p.logged} task${p.done + p.logged === 1 ? '' : 's'} done` : '',
            p.ret ? `${p.ret} log entr${p.ret === 1 ? 'y' : 'ies'}` : '',
            p.notes ? `${p.notes} note${p.notes === 1 ? '' : 's'}` : '',
          ].filter(Boolean)
          return (
            <div key={p.name} className={'tt-p' + (p.out ? ' out' : '')} style={{ animationDelay: i * 0.06 + 's' }}>
              <div className="tt-top">
                <span className="tt-av" style={{ background: p.color }}>{p.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
                <div className="tt-who"><b>{p.name}</b>
                  <select className="tt-focus" value={FOCUS.includes(p.focus) ? p.focus : p.focus} onChange={(e) => setFocus(p.name, e.target.value)} aria-label={`${p.name}'s focus`}>
                    {!FOCUS.includes(p.focus) && <option value={p.focus}>{p.focus}</option>}
                    {FOCUS.map((x) => <option key={x} value={x}>{x}</option>)}<option value="__other">Other…</option>
                  </select></div>
                <button type="button" className={'tt-out' + (p.out ? ' on' : '')} onClick={() => setOut(p.name, !p.out)} title={p.out ? 'Mark back in today' : 'Mark out today'}>{p.out ? 'Out today' : 'In'}</button>
              </div>
              {p.out ? <div className="tt-line muted">Out today{p.note ? ` · ${p.note}` : ''}</div>
                : <div className="tt-line">{p.life ? <span className="tt-life">🎉 {p.life} life sold</span> : null}{bits.length ? bits.join(' · ') : <span className="muted">Nothing in Declara yet today</span>}</div>}
            </div>
          )
        })}
      </div>
    </section>
  )
}
