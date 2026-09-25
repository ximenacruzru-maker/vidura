import { useMemo, useState } from 'react'
import { Empty, ErrorBox, Loading, PageHead, Panel, Search, Tabs } from '../components/ui'
import { getDocs, getReference, openDoc } from '../lib/books'
import { useAsync } from '../lib/useAsync'
import { useAuth } from '../auth'
import { can } from '../lib/access'
import { getLogins, loginsFor, type Login } from '../lib/logins'
import LoginCreds from '../components/LoginCreds'

type T = 'forms' | 'markets' | 'appetite' | 'kb' | 'platforms'
const TABS: { key: T; label: string }[] = [
  { key: 'forms', label: 'Forms & guides' }, { key: 'markets', label: 'Carrier markets' },
  { key: 'appetite', label: 'Farmers appetite guide' }, { key: 'kb', label: 'Farmers Q&A' }, { key: 'platforms', label: 'Platforms' },
]

export default function Resources() {
  const { me } = useAuth()
  const pw = can(me, 'passwords')
  const [tab, setTab] = useState<T>('forms')
  const { data, error } = useAsync(async () => {
    const [resources, markets, bi, kb, systems, docs] = await Promise.all([
      getReference<any[]>('resources'), getReference<any[]>('markets'), getReference<any>('farmers_bi'),
      getReference<any[]>('farmers_kb'), getReference<any[]>('systems'), getDocs(),
    ])
    const logins = pw ? await getLogins().catch(() => [] as Login[]) : []
    return { resources: resources || [], markets: markets || [], bi, kb: kb || [], systems: systems || [], docs, logins }
  }, [pw])
  const head = <PageHead kicker="Client servicing" title="Resources" sub="Forms, carrier markets, the Farmers appetite guide and the logins the agency works in." />
  if (error) return <>{head}<ErrorBox error={error} /></>
  if (!data) return <>{head}<Loading /></>
  return (
    <>
      {head}
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'forms' && <Forms resources={data.resources} docs={data.docs} />}
      {tab === 'markets' && <Markets markets={data.markets} logins={data.logins} />}
      {tab === 'appetite' && <Appetite bi={data.bi} />}
      {tab === 'kb' && <Kb kb={data.kb} />}
      {tab === 'platforms' && <Platforms systems={data.systems} logins={data.logins} pw={pw} />}
    </>
  )
}

function Forms({ resources, docs }: { resources: any[]; docs: any[] }) {
  const cats = [...new Set(resources.map((r) => r.cat))]
  return <>{cats.map((c) => (
    <Panel key={c} title={c}>
      <div className="cards">
        {resources.filter((r) => r.cat === c).map((r) => {
          const d = docs.find((x) => x.id === r.document_id)
          return (
            <div key={r.id} className="card">
              <div className="card-t">{r.title}</div>
              {r.note && <div className="card-s">{r.note}</div>}
              {r.fillable && <span className="pill pill-good" style={{ alignSelf: 'flex-start' }}>Fillable PDF</span>}
              {d && <div className="row-actions"><button className="linkbtn" onClick={() => openDoc(d)}>Open</button><button className="linkbtn" onClick={() => openDoc(d, true)}>Download</button></div>}
            </div>
          )
        })}
      </div>
    </Panel>
  ))}</>
}

function Markets({ markets, logins }: { markets: any[]; logins: Login[] }) {
  return <>{markets.map((m) => (
    <Panel key={m.key} title={m.label} sub={m.note}>
      <div className="cards">
        {(m.carriers || []).map((c: any, i: number) => (
          <div key={c.name + i} className="card">
            <div className="sub" style={{ fontWeight: 800 }}>#{i + 1}</div>
            {c.logo ? <img className="carrier-logo" src={c.logo} alt={c.name} /> : null}
            <div className="card-t">{c.name}</div>
            {c.blurb && <div className="card-s">{c.blurb}</div>}
            {c.portal && <a href={c.portal} target="_blank" rel="noreferrer">{c.portalLabel || 'Open portal'} ↗</a>}
            <LoginCreds logins={loginsFor(logins, c)} />
          </div>
        ))}
      </div>
    </Panel>
  ))}</>
}

function Appetite({ bi }: { bi: any }) {
  const [q, setQ] = useState('')
  const [sec, setSec] = useState('all')
  const rows: any[] = bi?.rows || []
  const cols = useMemo(() => [...new Set(rows.flatMap((r) => Object.keys(r.c || {})))], [rows])
  if (!bi) return <Empty>The appetite guide isn’t loaded.</Empty>
  const secs = Object.keys(bi.sections || {})
  const shown = rows.filter((r) => (sec === 'all' || r.s === sec) && (!q || `${r.d} ${r.sic} ${r.n}`.toLowerCase().includes(q.toLowerCase())))
  const tone = (v: string) => (v === 'Y' ? 'pill-good' : v === 'N' ? 'pill-bad' : v === 'M' ? 'pill-warn' : 'pill-muted')
  const section = sec !== 'all' ? bi.sections[sec] : null
  return (
    <>
      <Panel title={bi.title} sub={<>{bi.code} · {Object.entries(bi.legend || {}).map(([k, v]) => `${k} = ${v}`).join(' · ')}</>}
        right={<div className="filters">
          <select value={sec} onChange={(e) => setSec(e.target.value)}><option value="all">All classes</option>{secs.map((s) => <option key={s}>{s}</option>)}</select>
          <Search value={q} onChange={setQ} placeholder="Business type or SIC" />
        </div>}>
        {section && <><div className="note-box">{section.text}</div>{section.tips && <div className="note-box"><b>Tips: </b>{section.tips}</div>}</>}
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Business</th><th>SIC</th>{cols.map((c) => <th key={c} className="r">{c}</th>)}</tr></thead>
            <tbody>
              {shown.slice(0, 400).map((r, i) => (
                <tr key={i}>
                  <td><div className="strong">{r.d}</div><div className="sub">{r.s} · p.{r.p}{r.n ? ' · ' + r.n : ''}</div></td>
                  <td className="mono">{r.sic}</td>
                  {cols.map((c) => <td key={c} className="r">{r.c?.[c] ? <span className={'pill ' + tone(r.c[c])}>{r.c[c]}</span> : ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!shown.length && <Empty>No classes match.</Empty>}
      </Panel>
    </>
  )
}

function Kb({ kb }: { kb: any[] }) {
  const [q, setQ] = useState('')
  const shown = kb.filter((k) => !q || `${k.t} ${k.a} ${(k.k || []).join(' ')}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <Panel title="Farmers quick answers" right={<Search value={q} onChange={setQ} />}>
      {shown.map((k, i) => <details key={i} className="plan"><summary className="strong" style={{ cursor: 'pointer' }}>{k.t}</summary><div className="note-box">{k.a}</div></details>)}
      {!shown.length && <Empty>No answers match.</Empty>}
    </Panel>
  )
}

function Platforms({ systems, logins, pw }: { systems: any[]; logins: Login[]; pw: boolean }) {
  return (
    <Panel title="Platforms the agency signs into" sub={pw ? 'Logins come from Agency Passwords — copy the username and password, then open the site.' : 'Ask an admin for access to Agency Passwords to see the logins here.'}>
      <div className="cards">
        {systems.map((s) => (
          <div key={s.id} className="card">
            <div className="card-t">{s.name}</div>
            <div className="sub" style={{ fontWeight: 700 }}>{s.kind}</div>
            <div className="card-s">{s.note}</div>
            {s.url && <a href={s.url} target="_blank" rel="noreferrer">Open ↗</a>}
            <LoginCreds logins={loginsFor(logins, s)} />
          </div>
        ))}
      </div>
    </Panel>
  )
}
