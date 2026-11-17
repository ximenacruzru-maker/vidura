// What everyone is up to today, from Declara: each person's focus (sales, retention & renewals, training…), who's out,
// and what they've done — sales (life sales flagged), quotes, renewal reviews, calls, work completed. Read from
// team_day() (owner, admins and whoever runs the work queue), team_focus and team_day_status. Used by the Team today
// card on the owner's My Space and by Team Space.
import { isLife } from './lifePromo'
import { supabase } from './supabase'

export type Staff = { display: string | null; producer: string | null; role: string }
export interface TeamDay {
  staff: Staff[]
  completed: { id: number; name: string; owner: string | null; by: string | null; priority: string }[]
  logged: { id: number; name: string; source: string; status: string }[]
  notes: { item: string; author: string | null; body: string; at: string }[]
  reviews: { name: string; client: string; spoke: boolean; call1: string | null; call2: string | null; emailed: boolean; findings: string | null; notes: string | null }[]
  retention: { name: string; kind: string; client: string }[]
  calls: { by: string; client: string; result: string }[]
  sales: { producer: string; client: string; line: string | null; carrier: string | null; premium: number }[]
  quotes: { producer: string; name: string; premium: number | null }[]
}
export const FOCUS = ['Sales', 'Retention & renewals', 'Training', 'Live transfers', 'Calls & work queue', 'Service', 'Commercial']
const byRole = (role: string) => (role === 'va' ? 'Calls & work queue' : role === 'sdr' ? 'Live transfers' : role === 'new_hire' ? 'Training' : 'Sales')
export const COLORS = ['#4d60ff', '#01BCAF', '#F79009', '#12B76A', '#8b5cf6', '#FE454E', '#0ea5e9', '#d946ef']
/** a name as compared: trimmed, runs of spaces made one, lower case */
export const tidyName = (n: string | null | undefined) => (n || '').trim().replace(/\s+/g, ' ').toLowerCase()

export async function loadTeamToday(day: string) {
  const [d, f, s] = await Promise.all([
    supabase.rpc('team_day', { p_day: day }).then((r) => { if (r.error) throw r.error; return r.data as TeamDay | null }),
    supabase.from('team_focus').select('name, focus').then((r) => (r.error ? [] : (r.data as { name: string; focus: string }[]))),
    supabase.from('team_day_status').select('name, out, note').eq('day', day).then((r) => (r.error ? [] : (r.data as { name: string; out: boolean; note: string | null }[]))),
  ])
  return { d, f, s }
}

/** each person (not the owner) with what they've done today, in today's order: in first, then by focus and name */
export function teamPeople({ d, f, s }: Awaited<ReturnType<typeof loadTeamToday>>) {
  if (!d || !Array.isArray(d.staff)) return null
  const people = d.staff.filter((x) => x.role !== 'owner').map((x, i) => {
    const name = (x.display || x.producer || '').trim()
    const keys = new Set([x.display, x.producer, x.display?.split(' ')[0], x.producer?.split(' ')[0]].filter(Boolean).map((k) => tidyName(k)))
    const mine = (n: string | null | undefined) => !!n && keys.has(tidyName(n))
    const sales = d.sales.filter((r) => mine(r.producer)), life = sales.filter((r) => isLife({ line: r.line, carrier: r.carrier })).length
    const quotes = d.quotes.filter((r) => mine(r.producer))
    const reviews = d.reviews.filter((r) => mine(r.name)), worked = reviews.filter((r) => (r.findings || '').trim() || (r.notes || '').trim())
    const reached = worked.filter((r) => r.spoke || r.call1 === 'reached' || r.call2 === 'reached').length
    const doneIds = new Set(d.completed.filter((r) => mine(r.by || r.owner)).map((r) => r.id))
    const logged = d.logged.filter((r) => mine(r.source.replace(/^logged by\s+/i, '')) && !doneIds.has(r.id)).length
    const st = s.find((r) => r.name === name)
    return {
      name, keys, mine, role: x.role, color: COLORS[i % COLORS.length], focus: f.find((r) => r.name === name)?.focus || byRole(x.role), out: !!st?.out, note: st?.note || '',
      sales: sales.length, prem: sales.reduce((a, r) => a + (Number(r.premium) || 0), 0), life, quotes: quotes.length, qprem: quotes.reduce((a, r) => a + (Number(r.premium) || 0), 0),
      reviews: reviews.length, worked: worked.length, reached, calls: d.calls.filter((r) => mine(r.by)).length, done: doneIds.size, logged,
      notes: d.notes.filter((r) => mine(r.author)).length, ret: d.retention.filter((r) => mine(r.name)).length,
    }
  }).filter((p) => p.name)
  people.sort((a, b) => (a.out ? 1 : 0) - (b.out ? 1 : 0) || FOCUS.indexOf(a.focus) - FOCUS.indexOf(b.focus) || a.name.localeCompare(b.name))
  return people
}
export type TeamPerson = NonNullable<ReturnType<typeof teamPeople>>[number]

/** a person's day in a few words: "2 sales · $1,840 · 3 quotes · $4,100 · 5 of 8 reviews worked · 3 reached …" */
export function personBits(p: TeamPerson, money: (n: number) => string) {
  return [
    p.sales ? `${p.sales} sale${p.sales === 1 ? '' : 's'} · ${money(p.prem)}` : '',
    p.quotes ? `${p.quotes} quote${p.quotes === 1 ? '' : 's'} · ${money(p.qprem)}` : '',
    p.reviews ? `${p.worked} of ${p.reviews} reviews worked · ${p.reached} reached` : '',
    p.calls ? `${p.calls} call${p.calls === 1 ? '' : 's'}` : '',
    p.done + p.logged ? `${p.done + p.logged} task${p.done + p.logged === 1 ? '' : 's'} done` : '',
    p.ret ? `${p.ret} log entr${p.ret === 1 ? 'y' : 'ies'}` : '',
    p.notes ? `${p.notes} note${p.notes === 1 ? '' : 's'}` : '',
  ].filter(Boolean)
}

export async function setTeamOut(day: string, name: string, out: boolean) {
  const { error } = await supabase.from('team_day_status').upsert({ name, day, out, updated_at: new Date().toISOString() }, { onConflict: 'agency_id,name,day' })
  if (error) throw error
}
export async function setTeamFocus(name: string, focus: string) {
  const { error } = await supabase.from('team_focus').upsert({ name, focus, updated_at: new Date().toISOString() }, { onConflict: 'agency_id,name' })
  if (error) throw error
}
