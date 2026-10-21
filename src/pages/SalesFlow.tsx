// Sales Flowchart: "I have a deal — where do I quote it?" as a step-by-step flowchart anyone can follow without
// asking. New client or cross-sale on an existing one → what they're buying → for business, what the business does
// and which coverage → then the carriers in the agency's own order (Agency Resources › Carrier markets), with the
// Farmers appetite guide's verdict first and what to do when a carrier declines. Nothing here is invented: the
// order and notes come from the agency's markets list and the Farmers Business Insurance Appetite Guide.
import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import { Empty, ErrorBox, Loading, PageHead, Search, Tabs } from '../components/ui'
import LoginCreds from '../components/LoginCreds'
import { can } from '../lib/access'
import { bookLabel, getAccounts, getBookPolicies, getReference, type Account, type BookPolicy } from '../lib/books'
import { money0 } from '../lib/format'
import { getLogins, loginsFor, type Login } from '../lib/logins'
import { useAsync } from '../lib/useAsync'
import { AUTO_READY, GL_READY, KRAFT_LAKE, WC_READY } from '../lib/placement'
import CarrierGuide from '../components/CarrierGuide'

type Line = 'commercial' | 'auto' | 'home' | 'landlord' | 'condos'
const LINES: { key: Line; label: string; note: string }[] = [
  { key: 'commercial', label: 'Business / commercial', note: 'BOP, general liability, property, workers’ comp, commercial auto, umbrella' },
  { key: 'auto', label: 'Personal auto', note: 'Cars, trucks, motorcycles' },
  { key: 'home', label: 'Homeowners', note: 'They live in the home' },
  { key: 'landlord', label: 'Landlord / rental', note: 'Dwelling fire — someone else lives there' },
  { key: 'condos', label: 'Condo (HO-6)', note: 'Unit-owner policies' },
]
/** Farmers Commercial's three sections; each maps to the appetite guide's columns for its verdict. */
type Cov = 'gl' | 'auto' | 'wc'
const COVS: { key: Cov; label: string; note: string; cols: string[]; ready: string }[] = [
  { key: 'gl', label: 'General liability', note: 'Or a BOP — property + liability', cols: ['Monoline GL', 'Full BOP (Prop + GL)', 'BOP'], ready: GL_READY },
  { key: 'auto', label: 'Commercial auto', note: 'Vehicles used for the business', cols: ['Auto'], ready: AUTO_READY },
  { key: 'wc', label: 'Workers’ comp', note: 'Employees hurt on the job', cols: ['WC'], ready: WC_READY },
]
const verdictOf = (row: BiRow | null, cov: Cov) => { const c = COVS.find((x) => x.key === cov)!; return row ? c.cols.map((k) => row.c[k]).find(Boolean) : undefined }
const KRAFT_LAKE_PHONE = KRAFT_LAKE
const COLLECT = ['Business name, FEIN and mailing address', 'Every location address, with square footage, year built and construction', 'What the business does, in their words, and years in business',
  'Annual revenue, payroll and number of employees (full-time / part-time)', 'Vehicles and drivers, for commercial auto', 'Current carrier, expiration date and current premium', 'Losses in the last 3–5 years (loss runs)']

interface Carrier { name: string; blurb?: string; portal?: string; portalLabel?: string; match?: string; logo?: string }
interface Market { key: string; label: string; note?: string; carriers: Carrier[] }
interface BiRow { d: string; sic: string; s: string; p: number; n?: string; c: Record<string, string> }

/* ---------- what an existing client already has, and what to offer them ---------- */
interface Pitch { label: string; line?: Line; cov?: string; why: string }
function crossSell(ps: BookPolicy[]): { has: string[]; pitch: Pitch[] } {
  const t = ps.map((p) => (p.product || '').toUpperCase())
  const any = (rx: RegExp) => t.some((x) => rx.test(x))
  const biz = any(/COMMERCIAL|BOP|BUSINESSOWNERS|GENERAL LIAB|RETAIL|ARTISAN|RESTAURANT|REAL ESTATE|HABITATIONAL|SERVICE & REPAIR|WHOLESALE|CASUALTY|FARMOWNERS|^PROPERTY/)
  const wc = any(/WORK/), umb = any(/UMBRELLA/), life = any(/LIFE/)
  const auto = any(/AUTO/) && !any(/AUTO SERVICE/), home = any(/HOME|HO-?3|SNHO|RENTERS/), dwell = any(/DWELLING|FIRE|DP-3|\bDIC\b/)
  const has = [biz && 'Business policy', wc && 'Workers’ comp', auto && 'Auto', home && 'Home / renters', dwell && 'Dwelling fire / landlord', umb && 'Umbrella', life && 'Life'].filter(Boolean) as string[]
  const pitch: Pitch[] = []
  if (biz && !wc) pitch.push({ label: 'Workers’ comp', line: 'commercial', cov: 'wc', why: 'They have a business policy but no workers’ comp' })
  if (wc && !biz) pitch.push({ label: 'BOP / general liability', line: 'commercial', cov: 'gl', why: 'They have workers’ comp but no business policy' })
  if (biz || wc) pitch.push({ label: 'Commercial auto', line: 'commercial', cov: 'auto', why: 'Ask about vehicles used for the business' })
  if ((biz || wc) && !umb) pitch.push({ label: 'Commercial umbrella', why: 'Higher limits over their business coverage — quote it with Farmers Commercial' })
  if (auto && !home && !dwell) pitch.push({ label: 'Homeowners', line: 'home', why: 'They have auto but no home or renters policy' })
  if ((home || dwell) && !auto) pitch.push({ label: 'Personal auto', line: 'auto', why: 'They have property but no auto with us' })
  if (dwell && !home) pitch.push({ label: 'Their own home', line: 'home', why: 'They insure a rental — ask about where they live' })
  if (auto && (home || dwell) && !umb) pitch.push({ label: 'Personal umbrella', why: 'Auto and home with us, no umbrella yet — quote it through Farmers' })
  if (!life) pitch.push({ label: 'Life', why: 'No life policy on file — quote it through Farmers' })
  return { has, pitch }
}

export default function SalesFlow() {
  const { me } = useAuth()
  const books = can(me, 'books'), pw = can(me, 'passwords')
  const [sp, setSp] = useSearchParams()
  const who = sp.get('who') as 'new' | 'existing' | null
  const line = sp.get('line') as Line | null
  const clientId = sp.get('client'), biz = sp.get('biz'), cov = sp.get('cov'), ask = sp.get('ask')
  const view = (sp.get('view') || (who || line ? 'steps' : 'ask')) as 'ask' | 'steps'
  const set = (p: Record<string, string | null>) => {
    const n = new URLSearchParams(sp)
    Object.entries(p).forEach(([k, v]) => (v == null ? n.delete(k) : n.set(k, v)))
    setSp(n, { replace: false })
  }

  const ref = useAsync(async () => {
    const [markets, bi, logins] = await Promise.all([getReference<Market[]>('markets'), getReference<{ rows: BiRow[]; sections: Record<string, { text?: string; tips?: string }> }>('farmers_bi'), pw ? getLogins().catch(() => [] as Login[]) : ([] as Login[])])
    return { markets: markets || [], bi, logins }
  }, [pw])
  const book = useAsync(async () => (books && who === 'existing' ? Promise.all([getAccounts(), getBookPolicies()]) : null), [books, who])

  const head = <PageHead kicker="Sales" title="Sales Flowchart" sub="Got a deal? Answer each step and it shows exactly where to quote it, in order, and what to do if a carrier says no." />
  if (ref.error) return <>{head}<ErrorBox error={ref.error} /></>
  if (!ref.data) return <>{head}<Loading what="Loading the carrier markets" /></>
  const { markets, bi, logins } = ref.data

  let n = 0
  const step = () => ++n
  const accounts: Account[] = book.data?.[0] || []
  const policies: BookPolicy[] = book.data?.[1] || []
  const client = clientId ? accounts.find((a) => a.id === clientId) : null
  const cs = client ? crossSell(policies.filter((p) => p.account_id === client.id)) : null
  const row = biz && bi ? bi.rows.find((r) => r.d === biz) || null : null

  return (
    <>
      {head}
      <Tabs tabs={[{ key: 'ask', label: 'Ask the carrier guide' }, { key: 'steps', label: 'Step-by-step flowchart' }]} value={view} onChange={(v) => setSp(new URLSearchParams(v === 'ask' ? { view: 'ask' } : { view: 'steps' }))} />
      {view === 'ask' ? <div className="sf"><CarrierGuide markets={markets} logins={logins} ask={ask} bi={bi?.rows} /></div> :
      <div className="sf">
        <div className="sf-top">
          {(who || line) && <button className="btn-ghost" onClick={() => setSp(new URLSearchParams({ view: 'steps' }))}>↺ Start over</button>}
        </div>

        <Node n={step()} q="Is this a new client or someone we already insure?" done={!!who}>
          <Choices value={who} onPick={(v) => set({ who: v, client: null, line: null, biz: null, cov: null })}
            options={[{ key: 'new', label: 'New client', note: 'Never insured with us' }, { key: 'existing', label: 'Existing client', note: 'Cross-sell — they already have a policy with us' }]} />
        </Node>

        {who === 'existing' && <>
          <Arrow />
          <Node n={step()} q="Which client?" done={!!client}>
            {!books ? <Empty>Finding a client needs Books of Business access. Ask an admin, or go straight to what they’re buying below.</Empty>
              : book.error ? <ErrorBox error={book.error} /> : !book.data ? <Loading what="Loading the book" />
                : <ClientPick accounts={accounts} policies={policies} value={client} onPick={(a) => set({ client: a.id, line: null, biz: null, cov: null })} />}
            {client && cs && (
              <div className="sf-client">
                <div><b>{client.name}</b> <span className="sub">· {bookLabel(client.book)}</span></div>
                <div className="sf-has">Has: {cs.has.length ? cs.has.map((h) => <span key={h} className="pill pill-muted">{h}</span>) : <span className="sub">nothing in force on file</span>}</div>
                {cs.pitch.length > 0 && <>
                  <div className="sf-sub">Offer them — pick one to see where to quote it:</div>
                  <div className="sf-choices">{cs.pitch.map((p) => p.line ? (
                    <button key={p.label} className={'sf-choice' + (line === p.line && (p.cov || null) === cov ? ' on' : '')} onClick={() => set({ line: p.line!, cov: p.cov || null, biz: p.line === 'commercial' ? biz : null })}>
                      <b>{p.label}</b><small>{p.why}</small></button>
                  ) : <div key={p.label} className="sf-choice sf-info"><b>{p.label}</b><small>{p.why}</small></div>)}</div>
                </>}
              </div>
            )}
          </Node>
        </>}

        {who && <>
          <Arrow />
          <Node n={step()} q="What are they buying?" done={!!line}>
            <Choices value={line} onPick={(v) => set({ line: v, biz: null, cov: v === 'commercial' ? cov : null })} options={LINES.map((l) => ({ key: l.key, label: l.label, note: l.note }))} />
          </Node>
        </>}

        {line === 'commercial' && <>
          <Arrow />
          <Node n={step()} q="Which coverage? Farmers Commercial is first for any type of business." done={!!cov}>
            <Choices value={cov} onPick={(v) => set({ cov: v })} options={COVS.map((c) => ({ key: c.key, label: c.label, note: c.note }))} />
          </Node>
          {cov && <>
            <Arrow />
            <Node n={step()} q={<>What does the business do? <span className="sub sf-opt">optional — shows what the Farmers guide says</span></>} done={!!biz}>
              {bi ? <BizPick rows={bi.rows} value={row} onPick={(r) => set({ biz: r ? r.d : '(not listed)' })} notListed={biz === '(not listed)'} /> : <Empty>The Farmers appetite guide isn’t loaded.</Empty>}
              {row && bi?.sections[row.s]?.tips && <div className="note-box"><b>Tip for {row.s}:</b> {bi.sections[row.s].tips}</div>}
            </Node>
            <CommercialFlow n={n} cov={cov as Cov} row={row} markets={markets} logins={logins} />
            <CollectFirst />
          </>}
        </>}

        {line && line !== 'commercial' && <PersonalFlow n={n} line={line} markets={markets} logins={logins} />}
      </div>}
    </>
  )
}

/* ---------- flowchart pieces ---------- */
function Node({ n, q, done, children, tone }: { n: number | string; q: ReactNode; done?: boolean; children?: ReactNode; tone?: 'go' | 'stop' | 'maybe' | 'end' }) {
  return (
    <section className={'sf-node' + (done ? ' sf-done' : '') + (tone ? ' sf-' + tone : '')}>
      <div className="sf-node-h"><span className="sf-num">{n}</span><div className="sf-q">{q}</div></div>
      {children && <div className="sf-node-b">{children}</div>}
    </section>
  )
}
const Arrow = ({ label }: { label?: string }) => <div className="sf-arrow" aria-hidden={!label}>{label && <span>{label}</span>}</div>
function Choices({ value, onPick, options }: { value: string | null; onPick: (k: string) => void; options: { key: string; label: string; note?: string; tone?: string }[] }) {
  return (
    <div className="sf-choices">{options.map((o) => (
      <button key={o.key} className={'sf-choice' + (value === o.key ? ' on' : '') + (o.tone ? ' sf-t-' + o.tone : '')} onClick={() => onPick(o.key)} aria-pressed={value === o.key}>
        <b>{o.label}</b>{o.note && <small>{o.note}</small>}
      </button>
    ))}</div>
  )
}
/** Yes / No branches under a carrier: "Approved and priced right?" */
function Decide({ yes, no }: { yes: ReactNode; no: ReactNode }) {
  return (
    <div className="sf-decide">
      <div className="sf-diamond" aria-hidden="true"><i /><span>Approved &amp; priced right?</span></div>
      <div className="sf-branches"><div className="sf-yes"><b>Yes →</b> {yes}</div><div className="sf-no"><b>No / declined ↓</b> {no}</div></div>
    </div>
  )
}
function CarrierCard({ c, logins }: { c: Carrier; logins: Login[] }) {
  return (
    <div className="sf-carrier">
      {c.logo ? <img className="carrier-logo" src={c.logo} alt="" /> : null}
      <div className="sf-carrier-t">{c.name}</div>
      {c.blurb && <div className="sub">{c.blurb}</div>}
      <div className="sf-carrier-a">
        {c.portal && <a className="btn-ghost" href={c.portal} target="_blank" rel="noreferrer">{c.portalLabel || 'Open portal'} ↗</a>}
        <LoginCreds logins={loginsFor(logins, c)} />
      </div>
    </div>
  )
}

const verdictWord = (v?: string) => (v === 'Y' ? 'Farmers guide: Yes' : v === 'M' ? 'Farmers guide: Maybe — needs underwriting' : v === 'N' ? 'Farmers guide: No' : '')

function CommercialFlow({ n, cov, row, markets, logins }: { n: number; cov: Cov; row: BiRow | null; markets: Market[]; logins: Login[] }) {
  const c = COVS.find((x) => x.key === cov)!
  const verdict = verdictOf(row, cov)
  const farmers = markets.flatMap((m) => m.carriers).find((x) => /farmers/i.test(x.name))
  const progressive = markets.flatMap((m) => m.carriers).find((x) => /progressive/i.test(x.name))
  const own = markets.find((m) => m.key === 'commercial')?.carriers
  // after Kraft Lake: the agency's commercial markets if it has listed them, otherwise its wholesale brokers
  const whole = own?.length ? own.filter((x) => !/farmers|kraft/i.test(x.name)) : dedupe(markets.flatMap((m) => m.carriers).filter((x) => /burns|one80|wholesale/i.test(`${x.name} ${x.blurb}`)))
  let k = n
  return <>
    <Arrow label="Shop in this order" />
    <Node n={++k} q={<>Farmers Commercial — {c.label}{verdict && <span className={'pill ' + (verdict === 'Y' ? 'pill-good' : verdict === 'M' ? 'pill-warn' : 'pill-bad')}>{verdictWord(verdict)}</span>}</>} tone="go">
      <div className="sf-say">
        <b>Quote it in Farmers Business Insurance Express (FBIE) first</b> — Farmers Commercial is the first stop for any type of business.
        {verdict === 'M' && <> The guide says <b>maybe</b> for {row!.d.toLowerCase()}: underwriting will ask more, so answer every question fully.</>}
        {verdict === 'N' && <> The guide lists {row!.d.toLowerCase()} as <b>not eligible</b> for {c.label.toLowerCase()}, so expect a decline{cov === 'auto' ? ' — then go to Progressive through KL Compare.' : ' — then refer it to Kraft Lake straight from FBIE.'}</>}
        <div className="sf-ready">{c.ready}</div>
        {row?.n && <div className="sub">Guide note: {row.n}</div>}
      </div>
      {farmers && <CarrierCard c={{ ...farmers, blurb: 'Farmers Business Insurance — quote in FBIE.' }} logins={logins} />}
      <Decide yes={<>Bind it with Farmers Commercial. Done.</>} no={cov === 'auto' ? <>Quote Progressive Commercial through KL Compare (next).</> : <>Refer it to Kraft Lake from inside FBIE (next).</>} />
    </Node>
    <Arrow />
    {cov === 'auto' ? (
      <Node n={++k} q="Progressive Commercial — quoted through KL Compare">
        <div className="sf-say">Farmers said no on the commercial auto: <b>quote Progressive Commercial through KL Compare</b> (Kraft Lake Compare). <b>Turnaround is 3–5 business days</b> — tell the client when to expect it.</div>
        {progressive && <CarrierCard c={progressive} logins={logins} />}
        <Decide yes={<>Bind it with Progressive Commercial. Done.</>} no={<>Go to the wholesale markets (next).</>} />
      </Node>
    ) : (
      <Node n={++k} q="Kraft Lake Insurance Agency — Farmers’ partner for declined business">
        <div className="sf-say">In FBIE, <b>refer the declined quote to Kraft Lake</b> — it carries the information over so you don’t retype it. Questions: chat or call Kraft Lake at <a href={'tel:' + KRAFT_LAKE_PHONE.replace(/-/g, '')}><b>{KRAFT_LAKE_PHONE}</b></a>.
          <div className="sub">They place bonds, builders risk and vacant, commercial auto, earthquake, farm & ranch, flood, GL / BOP / package, habitational, lessor’s risk and workers’ comp.</div></div>
        <Decide yes={<>Bind it through Kraft Lake. Done.</>} no={<>Go to the wholesale markets (next).</>} />
      </Node>
    )}
    <Arrow />
    <Node n={++k} q="Wholesale / hard-to-place markets" tone="end">
      {whole.length ? <div className="sf-carriers">{whole.map((x) => <CarrierCard key={x.name} c={x} logins={logins} />)}</div> : <Empty>No wholesale markets are listed in Agency Resources › Carrier markets yet.</Empty>}
      <div className="sf-say sub">Still no home for it? Ask the agency owner before telling the client no.</div>
    </Node>
  </>
}

function PersonalFlow({ n, line, markets, logins }: { n: number; line: Exclude<Line, 'commercial'>; markets: Market[]; logins: Login[] }) {
  const m = markets.find((x) => x.key === line)
  if (!m?.carriers.length) return <><Arrow /><Node n={n + 1} q="No markets listed"><Empty>Agency Resources › Carrier markets has no list for this line yet.</Empty></Node></>
  return <>
    <Arrow label={m.note || 'Shop in this order'} />
    {(line === 'condos' || line === 'landlord') && <div className="note-box sf-tip"><b>A condo rented to others?</b> Start with Farmers, then the rest of the condo list.</div>}
    {line === 'home' && <div className="note-box sf-tip"><b>Wildfire / brush area?</b> If Farmers can only do a DIC and the client doesn’t want one: Bamboo → Aegis → Delos (final). All say no? Back to Farmers with the CA FAIR Plan for the fire. <b>High-value home Farmers can’t take?</b> No FAIR Plan needed: Bamboo, then Delos. Use <b>Ask the carrier guide</b> above for the full flow.</div>}
    {m.carriers.map((c, i) => (
      <div key={c.name + i}>
        <Node n={n + i + 1} q={c.name} tone={i === 0 ? 'go' : i === m.carriers.length - 1 ? 'end' : undefined}>
          <CarrierCard c={c} logins={logins} />
          {i < m.carriers.length - 1
            ? <Decide yes={<>Bind it with {c.name}. Done.</>} no={<>Try {m.carriers[i + 1].name} (next).</>} />
            : <div className="sf-say sub">Last stop on the list. Still nothing? Ask the agency owner before telling the client no.</div>}
        </Node>
        {i < m.carriers.length - 1 && <Arrow />}
      </div>
    ))}
  </>
}

function CollectFirst() {
  return (
    <details className="sf-collect">
      <summary>What to collect from a business before you quote</summary>
      <ul>{COLLECT.map((x) => <li key={x}>{x}</li>)}</ul>
    </details>
  )
}

function ClientPick({ accounts, policies, value, onPick }: { accounts: Account[]; policies: BookPolicy[]; value: Account | null | undefined; onPick: (a: Account) => void }) {
  const [q, setQ] = useState(value?.name || '')
  const prem = useMemo(() => { const m = new Map<string, number>(); policies.forEach((p) => m.set(p.account_id, (m.get(p.account_id) || 0) + (Number(p.premium) || 0))); return m }, [policies])
  const t = q.trim().toLowerCase()
  const hits = t.length < 2 ? [] : accounts.filter((a) => `${a.name} ${a.dba || ''} ${a.contact || ''}`.toLowerCase().includes(t)).slice(0, 8)
  return <>
    <Search value={q} onChange={setQ} placeholder="Type the client’s name" />
    {hits.length > 0 && value?.name !== q && (
      <div className="sf-hits">{hits.map((a) => (
        <button key={a.id} className="sf-hit" onClick={() => { setQ(a.name); onPick(a) }}><b>{a.name}</b><span className="sub">{bookLabel(a.book)}{prem.get(a.id) ? ` · ${money0(prem.get(a.id)!)}` : ''}</span></button>
      ))}</div>
    )}
    {t.length >= 2 && !hits.length && <div className="sub">No client by that name in Books. Treat them as a new client.</div>}
  </>
}

function BizPick({ rows, value, onPick, notListed }: { rows: BiRow[]; value: BiRow | null; onPick: (r: BiRow | null) => void; notListed: boolean }) {
  const [q, setQ] = useState(value?.d || '')
  const t = q.trim().toLowerCase()
  const hits = t.length < 2 ? [] : rows.filter((r) => `${r.d} ${r.sic} ${r.s}`.toLowerCase().includes(t)).slice(0, 10)
  return <>
    <Search value={q} onChange={setQ} placeholder="e.g. plumber, restaurant, 1711, nail salon" />
    {hits.length > 0 && value?.d !== q && (
      <div className="sf-hits">{hits.map((r, i) => (
        <button key={r.d + i} className="sf-hit" onClick={() => { setQ(r.d); onPick(r) }}><b>{r.d}</b><span className="sub">{r.s} · SIC {r.sic}</span></button>
      ))}</div>
    )}
    {value && <div className="sf-picked">Farmers guide: <b>{value.d}</b> <span className="sub">({value.s}, SIC {value.sic})</span></div>}
    {!value && (t.length >= 2 || notListed) && <button className={'sf-choice sf-notlisted' + (notListed ? ' on' : '')} onClick={() => onPick(null)}><b>I can’t find it</b><small>Not in the Farmers guide — go straight to Kraft Lake</small></button>}
  </>
}

const dedupe = (cs: Carrier[]) => cs.filter((c, i) => cs.findIndex((x) => x.name === c.name) === i)
