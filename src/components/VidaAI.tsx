import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { can } from '../lib/access'
import { bookLabel, daysUntil, getAccounts, getBookPolicies, getReference, type Account, type BookPolicy } from '../lib/books'
import { getFolios, getPolicies, getQuotes, type StaffAccount } from '../lib/data'
import { mdy, money0, money2, todayPacific } from '../lib/format'
import { supabase } from '../lib/supabase'
import { getWork, isDone } from '../pages/WorkQueue'

/* Vida AI: answers questions from the agency's own data — the book, markets, the Farmers appetite guide,
   training notes, licenses, work and (for the people allowed to see them) sales and commissions.
   Rule and search based, like the original: nothing leaves the agency's database. */

interface Answer { body: ReactNode; go?: { to: string; label: string } }
interface Msg { who: 'me' | 'ai'; q?: string; a?: Answer }

const once = new Map<string, Promise<any>>()
const cached = <T,>(k: string, f: () => Promise<T>): Promise<T> => {
  if (!once.has(k)) once.set(k, f().catch((e) => { once.delete(k); throw e }))
  return once.get(k)!
}
const book = () => cached('book', async () => {
  const [accounts, policies] = await Promise.all([getAccounts(), getBookPolicies()])
  return { accounts, policies, byId: new Map(accounts.map((a) => [a.id, a])) }
})
const ref = <T,>(k: string) => cached('ref:' + k, () => getReference<T>(k))

const norm = (s: string | null | undefined) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const tight = (s: string | null | undefined) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const L = ({ items, max = 10 }: { items: ReactNode[]; max?: number }) => (
  <>
    <ul className="ai-list">{items.slice(0, max).map((x, i) => <li key={i}>{x}</li>)}</ul>
    {items.length > max && <div className="sub">…and {items.length - max} more.</div>}
  </>
)
const APP: Record<string, string> = { Y: 'Yes', N: 'No', M: 'Maybe' }
const STOP = /^(does|do|is|are|farmers|write|the|a|an|for|of|in|with|can|we|will|what|appetite|eligible|accept|take|insure|cover|coverage|bop|gl|auto|wc|umbrella|policy|business|commercial|quote|ca|california|who|how|me|about|on|to|i|my|our|show|tell)$/

export const CHIPS: { q: string; need?: string }[] = [
  { q: 'Who qualified for commission this folio?' },
  { q: 'Top producer this folio', need: 'performance' },
  { q: 'What sold today?' },
  { q: 'What is overdue?', need: 'work' },
  { q: 'What renews in the next 30 days?', need: 'books' },
  { q: 'What is expired?', need: 'books' },
  { q: 'Premium by carrier', need: 'books' },
  { q: 'Which clients are monoline?', need: 'books' },
  { q: 'When do our licenses expire?' },
  { q: 'Who do I quote a wildfire home with?', need: 'resources' },
  { q: 'Does Farmers write roofing contractors?', need: 'resources' },
  { q: 'What are the CA required auto limits?' },
  { q: 'Explain deductibles' },
]

/* ---------- the answer engine ---------- */
async function answer(qRaw: string, me: StaffAccount | null, ctx: { client?: Account }): Promise<Answer> {
  const q = qRaw.toLowerCase().trim()
  const c = (k: string) => can(me, k)
  const today = todayPacific()
  const days = Number((q.match(/(\d+)\s*day/) || [])[1]) || 0

  // "yes / more" continues with the last client
  if (ctx.client && /^(yes|yeah|yep|sure|ok|okay|please|more|details?|go ahead|show me|list them)\b/.test(q)) return clientAnswer(ctx.client, true)

  const appetiteQ = /appetite|does farmers (write|take|accept|insure|cover)|can we (write|quote|place)|eligible|\bsic\b|kraft lake/.test(q) || (/farmers|commercial|business insurance|bop|\bgl\b|\bwc\b/.test(q) && /write|quote|appetite|accept|eligible|take/.test(q))
  if (appetiteQ && c('resources')) { const a = await appetite(q); if (a) return a }

  if (c('books')) { const cl = await findClient(q); if (cl) { ctx.client = cl; return clientAnswer(cl, false) } }

  if (/commission|qualif|tier rate|comp plan|payout|my pay/.test(q)) return commission(q, c('performance'))

  if (/top producer|best producer|who (is|was) (the )?top|leader ?board|\brank/.test(q)) {
    if (!c('performance')) return { body: 'Producer rankings are on the admin Performance pages. Your own numbers are under My Pay.', go: { to: '/pay', label: 'Open My Pay' } }
    const f = (await getFolios())[/last|previous|closed/.test(q) ? 1 : 0]
    if (!f) return { body: 'No folio on file yet.' }
    const sold = await getPolicies(f.start_date, f.end_date)
    const by = new Map<string, { p: number; n: number }>()
    for (const s of sold) { const x = by.get(s.producer) || { p: 0, n: 0 }; x.p += s.premium; x.n++; by.set(s.producer, x) }
    const rows = [...by.entries()].sort((a, b) => b[1].p - a[1].p)
    return { body: <>Folio <b>{f.label}</b>, written premium by producer:<L items={rows.map(([k, v], i) => <><b>#{i + 1} {k}</b> — {money2(v.p)} · {v.n} policies</>)} /></>, go: { to: '/reports', label: 'Open Reports' } }
  }

  if (/sold today|sales today|written today|what sold|today.?s sales|quoted today|quotes today/.test(q)) {
    const [sold, quotes] = await Promise.all([getPolicies(today, today), getQuotes(today, today)])
    const scope = c('performance') ? '' : ' (yours)'
    return {
      body: <>Today{scope}: <b>{sold.length}</b> polic{sold.length === 1 ? 'y' : 'ies'} sold for <b>{money2(sold.reduce((s, p) => s + p.premium, 0))}</b>; {quotes.length} leads quoted ({money0(quotes.reduce((s, x) => s + x.quoted_premium, 0))}).
        {sold.length > 0 && <L items={sold.map((x) => <><b>{x.client}</b> — {x.line} ({x.carrier}) {money2(x.premium)} · {x.producer}</>)} />}</>,
      go: c('performance') ? { to: '/sales', label: 'Open Sales KPIs' } : undefined,
    }
  }

  if (/overdue|past due|open work|work items|tickets|my work/.test(q) && c('work')) {
    const work = await getWork()
    const open = work.filter((w) => !isDone(w))
    const od = open.filter((w) => (daysUntil(w.due, today) ?? 0) < 0).sort((a, b) => (a.due! < b.due! ? -1 : 1))
    return { body: <>{open.length} open work items, <b>{od.length} overdue</b>.{od.length > 0 && <L items={od.map((w) => <><b>{w.name}</b> — {w.owner || 'unassigned'} · due {mdy(w.due!)} · {w.area}</>)} />}</>, go: { to: '/work', label: 'Open Work & Tickets' } }
  }

  if (/licen[cs]e/.test(q)) {
    const { data, error } = await supabase.from('licenses').select('name,state,license_type,expires').order('expires')
    if (error) throw error
    const rows = (data || []) as { name: string; state: string | null; license_type: string | null; expires: string | null }[]
    const soon = rows.filter((l) => { const d = daysUntil(l.expires, today); return d != null && d <= 90 })
    return {
      body: <>Licenses on file, soonest first:<L items={rows.map((l) => { const d = daysUntil(l.expires, today); return <><b>{l.name}</b> — {[l.state, l.license_type].filter(Boolean).join(' ')} · {l.expires ? mdy(l.expires) : 'no date'}{d != null && d < 0 ? <span className="ai-bad"> (expired)</span> : d != null && d <= 90 ? <span className="ai-warn"> ({d} days)</span> : null}</> })} max={8} />
        {soon.length > 0 && <div>{soon.length} expire inside 90 days.</div>}</>,
      go: { to: '/hr', label: 'Open Licensing' },
    }
  }

  if (/wildfire|brush|delos/.test(q)) return { body: <>For wildfire-exposed homes the order is <b>Bamboo</b>, then <b>Aegis</b>, then <b>Delos</b>. Delos is the brush-scored market the other two decline.</>, go: { to: '/resources', label: 'Open Carriers' } }

  if (/carrier|market|who do i quote|where do i (quote|place)|portal/.test(q) && !/premium/.test(q) && c('resources')) {
    const mk = (await ref<any[]>('markets')) || []
    const pick = mk.filter((g) => q.includes(String(g.label).toLowerCase().replace(/s$/, '')) || q.includes(String(g.key)))
    const groups = pick.length ? pick : mk
    const pol = c('books') ? (await book()).policies : []
    const stat = (m: string) => { const rx = new RegExp(m, 'i'); const ps = pol.filter((p) => rx.test(p.carrier || '')); return ps.length ? `${money0(ps.reduce((s, p) => s + (p.premium || 0), 0))} across ${ps.length}` : '' }
    return {
      body: <>Markets{pick.length ? '' : ' by line'}, in shopping order:{groups.map((g) => (
        <div key={g.key} className="ai-grp"><b>{g.label}</b>
          <L items={(g.carriers || []).map((m: any) => <><b>{m.name}</b>{m.blurb ? ` — ${m.blurb}` : ''}{m.match && stat(m.match) ? <span className="sub"> · {stat(m.match)} in the book</span> : null}{m.portal && <> · <a href={m.portal} target="_blank" rel="noreferrer">{m.portalLabel || 'portal'}</a></>}</>)} max={6} />
        </div>))}</>,
      go: { to: '/resources', label: 'Open Carriers & markets' },
    }
  }

  if (c('books')) {
    const { policies, byId } = await book()
    const sum = (a: BookPolicy[]) => a.reduce((s, r) => s + (r.premium || 0), 0)
    const who = (p: BookPolicy) => byId.get(p.account_id)?.name || p.insured || 'Client'
    if (/premium/.test(q) && /carrier/.test(q)) {
      const m = new Map<string, number>(); policies.forEach((r) => m.set(r.carrier || '—', (m.get(r.carrier || '—') || 0) + (r.premium || 0)))
      return { body: <>Premium by carrier across the P&amp;C book:<L items={[...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => <><b>{k}</b> — {money0(v)}</>)} /></> }
    }
    if (/expired|lapse|cancel/.test(q)) {
      const bad = policies.filter((r) => /cancel|lapse|non-?renew/i.test(r.status || '') || (daysUntil(r.expiration, today) ?? 0) < 0)
      if (!bad.length) return { body: 'Nothing in the book is expired, cancelled or lapsed right now.' }
      return { body: <><b>{bad.length} policies</b> are expired, cancelled or lapsed, carrying {money0(sum(bad))} of premium:<L items={bad.sort((a, b) => (b.premium || 0) - (a.premium || 0)).map((r) => <>{who(r)} — {r.product} · {r.carrier}{r.expiration ? ` · ${mdy(r.expiration)}` : ''}{r.premium ? ` · ${money0(r.premium)}` : ''}</>)} /></>, go: { to: '/books/farmers?renewals=1', label: 'Review renewals' } }
    }
    if (/monoline|single policy|cross.?sell|one policy/.test(q)) {
      const per = new Map<string, BookPolicy[]>(); policies.forEach((p) => per.set(p.account_id, [...(per.get(p.account_id) || []), p]))
      const mono = [...per.entries()].filter(([, ps]) => ps.length === 1).map(([id, ps]) => ({ a: byId.get(id), p: ps[0] })).filter((x) => x.a).sort((a, b) => (b.p.premium || 0) - (a.p.premium || 0))
      return { body: <><b>{mono.length}</b> clients carry exactly one policy — cross-sell candidates. Largest by premium:<L items={mono.map((x) => <>{x.a!.name} — {x.p.product} · {x.p.premium ? money0(x.p.premium) : 'no premium'} <span className="sub">({bookLabel(x.a!.book)})</span></>)} /></> }
    }
    if (/renew|due|coming up|expir/.test(q)) {
      const win = days || 30
      const up = policies.filter((r) => { const d = daysUntil(r.expiration, today); return d != null && d >= 0 && d <= win }).sort((a, b) => (a.expiration! < b.expiration! ? -1 : 1))
      if (!up.length) return { body: `Nothing renews in the next ${win} days.`, go: { to: '/books/farmers?renewals=1', label: 'Review renewals' } }
      return { body: <><b>{up.length} policies</b> renew in the next {win} days, {money0(sum(up))} of premium:<L items={up.map((r) => <>{who(r)} — {r.product} · {mdy(r.expiration!)}{r.premium ? ` · ${money0(r.premium)}` : ''}</>)} /></>, go: { to: '/books/farmers?renewals=1', label: 'Review renewals' } }
    }
    if (/how many|count|total|\bbook\b|how much/.test(q) && !/commission/.test(q)) {
      return { body: <>The P&amp;C book holds <b>{policies.length} policies</b> across <b>{byId.size} clients</b>, {money0(sum(policies))} of premium. {policies.filter((r) => (r.premium || 0) > 0).length} have a premium on file; {policies.filter((r) => !r.expiration).length} have no expiration date.</>, go: { to: '/books/farmers', label: 'Open Books of Business' } }
    }
  }

  // Farmers training notes
  const kb = (await ref<{ k: string; t: string; a: string }[]>('farmers_kb')) || []
  const qw = norm(q).split(' ').filter((w) => w.length > 2 && !STOP.test(w))
  const hit = kb.find((e) => { try { return e.k && new RegExp(e.k, 'i').test(q) } catch { return false } })
    || kb.map((e) => ({ e, n: qw.filter((w) => norm(e.t).includes(w.replace(/s$/, ''))).length })).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n)[0]?.e
  if (hit) return { body: <><b>{hit.t}</b><p>{hit.a}</p><div className="sub">From the training notes. Check carrier guidelines before relying on it for a specific risk.</div></>, go: { to: '/training', label: 'Open Training' } }

  if (c('resources')) { const a = await appetite(q); if (a) return a }

  // Anything else: search the book, markets and resources
  const words = norm(q).split(' ').filter((w) => w.length > 2 && !STOP.test(w))
  if (words.length) {
    const hits: ReactNode[] = []
    if (c('books')) {
      const { accounts } = await book()
      accounts.filter((a) => words.every((w) => norm(`${a.name} ${a.dba} ${a.contact} ${a.address}`).includes(w))).slice(0, 5)
        .forEach((a) => hits.push(<><b>{a.name}</b> — client, {bookLabel(a.book)}</>))
    }
    if (c('resources')) {
      const res = (await ref<any[]>('resources')) || []
      res.filter((r) => words.some((w) => norm(`${r.title} ${r.note} ${r.cat}`).includes(w))).slice(0, 4).forEach((r) => hits.push(<><b>{r.title}</b> — {r.cat}</>))
    }
    if (hits.length) return { body: <>Here is what matches in the agency’s records:<L items={hits} /></> }
  }
  return { body: <>I couldn’t find that in the agency’s records. Try a client name, a policy number, a line of business (“roofing contractor BOP”), or one of the suggestions below.</> }
}

async function findClient(q: string): Promise<Account | undefined> {
  const { accounts, policies, byId } = await book()
  const t = tight(q)
  if (t.length < 4) return undefined
  // a policy number anywhere in the question
  const pn = policies.find((p) => p.policy_number && tight(p.policy_number).length >= 5 && t.includes(tight(p.policy_number)))
  if (pn) return byId.get(pn.account_id)
  const named = accounts.filter((a) => { const n = tight(a.name); const d = tight(a.dba); return (n.length >= 5 && t.includes(n)) || (d.length >= 5 && t.includes(d)) })
  if (named.length) return named.sort((a, b) => tight(b.name).length - tight(a.name).length)[0]
  // the question is just part of a name ("maria's tacos")
  const bare = norm(q).replace(/^(who is|tell me about|show me|look up|find|open|client|customer)\s+/, '')
  if (bare.length >= 4 && bare.split(' ').length <= 5 && !/\?$/.test(q.trim())) {
    const part = accounts.filter((a) => norm(`${a.name} ${a.dba}`).includes(bare))
    if (part.length === 1) return part[0]
  }
  return undefined
}

async function clientAnswer(a: Account, full: boolean): Promise<Answer> {
  const { policies } = await book()
  const today = todayPacific()
  const ps = policies.filter((p) => p.account_id === a.id)
  const total = ps.reduce((s, p) => s + (p.premium || 0), 0)
  const next = ps.map((p) => p.expiration).filter((x): x is string => !!x && (daysUntil(x, today) ?? -1) >= 0).sort()[0]
  return {
    body: <>
      <b>{a.name}</b>{a.dba ? ` (dba ${a.dba})` : ''} — {bookLabel(a.book)}, {ps.length} polic{ps.length === 1 ? 'y' : 'ies'}, {money0(total)} premium{next ? `, next expiration ${mdy(next)}` : ''}.
      <L items={ps.map((p) => <>{p.product || 'Policy'} · {p.carrier} · <span className="mono">{p.policy_number || '—'}</span>{p.expiration ? ` · exp ${mdy(p.expiration)}` : ''}{p.premium != null ? ` · ${money0(p.premium)}` : ''}</>)} max={full ? 40 : 6} />
      {(a.contact || a.phone || a.address) && <div className="sub">{[a.contact, a.phone, a.address].filter(Boolean).join(' · ')}</div>}
      {a.producer && <div className="sub">Producer: {a.producer}</div>}
      {!full && ps.length > 6 && <div className="sub">Say “more” for every policy.</div>}
    </>,
    go: { to: `/books/${a.book}?open=${encodeURIComponent(a.id)}`, label: 'Open the client record' },
  }
}

async function appetite(q: string): Promise<Answer | null> {
  const bi = await ref<{ code: string; rows: { c: Record<string, string>; d: string; n: string; p: number; s: string; sic: string }[] }>('farmers_bi')
  if (!bi) return null
  const terms = q.split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.test(t))
  if (!terms.length) return null
  const score = (r: (typeof bi.rows)[0]) => {
    const d = (r.d + ' ' + r.s).toLowerCase(); let s = 0
    terms.forEach((t) => { if (d.includes(t)) s += 2; else if (t.length > 4 && d.includes(t.slice(0, -1))) s += 1 })
    if (r.sic && q.includes(r.sic.toLowerCase())) s += 5
    return s
  }
  const hits = bi.rows.map((r) => ({ r, s: score(r) })).filter((x) => x.s >= 2).sort((a, b) => b.s - a.s).slice(0, 4).map((x) => x.r)
  if (!hits.length) return null
  const best = hits[0]
  const e = Object.entries(best.c)
  const ys = e.filter(([, v]) => v === 'Y').map(([k]) => k), ns = e.filter(([, v]) => v === 'N').map(([k]) => k), ms = e.filter(([, v]) => v === 'M').map(([k]) => k)
  return {
    body: <>
      <b>Farmers Business Insurance Appetite Guide</b> <span className="sub">({bi.code})</span>
      <table className="ai-t"><thead><tr><th>Class</th><th>SIC</th><th>Appetite</th></tr></thead><tbody>
        {hits.map((r, i) => <tr key={i}><td><b>{r.d}</b><div className="sub">{r.s} · p.{r.p}</div></td><td className="mono">{r.sic}</td>
          <td>{Object.entries(r.c).map(([k, v]) => <span key={k} className={'ai-ap ai-ap-' + v}>{k}: {APP[v] || v}</span>)}{r.n && <div className="sub">{r.n}</div>}</td></tr>)}
      </tbody></table>
      <p><b>{best.d}</b> (SIC {best.sic}): {ys.length ? <>quote <b>{ys.join(', ')}</b></> : 'nothing is a straight yes'}{ms.length ? `; ${ms.join(', ')} need underwriting review` : ''}{ns.length ? `; ${ns.join(', ')} are not eligible — send those to Kraft Lake (1-800-339-3114)` : ''}.</p>
    </>,
    go: { to: '/resources', label: 'Open the appetite guide' },
  }
}

async function commission(q: string, all: boolean): Promise<Answer> {
  const folios = await getFolios()
  const f = folios[/last|previous|closed/.test(q) ? 1 : 0]
  if (!f) return { body: 'No folio on file yet.' }
  const { data, error } = await supabase.functions.invoke('commissions', { body: { folio: f.start_date } })
  if (error) return { body: 'I couldn’t calculate commissions just now.' }
  const rs = ((data?.results || []) as { producer: string; total: number; totalPremium: number; qualifies: boolean; tierRate: number; policies: number }[]).sort((a, b) => b.total - a.total)
  const go = all ? { to: '/commissions', label: 'Open Commissions' } : { to: '/pay', label: 'Open My Pay' }
  if (!rs.length) return { body: `No commission results for folio ${f.label}.`, go }
  if (!all || data?.scope === 'self') {
    const r = rs[0]
    return { body: <>Folio <b>{f.label}</b>{f.in_progress && !/progress/i.test(f.label) ? ' (running)' : ''}: you have <b>{money2(r.totalPremium)}</b> credited on {r.policies} policies. {r.qualifies ? <>You qualify at {(r.tierRate * 100).toFixed(0)}% → <b>{money2(r.total)}</b>.</> : 'You haven’t qualified yet this folio.'}</>, go }
  }
  return {
    body: <>Folio <b>{f.label}</b>{f.in_progress && !/progress/i.test(f.label) ? ' (running)' : ''} under <b>{data.plan?.name}</b>: {rs.filter((r) => r.qualifies).length} of {rs.length} producers qualify; {money2(rs.reduce((a, r) => a + r.total, 0))} payable.
      <L items={rs.map((r) => <><b>{r.producer}</b> — {money2(r.totalPremium)} written, {r.qualifies ? <>qualifies at {(r.tierRate * 100).toFixed(0)}% → <b>{money2(r.total)}</b></> : 'not qualified'}</>)} max={12} /></>,
    go,
  }
}

/* ---------- the button and panel ---------- */
export default function VidaAI() {
  const { me } = useAuth()
  const go = useNavigate()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const ctx = useRef<{ client?: Account }>({})
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [msgs, busy])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k)
  }, [])

  const ask = async (text: string) => {
    const t = text.trim(); if (!t || busy) return
    setQ(''); setMsgs((m) => [...m, { who: 'me', q: t }]); setBusy(true)
    let a: Answer
    try { a = await answer(t, me, ctx.current) } catch (e: any) { a = { body: 'Something went wrong looking that up: ' + (e?.message || e) } }
    setMsgs((m) => [...m, { who: 'ai', a }]); setBusy(false)
  }
  const chips = CHIPS.filter((x) => !x.need || can(me, x.need))

  return (
    <>
      <button className="hd-kai" onClick={() => setOpen(true)} aria-label="Open Vida AI">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5zM5 15.5l.9 2.6 2.6.9-2.6.9L5 22.5l-.9-2.6-2.6-.9 2.6-.9.9-2.6z" /></svg>
        <span>Vida AI</span>
      </button>
      {open && createPortal(
        <div className="drawer-bg" onClick={() => setOpen(false)}>
          <aside className="drawer ai-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Vida AI">
            <div className="drawer-h">
              <div><div className="panel-t">Vida AI</div><div className="panel-s">Answers from Ironwood’s own book, markets, appetite guide, training and sales.</div></div>
              <div className="row-actions">
                {msgs.length > 0 && <button className="btn-ghost" onClick={() => { setMsgs([]); ctx.current = {} }}>Clear</button>}
                <button className="btn-ghost" onClick={() => setOpen(false)}>Close</button>
              </div>
            </div>
            <div className="ai-log">
              {!msgs.length && <div className="ai-hello">Ask about a client, a policy number, renewals, a carrier, whether Farmers writes a class of business, licenses, or {can(me, 'performance') ? 'sales and commissions' : 'your commission'}.</div>}
              {msgs.map((m, i) => m.who === 'me'
                ? <div key={i} className="ai-me">{m.q}</div>
                : <div key={i} className="ai-a">{m.a!.body}{m.a!.go && <div><button className="ai-go" onClick={() => { setOpen(false); go(m.a!.go!.to) }}>{m.a!.go.label} →</button></div>}</div>)}
              {busy && <div className="ai-a ai-think">Looking that up…</div>}
              <div ref={end} />
            </div>
            <div className="ai-foot">
              <div className="ai-chips">{chips.map((x) => <button key={x.q} className="chip" onClick={() => ask(x.q)} disabled={busy}>{x.q}</button>)}</div>
              <form className="ai-ask" onSubmit={(e) => { e.preventDefault(); ask(q) }}>
                <input className="fld" autoFocus placeholder="Ask Vida…" value={q} onChange={(e) => setQ(e.target.value)} />
                <button className="btn-primary" disabled={busy || !q.trim()}>Ask</button>
              </form>
            </div>
          </aside>
        </div>, document.body
      )}
    </>
  )
}
