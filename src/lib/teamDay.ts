// The team recap: one email to the owner with what everyone did on a day, from Declara — Work & Tickets completed,
// logged and noted; renewal reviews; the retention log; call-list calls; sales and quotes. Built from team_day().
import { supabase } from './supabase'

interface Staff { display: string | null; producer: string | null; role: string }
interface Day {
  day: string; owner_email: string | null; staff: Staff[]
  completed: { id: number; name: string; owner: string | null; by: string | null; priority: string }[]
  logged: { id: number; name: string; owner: string | null; source: string; status: string }[]
  notes: { item: string; author: string | null; body: string; at: string }[]
  reviews: { name: string; kind: string; client: string; spoke: boolean; call1: string | null; call2: string | null; emailed: boolean; findings: string | null; notes: string | null }[]
  retention: { name: string; kind: string; client: string; premium: number | null; note: string | null }[]
  calls: { by: string; client: string; result: string; notes: string | null }[]
  sales: { producer: string; client: string; line: string | null; carrier: string | null; premium: number }[]
  quotes: { producer: string; name: string; premium: number | null }[]
}
export interface PersonDay { name: string; lines: { title: string; items: string[] }[]; count: number }

const usd = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
const short = (s: string | null | undefined, n = 140) => { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }
const RESULT: Record<string, string> = { reached: 'Reached', voicemail: 'Left voicemail', no_answer: 'No answer', not_interested: 'Not interested', wrong_number: 'Wrong number' }
const KIND: Record<string, string> = { save: 'Save', loss: 'Loss', cross_sell: 'Cross-sell', new_business: 'New business', review: 'Service' }

export async function getTeamDay(day: string) {
  const { data, error } = await supabase.rpc('team_day', { p_day: day })
  if (error) throw error
  const d = data as Day
  // each person and the names they go by (full, producer, first name)
  const people = d.staff.map((s) => {
    const name = (s.display || s.producer || '').trim()
    const keys = new Set([s.display, s.producer, s.display?.split(' ')[0], s.producer?.split(' ')[0]].filter(Boolean).map((x) => x!.trim().toLowerCase()))
    return { name, keys, role: s.role }
  }).filter((p) => p.name)
  const who = (n: string | null | undefined) => {
    const k = (n || '').trim().toLowerCase()
    if (!k) return null
    return people.find((p) => p.keys.has(k)) || people.find((p) => [...p.keys].some((x) => x.includes(' ') && k.startsWith(x))) || null
  }
  const out = new Map<string, PersonDay>()
  /** a person's section by title (made if new); `item` adds a line under it */
  const add = (n: string | null | undefined, title: string, item?: string) => {
    const p = who(n); const name = p?.name || (n || 'Unassigned').trim()
    if (!out.has(name)) out.set(name, { name, lines: [], count: 0 })
    const pd = out.get(name)!
    let sec = pd.lines.find((l) => l.title === title)
    if (!sec) { sec = { title, items: [] }; pd.lines.push(sec); if (item === undefined) pd.count++ }
    if (item !== undefined) { sec.items.push(item); pd.count++ }
  }
  const doneIds = new Set(d.completed.map((c) => c.id))
  d.completed.forEach((c) => add(c.by || c.owner, 'Completed', c.name + (c.priority && /critical|high/i.test(c.priority) ? ` (${c.priority})` : '')))
  d.logged.filter((l) => !doneIds.has(l.id)).forEach((l) => add(l.source.replace(/^logged by\s+/i, ''), 'Logged', `${l.name} · ${l.status}`))
  d.notes.forEach((n) => add(n.author, 'Notes on Work & Tickets', `${n.item}: ${short(n.body)}`))
  const reviewers = [...new Set(d.reviews.map((r) => r.name))]
  reviewers.forEach((nm) => {
    const rs = d.reviews.filter((r) => r.name === nm), worked = rs.filter((r) => (r.findings || '').trim() || (r.notes || '').trim())
    const reached = worked.filter((r) => r.spoke || r.call1 === 'reached' || r.call2 === 'reached').length
    const emailed = worked.filter((r) => !(r.spoke || r.call1 === 'reached' || r.call2 === 'reached') && r.emailed).length
    const title = `Renewal reviews: ${worked.length} of ${rs.length} worked · ${reached} reached · ${emailed} emailed`
    add(nm, title)
    worked.forEach((r) => { const res = r.spoke || r.call1 === 'reached' || r.call2 === 'reached' ? 'reached' : r.emailed ? 'emailed' : 'calling'; add(nm, title, `${r.client} (${res}): ${short(r.notes || r.findings, 110)}`) })
  })
  d.retention.forEach((r) => add(r.name, 'Retention log', `${KIND[r.kind] || r.kind}: ${r.client}${r.kind !== 'review' && r.premium ? ` ${usd(r.premium)}` : ''}${r.note ? ' · ' + short(r.note, 110) : ''}`))
  const callers = [...new Set(d.calls.map((c) => c.by))]
  callers.forEach((nm) => {
    const cs = d.calls.filter((c) => c.by === nm)
    const tally = Object.entries(cs.reduce((m, c) => ({ ...m, [c.result]: (m[c.result] || 0) + 1 }), {} as Record<string, number>)).map(([k, v]) => `${v} ${(RESULT[k] || k).toLowerCase()}`).join(', ')
    cs.forEach((c) => add(nm, `Call list: ${cs.length} call${cs.length === 1 ? '' : 's'} (${tally})`, `${c.client}: ${RESULT[c.result] || c.result}${c.notes ? ' · ' + short(c.notes, 100) : ''}`))
  })
  const sellers = [...new Set(d.sales.map((s) => s.producer))]
  sellers.forEach((nm) => {
    const ss = d.sales.filter((s) => s.producer === nm)
    ss.forEach((s) => add(nm, `Sales: ${ss.length} polic${ss.length === 1 ? 'y' : 'ies'}, ${usd(ss.reduce((a, x) => a + Number(x.premium || 0), 0))}`, `${s.client} · ${[s.line, s.carrier].filter(Boolean).join(' · ')} · ${usd(s.premium)}`))
  })
  const quoters = [...new Set(d.quotes.map((q) => q.producer))]
  quoters.forEach((nm) => {
    const qs = d.quotes.filter((q) => q.producer === nm)
    add(nm, `Quotes: ${qs.length}, ${usd(qs.reduce((a, x) => a + Number(x.premium || 0), 0))} quoted`)
  })
  const order = (n: string) => { const p = people.find((x) => x.name === n); return p?.role === 'owner' ? 1 : 0 }
  const list = [...out.values()].sort((a, b) => order(a.name) - order(b.name) || b.count - a.count || a.name.localeCompare(b.name))
  const quiet = people.filter((p) => p.role !== 'owner' && !out.has(p.name)).map((p) => p.name)
  return { day: d.day, to: d.owner_email || '', people: list, quiet }
}

/** the recap as plain text for the email */
export function recapText(r: Awaited<ReturnType<typeof getTeamDay>>, agency: string) {
  const long = new Date(r.day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  const out = [`Team recap · ${long}`, `What everyone did today, from Declara.`, '']
  for (const p of r.people) {
    out.push(p.name.toUpperCase())
    for (const l of p.lines) {
      out.push(`  ${l.title}${l.items.length && !/^Renewal|^Call list|^Sales|^Quotes/.test(l.title) ? ` (${l.items.length})` : ''}`)
      l.items.slice(0, 12).forEach((it) => out.push(`   • ${it}`))
      if (l.items.length > 12) out.push(`   • …and ${l.items.length - 12} more`)
    }
    out.push('')
  }
  if (r.quiet.length) out.push(`No activity in Declara today: ${r.quiet.join(', ')}.`, '')
  out.push(`— ${agency} · sent from Declara`)
  return out.join('\n')
}
