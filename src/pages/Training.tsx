import { useState } from 'react'
import { useAuth } from '../auth'
import { Empty, ErrorBox, Loading, PageHead, Panel, Tabs, Tile, Tiles } from '../components/ui'
import { getReference } from '../lib/books'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'
import { agencyShort } from '../lib/data'

type Status = 'Not started' | 'In progress' | 'Completed'
interface Course { id: string; title: string; desc: string }
interface FuModule { key: string; n: number; name: string; sub: string; lead: string; courses: Course[] }
interface ClassModule { key: string; num: string; title: string; progress: number; lessons: number }
const EDC = 'https://farmersagency.edcast.com/insights/'
const STATES: Status[] = ['Not started', 'In progress', 'Completed']

/** Reads the classroom's module list straight from the classroom file, as the original platform did. */
async function classroomModules(): Promise<ClassModule[]> {
  const txt = await fetch('./training.html').then((r) => r.text())
  const m = txt.match(/const modules = \[([\s\S]*?)\n\];/)
  if (!m) return []
  return m[1].split(/\{\s*key:/).slice(1).map((b) => ({
    key: (b.match(/^'([^']+)'/) || [])[1] || '',
    num: (b.match(/num:'([^']+)'/) || [])[1] || '',
    title: (b.match(/title:'([^']+)'/) || [])[1] || '',
    progress: Number((b.match(/progress:(\d+)/) || [])[1] || 0),
    lessons: (b.match(/\{t:'/g) || []).length,
  }))
}

export default function Training() {
  const { session, me } = useAuth()
  const ag = agencyShort(me)
  const [tab, setTab] = useState<'dash' | 'fu' | 'class'>('dash')
  const [reload, setReload] = useState(0)
  const { data, error } = useAsync(async () => {
    const [fu, cls, prog] = await Promise.all([
      getReference<FuModule[]>('fu_modules'),
      classroomModules().catch(() => []),
      supabase.from('training_progress').select('course,status').eq('user_id', session!.user.id).then((r) => { if (r.error) throw r.error; return r.data as { course: string; status: Status }[] }),
    ])
    return { fu: fu || [], cls, st: new Map(prog.map((p) => [p.course, p.status])) }
  }, [reload])

  const head = <PageHead kicker="Team development" title="Training" sub={`Farmers University first, then the ${ag} classroom.`} />
  const tabs = <Tabs tabs={[{ key: 'dash', label: 'Dashboard' }, { key: 'fu', label: 'Farmers University' }, { key: 'class', label: `${ag} Classroom` }]} value={tab} onChange={setTab} />
  if (error) return <>{head}{tabs}<ErrorBox error={error} /></>
  if (!data) return <>{head}{tabs}<Loading /></>

  const statusOf = (t: string): Status => data.st.get(t) || 'Not started'
  const done = (t: string) => statusOf(t) === 'Completed'
  const modDone = (m: FuModule) => m.courses.filter((c) => done(c.title)).length
  const modOpen = (i: number) => data.fu.slice(0, i).every((m) => modDone(m) === m.courses.length)
  const lessonLocked = (m: FuModule, i: number, open: boolean) => !open || m.courses.slice(0, i).some((c) => !done(c.title))
  const set = async (course: string, status: Status) => {
    const { error } = await supabase.from('training_progress').upsert({ user_id: session!.user.id, course, status, updated_at: new Date().toISOString() })
    if (error) alert(error.message); else setReload((n) => n + 1)
  }

  const fuAll = data.fu.reduce((s, m) => s + m.courses.length, 0)
  const fuDone = data.fu.reduce((s, m) => s + modDone(m), 0)
  const nextFu = (() => { for (const [i, m] of data.fu.entries()) { const c = m.courses.find((x) => !done(x.title)); if (c) return { m, c, open: modOpen(i) } } return null })()
  const cls = data.cls
  const lessons = cls.reduce((s, m) => s + m.lessons, 0)
  const avg = cls.length ? Math.round(cls.reduce((s, m) => s + m.progress, 0) / cls.length) : 0
  const going = cls.filter((m) => m.progress > 0 && m.progress < 100)
  const waiting = cls.filter((m) => m.progress === 0)
  const nextCls = waiting[0]

  return (
    <>
      {head}
      {tabs}

      {tab === 'dash' && (
        <>
          <Tiles>
            <Tile label="Farmers University" value={`${fuDone}/${fuAll}`} sub={fuDone === fuAll ? 'every lesson signed off' : 'lessons signed off'} tone={fuDone === fuAll ? 'good' : undefined} />
            <Tile label="Classroom modules" value={cls.length} sub={`${lessons} lessons`} />
            <Tile label="Completion" value={`${avg}%`} sub={`average · ${cls.filter((m) => m.progress >= 100).length} complete`} />
            <Tile label="In progress" value={going.length} sub={going.map((m) => m.num).join(', ') || 'none'} tone={going.length ? 'warn' : undefined} />
            <Tile label="Not started" value={waiting.length} sub={nextCls ? `next: ${nextCls.num}` : 'none waiting'} />
          </Tiles>
          <div className="grid2">
            <Panel title="Learning progress" sub="Completion by classroom module">
              {cls.map((m) => (
                <div key={m.key} className="tr-bar">
                  <div className="tr-bar-l"><b>{m.num}</b> {m.title}</div>
                  <div className="progress"><i style={{ width: m.progress + '%' }} /></div>
                  <span className="tr-bar-v">{m.progress}%</span>
                </div>
              ))}
            </Panel>
            <Panel title="Needs attention" sub="What to do next">
              <div className="tr-att">
                {nextFu && (
                  <div className="tr-att-i risk"><span className="tr-att-n">1</span>
                    <div><b>Farmers University: {nextFu.c.title}</b><small>Module {nextFu.m.n} · {nextFu.m.name}. Compliance gates quoting — nothing in Week 1 unlocks until it is certified.</small></div>
                    <button className="btn-ghost" onClick={() => setTab('fu')}>Open</button></div>
                )}
                {going.map((m, i) => (
                  <div key={m.key} className="tr-att-i warn"><span className="tr-att-n">{(nextFu ? 2 : 1) + i}</span>
                    <div><b>{m.num} · {m.title} in progress</b><small>{m.progress}% complete · {m.lessons} lessons</small></div>
                    <button className="btn-ghost" onClick={() => setTab('class')}>Continue</button></div>
                ))}
                {nextCls && (
                  <div className="tr-att-i good"><span className="tr-att-n">{(nextFu ? 2 : 1) + going.length}</span>
                    <div><b>Next up: {nextCls.num} · {nextCls.title}</b><small>{nextCls.lessons} lessons · unlocks after the module before it</small></div>
                    <button className="btn-ghost" onClick={() => setTab('class')}>Start</button></div>
                )}
              </div>
            </Panel>
          </div>
          <Panel title="Modules" sub="The training roadmap in order">
            <table className="tbl">
              <thead><tr><th>Module</th><th>Title</th><th className="r">Lessons</th><th className="r">Progress</th></tr></thead>
              <tbody>{cls.map((m) => (
                <tr key={m.key}><td className="strong">{m.num}</td><td>{m.title}</td><td className="r">{m.lessons}</td>
                  <td className="r"><span className={'pill ' + (m.progress >= 100 ? 'pill-good' : m.progress > 0 ? 'pill-warn' : 'pill-muted')}>{m.progress}%</span></td></tr>
              ))}</tbody>
            </table>
          </Panel>
        </>
      )}

      {tab === 'fu' && (
        <>
          <div className="note-box" style={{ marginBottom: 14 }}><b>Farmers University</b> — built and maintained by Farmers. Modules are taken in order, and each lesson opens once the one before it is signed off. Your progress is saved to your login.</div>
          {data.fu.length ? data.fu.map((m, idx) => {
            const open = modOpen(idx), d = modDone(m), all = m.courses.length
            return (
              <Panel key={m.key} title={`Module ${m.n} — ${m.name}`} sub={`${m.sub} · ${d} of ${all} signed off${open ? '' : ` · opens when Module ${m.n - 1} is complete`}`}>
                <div className="prog-row"><span>{d} of {all}</span><div className="progress"><i style={{ width: Math.round((d / all) * 100) + '%' }} /></div><span>{Math.round((d / all) * 100)}%</span></div>
                {d < all && open && <p className="note" style={{ marginTop: 0 }}><b>{idx === 0 ? 'Start here.' : 'Next up.'}</b> {m.lead}</p>}
                <div className="cards" style={open ? undefined : { opacity: .55 }}>
                  {m.courses.map((c, i) => {
                    const st = statusOf(c.title), locked = lessonLocked(m, i, open)
                    return (
                      <div key={c.id} className={'card fu-card' + (st === 'Completed' ? ' fu-done' : '')}>
                        <div className="fu-top"><span className="sub" style={{ fontWeight: 800 }}>#{i + 1}</span>
                          {idx === 0 && i === 0 && <span className="pill pill-warn">Take this first</span>}
                          {locked && <span className="pill pill-muted">Opens after lesson {i}</span>}
                          <span className={'pill ' + (st === 'Completed' ? 'pill-good' : st === 'In progress' ? 'pill-blue' : 'pill-muted')} style={{ marginLeft: 'auto' }}>{st === 'Completed' ? '✓ Signed off' : st}</span></div>
                        <div className="card-t">{c.title}</div>
                        <div className="card-s">{c.desc}</div>
                        <div className="fu-foot">
                          <select value={st} disabled={locked} onChange={(e) => set(c.title, e.target.value as Status)}>{STATES.map((s) => <option key={s}>{s}</option>)}</select>
                          {locked ? <span className="sub">Locked</span> : <a href={EDC + c.id} target="_blank" rel="noreferrer">Open course ↗</a>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Panel>
            )
          }) : <Empty>The Farmers University course list isn’t loaded.</Empty>}
          <Panel title={`${ag} brokered training`} sub="Our own courses for the brokered book — written in house, added here as they are ready">
            <Empty>Nothing published yet. Farmers covers the Farmers book; these will cover Kraft Lake, Burns &amp; Wilcox, KW Specialty, AU Gold and the surplus lines paperwork.</Empty>
          </Panel>
        </>
      )}

      {tab === 'class' && (
        <div className="panel" style={{ overflow: 'hidden' }}>
          <iframe title={`${ag} Classroom`} src="./training.html" style={{ width: '100%', height: 'calc(100vh - 250px)', minHeight: 560, border: 0, display: 'block' }} />
        </div>
      )}
    </>
  )
}
