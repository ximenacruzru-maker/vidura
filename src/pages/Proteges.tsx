import { Fragment, useState } from 'react'
import { useAuth } from '../auth'
import { Empty, ErrorBox, Loading, PageHead, Panel, Tabs, Tile, Tiles } from '../components/ui'
import { getReference } from '../lib/books'
import { getPolicies, isAdmin } from '../lib/data'
import { mdy, money0, money2, todayPacific } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

const FF = /farmers|foremost/i
const isLife = (line: string, carrier: string) => /life/i.test(line) || /new world life/i.test(carrier)
const isBusiness = (line: string) => /commercial|bop|workers|general liab|business|e ?& ?o|builders risk/i.test(line)
const isSpecialty = (line: string, carrier: string) => /foremost/i.test(carrier) || /motorcycle|boat|rv\b|mobile home|manufactured|motor home|trailer|specialty|watercraft|off-road/i.test(line)
function monthOf(start: string, iso: string) {
  const [sm, sd, sy] = start.split('/').map(Number); const [y, m, d] = iso.split('-').map(Number)
  return (y - sy) * 12 + (m - sm) + (d >= sd ? 1 : 0)
}
const toIso = (us: string) => { const [m, d, y] = us.split('/'); return `${y}-${m}-${d}` }

interface Person { name: string; short: string; code: string; start: string; months?: number[]; currentMonth?: number; goals: { premium: number; life: number; business: number; specialty: number }; life: number; lifePremium: number; business: number; specialty: number; note?: string }
type Status = 'Not started' | 'In progress' | 'Completed'

export default function Proteges() {
  const { me } = useAuth()
  const admin = isAdmin(me?.role)
  const today = todayPacific()
  const [tab, setTab] = useState<'progress' | 'training'>('progress')
  const [reload, setReload] = useState(0)
  const { data, error } = useAsync(async () => {
    const [plan, training, statusRows] = await Promise.all([
      getReference<any>('protege'), getReference<any>('protege_training'),
      supabase.from('training_status').select('*').then((r) => { if (r.error) throw r.error; return r.data as { person: string; course: string; status: Status }[] }),
    ])
    const mine = (me?.display_name || '').toLowerCase().split(' ')[0]
    const people: Person[] = (plan?.people || []).filter((p: Person) => admin || p.name.toLowerCase().split(' ')[0] === mine)
    const earliest = people.map((p) => toIso(p.start)).sort()[0] || today
    const sales = await getPolicies(earliest, today)
    return { plan, training, statusRows, people, sales }
  }, [reload])

  const head = <PageHead kicker="People" title="Protégé program" sub={data?.plan ? `Mentor ${data.plan.mentor} · premium from AgencyZoom sales, live` : undefined} />
  if (error) return <>{head}<ErrorBox error={error} /></>
  if (!data) return <>{head}<Loading /></>
  const { plan, training, statusRows, sales } = data
  if (!plan) return <>{head}<Empty>No protégé plan on file.</Empty></>
  const since = toIso(plan.reportDate)
  const courses: any[] = training?.courses || []
  const required = courses.filter((c) => !c.optional)

  const calc = data.people.map((p) => {
    const first = p.name.split(' ')[0].toLowerCase()
    const months: number[] = []
    let life = p.life || 0, lifePremium = p.lifePremium || 0, business = p.business || 0, specialty = p.specialty || 0
    for (const s of sales) {
      if (!(s.producer || '').toLowerCase().startsWith(first) || !FF.test(s.carrier || '')) continue
      const n = monthOf(p.start, s.sale_date); if (n < 1 || n > 12) continue
      const line = s.line || '', car = s.carrier || ''
      if (isLife(line, car)) { if (s.sale_date > since) { life++; lifePremium += s.premium } continue }
      months[n - 1] = (months[n - 1] || 0) + s.premium
      if (s.sale_date > since) { if (isBusiness(line)) business++; if (isSpecialty(line, car)) specialty++ }
    }
    const cur = Math.max(1, Math.min(12, monthOf(p.start, today)))
    for (let i = 0; i < cur; i++) months[i] = months[i] || 0
    // Completed months come from the official program report; the month in progress and later are live.
    const official = p.months || [], closedThrough = (p.currentMonth || 1) - 1
    for (let i = 0; i < closedThrough; i++) if (official[i] != null) months[i] = official[i]
    const sum = (k: number) => months.slice(0, k).reduce((a, b) => a + (b || 0), 0)
    const total = sum(12), withLife = total + lifePremium
    const st = new Map(statusRows.filter((r) => r.person === p.name).map((r) => [r.course, r.status]))
    const reqDone = required.filter((c) => st.get(c.title) === 'Completed').length
    const g = p.goals
    const ok = { prem: withLife >= g.premium, life: life >= g.life, bus: business >= g.business, spec: !g.specialty || specialty >= g.specialty, train: required.length > 0 && reqDone === required.length }
    const gaps: string[] = []
    if (!ok.train) gaps.push(`${required.length - reqDone} training course${required.length - reqDone === 1 ? '' : 's'}`)
    if (!ok.prem) gaps.push(money0(g.premium - withLife) + ' premium')
    if (!ok.life) gaps.push(`${g.life - life} life`)
    if (!ok.bus) gaps.push(`${g.business - business} business`)
    if (!ok.spec) gaps.push(`${g.specialty - specialty} specialty`)
    return { p, months, cur, total, withLife, ms1: sum(5), ms2: sum(9), life, lifePremium, business, specialty, reqDone, ok, gaps, st }
  })

  const setStatus = async (person: string, course: string, status: Status) => {
    const { error } = await supabase.from('training_status').upsert({ person, course, status, updated_at: new Date().toISOString() })
    if (error) alert(error.message); else setReload((n) => n + 1)
  }

  return (
    <>
      {head}
      <Tabs tabs={[{ key: 'progress', label: 'Progress to graduation' }, { key: 'training', label: 'Training checklist' }]} value={tab} onChange={setTab} />
      <div className="pg-cards"><Tiles>
        {calc.map((c) => (
          <Tile key={c.p.name} label={`${c.p.short} · month ${c.cur}`} value={money0(c.withLife)}
            sub={c.gaps.length ? 'Needs ' + c.gaps.join(', ') : 'Every graduation goal met'} tone={c.gaps.length ? (c.gaps.length === 1 ? 'warn' : undefined) : 'good'} />
        ))}
      </Tiles></div>

      {tab === 'progress' && (
        <Panel title="Milestones" sub="Farmers-family P&C premium by program month, plus life. Completed months are from the official program report; the current month onward is live from AgencyZoom.">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th /> {calc.map((c) => <th key={c.p.name} className="r">{c.p.short}<div className="sub" style={{ textTransform: 'none', letterSpacing: 0 }}>#{c.p.code} · since {c.p.start}</div></th>)}</tr></thead>
              <tbody>
                {Array.from({ length: 12 }, (_, i) => (
                  <Fragment key={i}>
                    <tr>
                      <td>Month {i + 1} <span className="sub">{plan.monthGoals?.[i] ? `· goal ${money0(plan.monthGoals[i])}` : ''}</span></td>
                      {calc.map((c) => <td key={c.p.name} className="r mono" style={i + 1 === c.cur ? { background: '#fff8e6', fontWeight: 700 } : undefined}>{c.months[i] != null ? money2(c.months[i]) : <span className="sub">—</span>}</td>)}
                    </tr>
                    {i === 4 && <tr><td className="strong">Milestone 1 (months 1–5)</td>{calc.map((c) => <td key={c.p.name} className="r mono strong">{money2(c.ms1)}</td>)}</tr>}
                    {i === 8 && <tr><td className="strong">Milestone 2 (months 1–9)</td>{calc.map((c) => <td key={c.p.name} className="r mono strong">{money2(c.ms2)}</td>)}</tr>}
                  </Fragment>
                ))}
                <tr><td>Life premium</td>{calc.map((c) => <td key={c.p.name} className="r mono">{money2(c.lifePremium)}</td>)}</tr>
                <tr><td className="strong">Total with life</td>{calc.map((c) => <td key={c.p.name} className="r mono strong">{money2(c.withLife)}<div className="sub">goal {money0(c.p.goals.premium)}</div></td>)}</tr>
                <tr><td>Life policies</td>{calc.map((c) => <td key={c.p.name} className="r"><b>{c.life}</b> / {c.p.goals.life} {c.ok.life && '✓'}</td>)}</tr>
                <tr><td>Business policies</td>{calc.map((c) => <td key={c.p.name} className="r"><b>{c.business}</b> / {c.p.goals.business} {c.ok.bus && '✓'}</td>)}</tr>
                <tr><td>Specialty new business</td>{calc.map((c) => <td key={c.p.name} className="r"><b>{c.specialty}</b>{c.p.goals.specialty ? ` / ${c.p.goals.specialty}` : ''} {c.ok.spec && '✓'}</td>)}</tr>
                <tr><td>Required training</td>{calc.map((c) => <td key={c.p.name} className="r"><b>{c.reqDone}</b> / {required.length} {c.ok.train && '✓'}</td>)}</tr>
              </tbody>
            </table>
          </div>
          {calc.some((c) => c.p.note) && <div className="note">{calc.filter((c) => c.p.note).map((c) => <div key={c.p.name}><b>{c.p.short}:</b> {c.p.note}</div>)}</div>}
          <p className="note">Program report dated {plan.reportDate}; life, business and specialty counts after {mdy(since)} come from synced sales.</p>
        </Panel>
      )}

      {tab === 'training' && (
        <Panel title="University of Farmers checklist" sub={`${required.length} required and ${courses.length - required.length} optional courses${admin ? ' · change a status and it saves for everyone' : ''}`}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Course</th>{calc.map((c) => <th key={c.p.name}>{c.p.short}</th>)}</tr></thead>
              <tbody>
                {courses.map((co) => (
                  <tr key={co.title}>
                    <td><div className="strong">{co.link ? <a href={co.link} target="_blank" rel="noreferrer">{co.title}</a> : co.title}</div>
                      <div className="sub">{co.duration}{co.optional ? ' · optional' : ''}{co.live ? ' · live session' : ''}</div></td>
                    {calc.map((c) => {
                      const v = (c.st.get(co.title) || 'Not started') as Status
                      return (
                        <td key={c.p.name}>
                          {admin ? (
                            <select value={v} onChange={(e) => setStatus(c.p.name, co.title, e.target.value as Status)}>
                              <option>Not started</option><option>In progress</option><option>Completed</option>
                            </select>
                          ) : <span className={'pill ' + (v === 'Completed' ? 'pill-good' : v === 'In progress' ? 'pill-warn' : 'pill-muted')}>{v}</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  )
}
