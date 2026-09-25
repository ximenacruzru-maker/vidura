import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  analyseSources, loadForesight, producerRanking, project, recommend, savedRate, weekdayPattern, windowFor, type ForesightData, type SourceStat, type Window,
} from '../lib/foresight'
import { money0, shortDate, todayPacific } from '../lib/format'

/* Foresight AI: answers Vida Foresight questions — best selling day, top producer, lead-source returns,
   where to shift spend, what a spend change would do — from the same calculations as the Foresight page.
   Rule based like Vida AI: nothing leaves the agency's database, and every projection says it's linear. */

interface Answer { body: ReactNode; go?: boolean }
interface Msg { who: 'me' | 'ai'; q?: string; a?: Answer }

export const FORESIGHT_CHIPS = [
  'Which day do we sell the most?',
  'Who is our top producer this year?',
  'What does each lead source return?',
  'Where should we shift lead spend?',
  'What if we spent 20% more on our best source?',
  'What if we lost our top producer?',
]
const pct = (n: number, d = 0) => (n * 100).toFixed(d) + '%'
const signed = (n: number, f: (x: number) => string) => (n > 0 ? '+' : n < 0 ? '−' : '') + f(Math.abs(n))
const perDollar = (n: number | null) => (n == null ? '—' : '$' + n.toFixed(2))
const tight = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const L = ({ items }: { items: ReactNode[] }) => <ul className="ai-list">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/** "aug 1", "august 1st 2026", "8/1", "8/1/2026", "2026-08-01" → ISO date (this year when none given). */
function parseDate(t: string, year: string): string | null {
  t = t.trim().replace(/(st|nd|rd|th),?$/, '').replace(',', '')
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return t
  m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
  if (m) { const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : year; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` }
  m = t.match(/^([a-z]{3})[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/)
  if (m && MONTHS.includes(m[1])) return `${m[3] || year}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return null
}
/** The period a question names; year to date when it names none. */
function periodOf(q: string): { key: string; label: string; range?: Window } {
  const r = q.match(/(?:from|between|since)\s+([a-z0-9/ .-]+?)\s+(?:to|and|through|thru|until|-)\s+([a-z0-9/ .-]+?)(?:[?.!,]|$| for | on | with )/)
  if (r) {
    const year = todayPacific().slice(0, 4), a = parseDate(r[1], year), b = parseDate(r[2], year)
    if (a && b) { const range = a <= b ? { from: a, to: b } : { from: b, to: a }; return { key: 'custom', label: 'that range', range } }
  }
  const n = q.match(/last (\d+) days?/)
  if (n) return { key: n[1], label: `the last ${n[1]} days` }
  if (/this month|month to date|mtd/.test(q)) return { key: 'mtd', label: 'this month' }
  if (/12 months|last year|past year|twelve months/.test(q)) return { key: '365', label: 'the last 12 months' }
  if (/all time|ever|all history|since the start/.test(q)) return { key: 'all', label: 'all history' }
  return { key: 'ytd', label: 'year to date' }
}
const span = (w: Window) => `${shortDate(w.from, true)} – ${shortDate(w.to, true)}`

function answer(qRaw: string, D: ForesightData): Answer {
  const q = qRaw.toLowerCase()
  const today = todayPacific()
  const first = D.sales.reduce((m, s) => (s.sale_date < m ? s.sale_date : m), today)
  const p = periodOf(q)
  const w = windowFor(p.key, today, first, p.range)
  const when = `${p.label} (${span(w)})`

  const sourcesAnswer = () => {
    const a = analyseSources(D, w)
    return { a, plan: recommend(a), paid: a.sources.filter((s) => s.spend > 0) }
  }
  const coverageNote = (a: ReturnType<typeof analyseSources>) => a.coverage < 0.8
    ? <div className="sub">Only {pct(a.coverage)} of sold premium in {p.label} can be tied to a lead source, so these figures are partial.</div> : null

  // what if a producer left (fired, quit, let go…)
  const producerLoss = (): Answer | null => {
  if (!(/\b(fire|fired|firing|let (her|him|them)? ?go|lose|lost|losing|leave|leaves|left|quit|quits|without|remove|terminate|replace|gone)\b/.test(q))) return null
    const all = producerRanking(D.sales, { from: first, to: today })
    const words = q.replace(/[^a-z ]/g, ' ').split(/\s+/).filter((x) => x.length >= 3)
    let who = all.find((r) => r.producer.toLowerCase().split(/\s+/).some((part) => part.length >= 3 && words.includes(part)))?.producer
    if (!who && /(top|best|biggest|leading) (producer|agent|seller)/.test(q)) who = producerRanking(D.sales, w)[0]?.producer
    const explicit = /\b(fire|fired|firing|let (her|him|them)? ?go|quit|quits|terminate)\b/.test(q)
    if (!who && !explicit) return null // "lose" etc. without a producer: not a producer question
    if (!who) {
      const named = words.find((x) => !/^(what|if|we|fired|fire|lost|lose|our|the|how|much|would|business|revenue|impact|impacted|happen|who|left|quit|leave|without|and|terms|stuff|like|that|my|with|producer|agent|she|he|her|him|them|they|let|go|gone)$/.test(x))
      return { body: <>{named ? <>No sold policies in the data are credited to anyone named “{named}”. </> : ''}Producers with sales on file: {all.map((r) => r.producer).join(', ') || 'none'}.</> }
    }
    const rows = producerRanking(D.sales, w)
    const me = rows.find((r) => r.producer === who)
    if (!me) return { body: <>{who} has no sold policies in {when}, so nothing written in that period depends on them.</> }
    const elapsed = Math.max(1, Math.round((Date.parse(w.to) - Date.parse(w.from)) / 86400000) + 1)
    const perMonth = (me.premium / elapsed) * 30.4375, perPolicies = (me.policies / elapsed) * 30.4375
    const yearEnd = today.slice(0, 4) + '-12-31'
    const rest = Math.max(0, Math.round((Date.parse(yearEnd) - Date.parse(today)) / 86400000)) / 30.4375
    const rate = savedRate()
    const rank = rows.findIndex((r) => r.producer === who) + 1
    return {
      body: <>
        <b>{who}</b> is credited with <b>{money0(me.premium)}</b> of sold premium in {when} — <b>{pct(me.share, 1)}</b> of everything the agency wrote, on {me.policies} policies (#{rank} of {rows.length} producers).
        <L items={[
          <>New business at stake: about <b>{money0(perMonth)}</b> of premium and {perPolicies.toFixed(1)} policies a month at their pace so far.</>,
          <>If nobody picked it up, the rest of this year ({rest.toFixed(1)} months) would be about <b>{money0(perMonth * rest)}</b> less written premium — a straight-line estimate from their pace in {p.label}.</>,
          rate != null
            ? <>Revenue: roughly <b>{money0(perMonth * rate)}</b> a month and {money0(perMonth * rest * rate)} for the rest of the year, at the {pct(rate, 1)} new-business commission rate you entered.</>
            : <>Revenue: enter your new-business commission rate on the Foresight page and I can put a revenue figure on it.</>,
        ]} />
        <div className="sub">What stays: the {me.policies} policies {who} already wrote stay on the agency's book and renew unless those clients leave with them — this is the new business at risk, not the existing book. Not included: the commission and pay you'd no longer owe {who.split(' ')[0]} (comp plans aren't part of Foresight's data), and whatever part of their pipeline another producer would close.</div>
      </>, go: true,
    }
  }
  const lossAnswer = producerLoss()
  if (lossAnswer) return lossAnswer

  // what if we changed spend on a source
  const m = q.match(/([+-]?\d+(?:\.\d+)?)\s*%/)
  if (m && /what if|if we|spend|increase|decrease|cut|raise|reduce|more|less|drop|add/.test(q)) {
    const { a, plan, paid } = sourcesAnswer()
    if (!paid.length) return { body: <>No lead spend is on file for {when}, so there's no historical return to project from. Record what each source cost on the Foresight page.</>, go: true }
    let src: SourceStat | undefined = paid.find((s) => q.replace(/[^a-z0-9]/g, '').includes(tight(s.source)))
    if (!src && /best|top|highest/.test(q)) src = plan.rows.find((r) => r.eligible)?.source || paid.slice().sort((x, y) => (y.premiumPerDollar || 0) - (x.premiumPerDollar || 0))[0]
    if (!src) return { body: <>Which source? Paid sources on file for {p.label}: {paid.map((s) => s.source).join(', ')}.</> }
    const sign = /cut|decrease|reduce|less|drop|lower/.test(q) || m[1].startsWith('-') ? -1 : 1
    const change = (sign * Math.abs(Number(m[1]))) / 100
    const rate = savedRate()
    const r = project(src, change, rate)
    return {
      body: <>
        <b>{src.source}, {signed(change, (x) => pct(x))} spend:</b> about <b>{signed(r.dPremium, money0)}</b> of sold premium and {signed(r.dPolicies, (x) => x.toFixed(1))} policies a month,
        for {signed(r.dSpend, money0)} a month of spend{r.dRevenue != null ? <> — roughly {signed(r.dRevenue, money0)} a month of revenue at the {pct(rate!, 1)} commission rate you entered</> : ''}.
        <div className="sub">Estimate based on historical performance: {src.source} returned {perDollar(src.premiumPerDollar)} of sold premium per $1 in {when}, on {money0(src.monthlySpend)} a month. It's a straight-line projection, not a trained model — returns usually flatten as spend grows.{r.dRevenue == null ? ' Enter your commission rate on the Foresight page to see revenue.' : ''}</div>
        {coverageNote(a)}
      </>, go: true,
    }
  }

  // best day
  if (/\bday\b|days of the week|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday/.test(q)) {
    const { stats, from } = weekdayPattern(D.sales, w)
    const total = stats.reduce((t, s) => t + s.policies, 0)
    if (!total) return { body: <>Nothing sold in {when}.</> }
    const by = (s: typeof stats[number]) => (/polic|count|how many/.test(q) ? s.avgPolicies : s.avgPremium)
    const fmt = (n: number) => (/polic|count|how many/.test(q) ? n.toFixed(2) + ' policies' : money0(n))
    const ranked = [...stats].sort((x, y) => by(y) - by(x))
    return {
      body: <>
        <b>{ranked[0].day}</b> is the strongest day in {p.label}, averaging <b>{fmt(by(ranked[0]))}</b> a day ({span({ from, to: w.to })}, {total} policies; days with no sales count as zero):
        <L items={ranked.map((s) => <>{s.day} — {fmt(by(s))} a day · {s.policies} policies</>)} />
      </>, go: true,
    }
  }

  // top producer
  if (/producer|top seller|best seller|who sold|who wrote|leader|agent/.test(q)) {
    const rows = producerRanking(D.sales, w)
    if (!rows.length) return { body: <>No sold policies in {when}.</> }
    return {
      body: <>
        <b>{rows[0].producer}</b> leads {p.label} with <b>{money0(rows[0].premium)}</b> of sold premium on {rows[0].policies} policies ({pct(rows[0].share)} of the agency).
        <L items={rows.map((r, i) => <>#{i + 1} {r.producer} — {money0(r.premium)} · {r.policies} policies · {money0(r.avg)} avg</>)} />
        <div className="sub">Ranked by sold premium. Close rate isn't available: lost and sold leads aren't kept, so there's no reliable count of what each producer quoted.</div>
      </>, go: true,
    }
  }

  // where to shift spend
  if (/shift|budget|allocat|recommend|where should|move (the )?(money|spend)|spend more|spend less|reallocat/.test(q)) {
    const { a, plan, paid } = sourcesAnswer()
    if (!a.attributedDays) return { body: <>No sold premium in {when} can be tied to a lead source yet, so there's nothing to compare.</>, go: true }
    if (!paid.length) return { body: <>No lead spend is on file for {when}. Record what each source cost on the Foresight page; nothing is estimated.</>, go: true }
    const moves = plan.rows.filter((r) => Math.abs(r.recommended - r.current) > 0.5)
    return {
      body: <>
        {moves.length
          ? <>Keeping the same <b>{money0(plan.budget)}</b> a month, move it toward the sources that returned more sold premium per dollar in {p.label} (blended {perDollar(plan.blended)} per $1):</>
          : <>No change recommended for {p.label}.</>}
        <L items={plan.rows.map((r) => <>{r.source.source}: {money0(r.current)} → <b>{money0(r.recommended)}</b> a month — {r.reason}</>)} />
        {moves.length > 0 && <div className="sub">At each source's historical rate that's about {signed(plan.recommendedPremium - plan.currentPremium, money0)} of sold premium a month — a linear estimate. Shifts are capped at 50–150% of current spend.</div>}
        {coverageNote(a)}
      </>, go: true,
    }
  }

  // what each source returns
  if (/source|return|roi|per dollar|lead|cost per|spend/.test(q)) {
    const { a } = sourcesAnswer()
    if (!a.attributedDays) return { body: <>No sold premium in {when} can be tied to a lead source yet.</>, go: true }
    return {
      body: <>
        Sold premium by lead source, {when}:
        <L items={a.sources.map((s) => <>{s.source} — {money0(s.premium)} on {s.policies} policies · {s.spend ? <>{money0(s.spend)} spent, <b>{perDollar(s.premiumPerDollar)}</b> per $1</> : 'no spend recorded'}</>)} />
        {coverageNote(a)}
      </>, go: true,
    }
  }

  return { body: <>I answer Vida Foresight questions from the agency's sold policies and recorded lead spend: which day you sell the most, the top producer, what each lead source returns, where to shift lead spend, and what a spend change would do (e.g. "what if we spent 20% more on EverQuote?"). Figures are year to date unless you name a period — "this month", "last 90 days", or a range like "from Aug 1 to Sep 5".</> }
}

export default function ForesightAI() {
  const go = useNavigate()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const data = useRef<Promise<ForesightData> | null>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [msgs, busy])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k)
  }, [])
  // fresh data each time it opens, so spend recorded a moment ago counts
  const show = () => { data.current = loadForesight(); data.current.catch(() => {}); setOpen(true) }

  const ask = async (text: string) => {
    const t = text.trim(); if (!t || busy) return
    setQ(''); setMsgs((m) => [...m, { who: 'me', q: t }]); setBusy(true)
    let a: Answer
    try { a = answer(t, await (data.current || (data.current = loadForesight()))) } catch (e: any) { a = { body: 'Something went wrong looking that up: ' + (e?.message || e) } }
    setMsgs((m) => [...m, { who: 'ai', a }]); setBusy(false)
  }

  return (
    <>
      <button className="hd-kai hd-foresight" onClick={show} aria-label="Open Foresight AI">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 20h18M6 17V11M11 17V7M16 17v-4" /><path d="M16.5 3.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="currentColor" stroke="none" /></svg>
        <span>Foresight AI</span>
      </button>
      {open && createPortal(
        <div className="drawer-bg" onClick={() => setOpen(false)}>
          <aside className="drawer ai-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Foresight AI">
            <div className="drawer-h">
              <div><div className="panel-t">Foresight AI</div><div className="panel-s">Sales patterns, producers and lead spend — year to date unless you name a period.</div></div>
              <div className="row-actions">
                <button className="btn-primary" onClick={() => { setOpen(false); go('/foresight') }}>Open Vida Foresight</button>
                {msgs.length > 0 && <button className="btn-ghost" onClick={() => setMsgs([])}>Clear</button>}
                <button className="btn-ghost" onClick={() => setOpen(false)}>Close</button>
              </div>
            </div>
            <div className="ai-log">
              {!msgs.length && <div className="ai-hello">Ask which day you sell the most, who the top producer is, what each lead source returns, where to shift lead spend, or what a spend change would do.</div>}
              {msgs.map((m, i) => m.who === 'me'
                ? <div key={i} className="ai-me">{m.q}</div>
                : <div key={i} className="ai-a">{m.a!.body}{m.a!.go && <div><button className="ai-go" onClick={() => { setOpen(false); go('/foresight') }}>Open Vida Foresight →</button></div>}</div>)}
              {busy && <div className="ai-a ai-think">Working that out…</div>}
              <div ref={end} />
            </div>
            <div className="ai-foot">
              <div className="ai-chips">{FORESIGHT_CHIPS.map((x) => <button key={x} className="chip" onClick={() => ask(x)} disabled={busy}>{x}</button>)}</div>
              <form className="ai-ask" onSubmit={(e) => { e.preventDefault(); ask(q) }}>
                <input className="fld" autoFocus placeholder="Ask Foresight…" value={q} onChange={(e) => setQ(e.target.value)} />
                <button className="btn-primary" disabled={busy || !q.trim()}>Ask</button>
              </form>
            </div>
          </aside>
        </div>, document.body
      )}
    </>
  )
}
