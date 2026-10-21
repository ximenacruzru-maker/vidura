// Ask the carrier guide: type the situation in plain words ("Farmers said no, bad driving record") and it answers
// with the agency's own placement rules (lib/placement), then asks the next question with buttons, like a
// flowchart, until the deal is placed or handed to the owner. Used on the Sales Flowchart and in Carrier markets.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import LoginCreds from './LoginCreds'
import { GUIDE, match } from '../lib/placement'
import { loginsFor, type Login } from '../lib/logins'

interface Carrier { name: string; blurb?: string; portal?: string; portalLabel?: string; match?: string; logo?: string }
interface Market { key: string; label: string; carriers: Carrier[] }
interface Turn { me?: string; node?: string; info?: string }
interface BiRow { d: string; s: string; sic: string; c: Record<string, string> }

const EXAMPLES = ['Farmers said no, bad driving record', 'Client only needs minimum limits', 'Home in a high wildfire zone, client doesn’t want a DIC', 'High-value home, Farmers denied it', 'I have a commercial deal']

export default function CarrierGuide({ markets, logins, ask, bi }: { markets: Market[]; logins: Login[]; ask?: string | null; bi?: BiRow[] }) {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const end = useRef<HTMLDivElement>(null)
  const all = markets.flatMap((m) => m.carriers)
  const find = (name: string) => all.find((c) => c.name.toLowerCase().includes(name.toLowerCase()) || (c.match && name.toLowerCase().includes(c.match.toLowerCase()))) || { name }

  const open = (t: string): Turn[] => {
    const node = match(t)
    const row = node === 'commercial' && bi ? lookUp(t, bi) : null
    return [{ me: t }, ...(row ? [{ info: appetiteLine(row) }] : []), { node }]
  }
  const start = (text: string) => { const t = text.trim(); if (!t) return; setTurns((x) => [...x, ...open(t)]); setQ('') }
  const pick = (label: string, next: string) => setTurns((x) => [...x, { me: label }, { node: next }])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (ask) setTurns(open(ask)) }, [ask])
  useEffect(() => { if (turns.length > 2) end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [turns])
  const last = turns.length - 1

  return (
    <section className="panel cg">
      <div className="panel-h"><div>
        <div className="panel-t">Ask the carrier guide</div>
        <div className="panel-s">Describe the deal in your own words. It answers with the agency’s placement rules and asks you the next question.</div>
      </div>{turns.length > 0 && <button className="btn-ghost" onClick={() => setTurns([])}>Start over</button>}</div>
      <div className="panel-b">
        {!turns.length && <div className="cg-ex">{EXAMPLES.map((e) => <button key={e} className="cg-chip" onClick={() => start(e)}>{e}</button>)}
          <button className="cg-chip cg-chip-alt" onClick={() => setTurns([{ node: 'start' }])}>Walk me through it from the top</button></div>}
        <div className="cg-log">
          {turns.map((t, i) => t.me ? <div key={i} className="cg-me">{t.me}</div> : t.info ? <div key={i} className="cg-bot cg-info"><div className="cg-say">{t.info}</div></div> : (() => {
            const n = GUIDE[t.node!] || GUIDE.start
            const list = n.list ? (markets.find((m) => m.key === n.list!.key)?.carriers || []).filter((c) => !(n.list!.skip || []).some((s) => c.name.toLowerCase().includes(s.toLowerCase()))) : []
            const cs = [...(n.carriers || []).map(find), ...list]
            return (
              <div key={i} className={'cg-bot' + (n.end ? ' cg-end' : '')}>
                <div className="cg-say">{n.say}</div>
                {cs.length > 0 && <div className="cg-cars">{cs.map((c, k) => (
                  <div key={c.name + k} className="cg-car">
                    <b>{list.length && k >= (n.carriers || []).length ? `${k - (n.carriers || []).length + 1}. ` : ''}{c.name}</b>
                    {'blurb' in c && c.blurb && <span className="sub">{c.blurb}</span>}
                    <span className="cg-car-a">{'portal' in c && c.portal && <a href={c.portal} target="_blank" rel="noreferrer">{c.portalLabel || 'Open portal'} ↗</a>}<LoginCreds logins={loginsFor(logins, c)} /></span>
                  </div>
                ))}</div>}
                {n.link && <button className="btn-primary cg-link" onClick={() => nav(n.link!.to)}>{n.link.label} ›</button>}
                {n.ask && <div className="cg-ask">{n.ask}</div>}
                {n.options && <div className="cg-opts">{n.options.map((o) => <button key={o.label} className="cg-opt" disabled={i !== last} onClick={() => pick(o.label, o.next)}>{o.label}</button>)}</div>}
              </div>
            )
          })())}
          <div ref={end} />
        </div>
        <form className="cg-form" onSubmit={(e) => { e.preventDefault(); start(q) }}>
          <input className="fld" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Farmers declined, client has two DUIs" aria-label="Ask the carrier guide" />
          <button className="btn-primary" disabled={!q.trim()}>Ask</button>
        </form>
      </div>
    </section>
  )
}

/* ---------- the Farmers appetite guide, looked up from the words in the question ---------- */
const STOP = new Set(['have', 'deal', 'commercial', 'business', 'client', 'quote', 'need', 'needs', 'with', 'from', 'that', 'this', 'they', 'their', 'insurance', 'policy', 'coverage', 'farmers', 'said', 'what', 'where', 'does', 'company', 'owner', 'small', 'shop',
  'comp', 'workers', 'work', 'liability', 'general', 'umbrella', 'bop', 'for', 'and', 'the', 'new', 'got', 'one', 'two', 'declined', 'denied', 'wants', 'want'])
const VERDICT: Record<string, string> = { Y: 'Yes', M: 'Maybe', N: 'No' }
const COV: Record<string, string> = { 'Full BOP (Prop + GL)': 'BOP', BOP: 'BOP', 'Monoline GL': 'GL only', 'Property Only': 'Property only', WC: 'Workers’ comp', Auto: 'Commercial auto', UMB: 'Umbrella' }
function lookUp(q: string, rows: BiRow[]): BiRow | null {
  // coverage names aren't the business: drop them first (so "auto repair" still counts, "commercial auto" doesn't)
  const words = q.toLowerCase().replace(/commercial auto|business auto|workers.? comp(ensation)?|general liability/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w))
  // plumber → plumb (Plumbing), roofers → roof (Roofing), cleaning → clean; short words (dry, gas) must match a whole word
  const stems = words.filter((w) => w.length >= 4).map((w) => w.replace(/(ians|ian|ers|er|ing|ies|es|s)$/, '')).filter((w) => w.length >= 4)
  const short = words.filter((w) => w.length === 3)
  if (!stems.length && !short.length) return null
  // a trade word (plumber, roofer, painter, contractor) means the contractor class, not the manufacturer or wholesaler
  const trade = words.some((w) => /(er|ers|or|ors)$/.test(w))
  const makes = /manufactur|factory|make|maker|wholesale|distribut/.test(q.toLowerCase())
  let best: BiRow | null = null, score = 0
  for (const r of rows) {
    const d = r.d.toLowerCase(), sec = r.s.toLowerCase()
    const n = stems.filter((w) => d.includes(w)).length + short.filter((w) => new RegExp('\\b' + w + '\\b').test(d)).length + stems.filter((w) => !d.includes(w) && sec.includes(w)).length * 0.5
    if (n < 1) continue // a business-type match, not just its section
    const v = n * 10 + (trade && r.s === 'Artisan Contractors' ? 4 : 0) + (stems.some((w) => d.startsWith(w)) ? 1 : 0) - (!makes && /Manufacturing|Wholesale/.test(r.s) ? 3 : 0)
    if (v > score || (v === score && best && r.d.length < best.d.length)) { best = r; score = v }
  }
  return score ? best : null
}
function appetiteLine(r: BiRow) {
  const seen = new Set<string>()
  const parts = Object.entries(r.c).filter(([k]) => { const l = COV[k] || k; if (seen.has(l)) return false; seen.add(l); return true }).map(([k, v]) => `${COV[k] || k}: ${VERDICT[v] || v}`)
  return `Farmers appetite guide — ${r.d} (${r.s}, SIC ${r.sic}): ${parts.join(' · ')}.`
}
