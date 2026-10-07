import { useRef, useState } from 'react'
import { useAuth } from '../auth'
import { Empty, ErrorBox, Loading, Panel, Tile, Tiles } from '../components/ui'
import { agencyName, isAdmin } from '../lib/data'
import { issuedAt } from '../lib/format'
import { askHandbook, downloadHandbook, getHandbook, uploadHandbook, type Handbook, type Qa } from '../lib/handbook'
import { HANDBOOK_STEP, ONBOARDING, getProgress, markStep, type OnboardingStep, type Progress } from '../lib/onboarding'
import { supabase } from '../lib/supabase'
import { getReference } from '../lib/books'
import { useAsync } from '../lib/useAsync'

/** New-hire onboarding on the Training page: download the employee handbook (and ask it anything), set up the agency
 *  bookmarks, then Farmers University, which stays locked until the handbook is downloaded. Admins also upload the
 *  handbook here and see each new hire's progress. */
export default function Onboarding({ onProgress, preview }: { onProgress?: () => void; preview?: boolean }) {
  const { session, me } = useAuth()
  const uid = session!.user.id
  const [reload, setReload] = useState(0)
  const bump = () => { setReload((n) => n + 1); onProgress?.() }
  const { data, error } = useAsync(async () => {
    const [handbook, progress] = await Promise.all([getHandbook(), getProgress(uid)])
    return { handbook, progress }
  }, [uid, reload])
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading what="Loading your onboarding" />
  const done = new Map(data.progress.map((p) => [p.step, p]))
  const total = 1 + ONBOARDING.length, finished = (done.has(HANDBOOK_STEP) ? 1 : 0) + ONBOARDING.filter((s) => done.has(s.key)).length

  return (
    <>
      {preview && <div className="note-box" style={{ marginBottom: 14 }}><b>Preview.</b> This is the onboarding a new hire sees. Checking steps off here only marks them for you.</div>}
      <section className="panel ob-hero">
        <div>
          <div className="pay-k">Welcome to {agencyName(me)}</div>
          <div className="ob-title">Your first steps</div>
          <div className="sub">Work through these in order. Farmers University opens once you’ve downloaded the employee handbook.</div>
        </div>
        <div className="ob-count"><b>{finished}</b><span>of {total} done</span>
          <div className="pay-bar"><div className="pay-fill" style={{ width: (finished / total) * 100 + '%' }} /></div></div>
      </section>

      <HandbookStep n={1} handbook={data.handbook} done={done.get(HANDBOOK_STEP)} uid={uid} onDone={bump} />
      {ONBOARDING.map((s, i) => <TaskStep key={s.key} n={i + 2} step={s} done={done.get(s.key)} uid={uid} onDone={bump} />)}
      <section className={'panel ob-step' + (done.has(HANDBOOK_STEP) ? '' : ' ob-locked')}>
        <div className="ob-num">{ONBOARDING.length + 2}</div>
        <div className="ob-body">
          <div className="ob-h"><div className="strong">Farmers University</div>
            <span className={'pill ' + (done.has(HANDBOOK_STEP) ? 'pill-blue' : 'pill-muted')}>{done.has(HANDBOOK_STEP) ? 'Unlocked' : 'Locked'}</span></div>
          <div className="sub">{done.has(HANDBOOK_STEP) ? 'Open the Farmers University tab above and start with Module 1. Each lesson opens once the one before it is signed off.' : 'Download the employee handbook (step 1) to unlock your training.'}</div>
        </div>
      </section>

      {isAdmin(me?.role) && <HandbookAdmin handbook={data.handbook} onDone={bump} />}
    </>
  )
}

const stamp = (p?: Progress) => (p ? `Done ${issuedAt(p.done_at)}` : '')

function HandbookStep({ n, handbook, done, uid, onDone }: { n: number; handbook: Handbook | null; done?: Progress; uid: string; onDone: () => void }) {
  const { me } = useAuth()
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [qa, setQa] = useState<Qa[]>([])
  const [asking, setAsking] = useState(false)
  const ai = useAsync(async () => { const { data } = await supabase.functions.invoke('ai-proxy', { body: { action: 'status' } }); return !!data?.configured }, [])
  const ask = async () => {
    const question = q.trim()
    if (!question || !handbook) return
    setAsking(true)
    try { const a = await askHandbook(handbook, question, qa, agencyName(me)); setQa([...qa, { q: question, a }]); setQ('') }
    catch (e) { setQa([...qa, { q: question, a: 'Sorry — I couldn’t answer that right now: ' + String((e as Error)?.message || e) }]) }
    finally { setAsking(false) }
  }
  return (
    <section className={'panel ob-step' + (done ? ' ob-done' : '')}>
      <div className="ob-num">{done ? '✓' : n}</div>
      <div className="ob-body">
        <div className="ob-h"><div className="strong">Download the Employee Handbook</div>
          <span className={'pill ' + (done ? 'pill-good' : 'pill-warn')}>{done ? 'Downloaded' : 'Required first'}</span></div>
        <div className="sub">Read the agency’s policies before you start training. Downloading it unlocks Farmers University.{done ? ` ${stamp(done)}.` : ''}</div>
        {handbook ? (
          <div className="row-actions" style={{ margin: '10px 0', flexWrap: 'wrap' }}>
            <button className={done ? 'btn-ghost' : 'btn-primary'} disabled={busy} onClick={async () => {
              setBusy(true); try { await downloadHandbook(handbook, uid); onDone() } catch (e) { alert(String((e as Error)?.message || e)) } finally { setBusy(false) }
            }}>{busy ? 'Opening…' : done ? 'Download again' : `Download ${handbook.doc.file_name}`}</button>
          </div>
        ) : <div className="note-box" style={{ marginTop: 10 }}>The handbook hasn’t been uploaded yet. Ask your manager — your training opens as soon as it’s here.</div>}

        {handbook && (
          <div className="ob-ask">
            <div className="strong" style={{ marginBottom: 6 }}>Ask about the handbook</div>
            {qa.map((x, i) => (
              <div key={i} className="ob-qa"><div className="ob-q">{x.q}</div><div className="ob-a">{x.a}</div></div>
            ))}
            {ai.data === false ? <div className="sub">Questions open once an admin adds the agency’s Claude API key (Settings › Commission Setup).</div> : (
              <div className="row-actions">
                <input className="fld" placeholder="e.g. How much PTO do I get? What’s the dress code?" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} disabled={asking} />
                <button className="btn-primary" onClick={ask} disabled={asking || !q.trim()}>{asking ? 'Thinking…' : 'Ask'}</button>
              </div>
            )}
            <div className="sub" style={{ marginTop: 6 }}>Answers come only from the handbook. For anything it doesn’t cover, ask your manager.</div>
          </div>
        )}
      </div>
    </section>
  )
}

function TaskStep({ n, step, done, uid, onDone }: { n: number; step: OnboardingStep; done?: Progress; uid: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const toggle = async (on: boolean) => { setBusy(true); try { await markStep(uid, step.key, on); onDone() } catch (e) { alert(String((e as Error)?.message || e)) } finally { setBusy(false) } }
  return (
    <section className={'panel ob-step' + (done ? ' ob-done' : '')}>
      <div className="ob-num">{done ? '✓' : n}</div>
      <div className="ob-body">
        <div className="ob-h"><div className="strong">{step.title}</div>
          <span className={'pill ' + (done ? 'pill-good' : 'pill-muted')}>{done ? 'Done' : 'To do'}</span></div>
        <div className="sub">{step.description}</div>
        {step.attachment && (
          <a className="ob-file" href={step.attachment.href} download={step.attachment.file} onClick={() => { markStep(uid, step.key + ':file', true).catch(() => { /* the download still happens */ }) }}>
            <span className="ob-file-i">⬇</span><span><b>{step.attachment.label}</b><small>Attachment · download</small></span>
          </a>
        )}
        {step.steps && <ol className="ob-steps">{step.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
        {step.links && (
          <>
            <div className="pay-k" style={{ margin: '10px 0 6px' }}>Included bookmarks</div>
            <div className="ob-links">{step.links.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noreferrer"><b>{l.label}</b><small>{l.url.replace(/^https:\/\//, '').replace(/\/$/, '')}</small></a>)}</div>
          </>
        )}
        <label className="check" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={!!done} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
          <div><div className="check-t">{step.doneLabel}</div>{done && <div className="sub">{stamp(done)}</div>}</div>
        </label>
      </div>
    </section>
  )
}

/** Admins: the handbook (upload / replace), and every new hire: start date and days in, onboarding progress, when they
 *  downloaded the handbook and the bookmarks file, the steps they've checked off, and Farmers University lessons. */
function HandbookAdmin({ handbook, onDone }: { handbook: Handbook | null; onDone: () => void }) {
  const { me } = useAuth()
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState('')
  const [reload, setReload] = useState(0)
  const today = new Date().toISOString().slice(0, 10)
  const hires = useAsync(async () => {
    const [staff, prog, profiles, hr, fu, fuProg] = await Promise.all([
      supabase.from('staff_accounts').select('user_id, display_name, email, role, active, created_at').eq('role', 'new_hire').then((r) => (r.error ? [] : r.data as { user_id: string; display_name: string; email: string | null; active: boolean; created_at: string }[])),
      supabase.from('onboarding_progress').select('user_id, step, done_at').then((r) => (r.error ? [] : r.data as (Progress & { user_id: string })[])),
      supabase.from('new_hire_profiles').select('user_id, start_date, manager').then((r) => (r.error ? [] : r.data as { user_id: string; start_date: string | null; manager: string | null }[])),
      supabase.from('hr_staff').select('name, hired_on').then((r) => (r.error ? [] : r.data as { name: string; hired_on: string | null }[])),
      getReference<{ courses: unknown[] }[]>('fu_modules').catch(() => null),
      supabase.from('training_progress').select('user_id, status').eq('status', 'Completed').then((r) => (r.error ? [] : r.data as { user_id: string }[])),
    ])
    const fuTotal = (fu || []).reduce((a, m) => a + (m.courses?.length || 0), 0)
    return staff.filter((s) => s.active).map((s) => {
      const p = profiles.find((x) => x.user_id === s.user_id)
      const hired = hr.find((x) => x.name.trim().toLowerCase() === s.display_name.trim().toLowerCase())?.hired_on
      const steps = new Map(prog.filter((x) => x.user_id === s.user_id).map((x) => [x.step, x.done_at]))
      const keys = [HANDBOOK_STEP, ...ONBOARDING.map((o) => o.key)]
      const fuDone = fuProg.filter((x) => x.user_id === s.user_id).length
      return { ...s, start: p?.start_date || hired || s.created_at.slice(0, 10), startSet: !!(p?.start_date || hired), manager: p?.manager || '', steps,
        done: keys.filter((k) => steps.has(k)).length, of: keys.length, fuDone, fuTotal }
    }).sort((a, b) => b.start.localeCompare(a.start))
  }, [handbook?.doc.id, reload])
  const days = (d: string) => Math.max(0, Math.round((Date.parse(today) - Date.parse(d)) / 86400000))
  const saveProfile = async (user_id: string, patch: { start_date?: string | null; manager?: string | null }) => {
    const { error } = await supabase.from('new_hire_profiles').upsert({ user_id, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'agency_id,user_id' })
    if (error) alert(error.message); else setReload((n) => n + 1)
  }
  const list = hires.data || []
  const hb = list.filter((h) => h.steps.has(HANDBOOK_STEP)).length, onboarded = list.filter((h) => h.done === h.of).length
  const fuAvg = list.length && list[0].fuTotal ? Math.round((list.reduce((a, h) => a + h.fuDone / h.fuTotal, 0) / list.length) * 100) : 0
  const when = (iso?: string) => (iso ? issuedAt(iso).replace(/^\w+ /, '').replace(':00 ', ' ').replace(/:\d\d (AM|PM)/, ' $1') : '')
  return (
    <>
      <Panel title="New hires" sub="Admins only · everyone with the New hire role">
        {!hires.data ? <Loading /> : (
          <>
            <Tiles>
              <Tile label="New hires" value={list.length} sub={`${list.filter((h) => days(h.start) <= 30).length} started in the last 30 days`} />
              <Tile label="Handbook downloaded" value={`${hb} / ${list.length}`} sub="unlocks Farmers University" tone={list.length && hb === list.length ? 'good' : undefined} />
              <Tile label="Onboarding complete" value={`${onboarded} / ${list.length}`} sub="every step checked off" tone={list.length && onboarded === list.length ? 'good' : undefined} />
              <Tile label="Farmers University" value={`${fuAvg}%`} sub="average lessons signed off" />
            </Tiles>
            {list.length ? (
              <div className="tbl-wrap"><table className="tbl ob-hires">
                <thead><tr><th>New hire</th><th>Start date</th><th>Onboarding</th><th>Handbook</th>{ONBOARDING.map((o) => <th key={o.key}>{o.title.replace('Set Up Your ', '').replace(' in Chrome', '')}</th>)}<th>Farmers University</th></tr></thead>
                <tbody>{list.map((h) => (
                  <tr key={h.user_id}>
                    <td><div className="strong">{h.display_name}</div><div className="sub">{h.email}</div>
                      <input className="fld" style={{ marginTop: 4, maxWidth: 170 }} placeholder="Manager / trainer" defaultValue={h.manager} onBlur={(e) => e.target.value !== h.manager && saveProfile(h.user_id, { manager: e.target.value || null })} aria-label={`${h.display_name} manager`} /></td>
                    <td><input className="fld" type="date" style={{ maxWidth: 150 }} defaultValue={h.start} onBlur={(e) => e.target.value && e.target.value !== h.start && saveProfile(h.user_id, { start_date: e.target.value })} aria-label={`${h.display_name} start date`} />
                      <div className="sub">{h.start > today ? `starts in ${Math.round((Date.parse(h.start) - Date.parse(today)) / 86400000)} days` : `day ${days(h.start) + 1}`}{h.startSet ? '' : ' · login created'}</div></td>
                    <td style={{ minWidth: 120 }}><b>{h.done} of {h.of}</b><div className="pay-bar" style={{ height: 6, margin: '6px 0 0' }}><div className="pay-fill" style={{ width: (h.done / h.of) * 100 + '%' }} /></div></td>
                    <td>{h.steps.get(HANDBOOK_STEP) ? <><span className="pill pill-good">✓ Downloaded</span><div className="sub">{when(h.steps.get(HANDBOOK_STEP))}</div></> : <span className="pill pill-warn">Not yet</span>}</td>
                    {ONBOARDING.map((o) => (
                      <td key={o.key}>
                        {h.steps.get(o.key) ? <><span className="pill pill-good">✓ Done</span><div className="sub">{when(h.steps.get(o.key))}</div></> : <span className="pill pill-muted">Not yet</span>}
                        {o.attachment && <div className="sub">{h.steps.get(o.key + ':file') ? `File downloaded ${when(h.steps.get(o.key + ':file'))}` : 'File not downloaded'}</div>}
                      </td>
                    ))}
                    <td style={{ minWidth: 130 }}>{h.fuTotal ? <><b>{h.fuDone} of {h.fuTotal}</b><div className="pay-bar" style={{ height: 6, margin: '6px 0 0' }}><div className="pay-fill" style={{ width: (h.fuDone / h.fuTotal) * 100 + '%' }} /></div>
                      <div className="sub">{h.steps.get(HANDBOOK_STEP) ? 'lessons signed off' : 'locked until the handbook'}</div></> : '—'}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <Empty>No one has the New hire role right now. Add someone under Settings › Team & access with the role “New hire”.</Empty>}
          </>
        )}
      </Panel>
      <Panel title="Employee handbook" sub="Admins only · new hires download it first, and anyone can ask it questions">
        <div className="ob-admin">
          <div className="sub">{handbook ? `${handbook.doc.file_name} · uploaded ${issuedAt(handbook.updated_at)}` : 'Not uploaded yet — new hires can’t start training until it is.'}</div>
          <input ref={file} type="file" accept="application/pdf,.pdf,.txt" style={{ display: 'none' }} onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = ''
            if (!f || !me) return
            setBusy('Uploading and reading the handbook…')
            try { await uploadHandbook(f, me.agency_id); onDone() } catch (err) { alert('Upload failed: ' + String((err as Error)?.message || err)) } finally { setBusy('') }
          }} />
          <button className="btn-primary" disabled={!!busy} onClick={() => file.current?.click()}>{busy || (handbook ? 'Replace handbook' : 'Upload handbook (PDF)')}</button>
        </div>
      </Panel>
    </>
  )
}
