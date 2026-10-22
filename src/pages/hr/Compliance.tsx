// HR › Employee files and HR › Agency legal & tax: every record a California insurance agency keeps for an audit, the
// risk gaps (required records that are missing, expired or about to expire) most serious first, an uploader that files
// each document under the right person, type and period, and the whole set as one audit packet (.zip with an index).
import { useMemo, useRef, useState } from 'react'
import { useAuth } from '../../auth'
import { Empty, ErrorBox, Loading, Panel, Tile, Tiles } from '../../components/ui'
import { AGENCY_GROUPS, MARK_LABEL, PERSON_GROUPS, TYPES, auditPacket, deleteFile, getFiles, getMarks, getPeople, openFile, requiredFor, riskGaps, setMark, statusOf, typeOf, uploadFile,
  type CFile, type DocType, type Gap, type Mark, type Person, type Scope, type Status } from '../../lib/compliance'
import { fmtBytes } from '../../lib/books'
import { mdy, todayPacific } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'

interface Data { files: CFile[]; marks: Mark[]; people: Person[] }
function useCompliance() {
  const [reload, setReload] = useState(0)
  const r = useAsync(async (): Promise<Data> => { const [files, marks, people] = await Promise.all([getFiles(), getMarks(), getPeople()]); return { files, marks, people } }, [reload])
  return { ...r, refresh: () => setReload((n) => n + 1) }
}
const TONE: Record<Status['state'], string> = { ok: 'pill-good', soon: 'pill-warn', missing: 'pill-bad', expired: 'pill-bad', na: 'pill-muted', optional: 'pill-muted', marked: 'pill-muted' }
const ICON: Record<Status['state'], string> = { ok: '✓', soon: '!', missing: '✕', expired: '✕', na: '–', optional: '·', marked: '◌' }

/* ---------- Agency legal & tax ---------- */
export function AgencyLegal() {
  const { me } = useAuth()
  const { data, error, refresh } = useCompliance()
  const [preset, setPreset] = useState<Preset | null>(null)
  const up = useRef<HTMLDivElement>(null)
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading what="Loading the agency’s legal files" />
  const today = todayPacific()
  const agencyTypes = TYPES.filter((t) => t.scope === 'agency')
  const req = agencyTypes.filter((t) => t.required === true)
  const st = new Map(agencyTypes.map((t) => [t.key, statusOf(t, data.files, today, undefined, data.marks)]))
  const gaps = riskGaps(data.files, [], today, data.marks)
  const fix = (g: Gap) => { setPreset({ scope: 'agency', doc_type: g.type.key, staff_name: null }); setTimeout(() => up.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30) }
  return (
    <>
      <Tiles>
        <Tile label="Required records on file" value={`${req.filter((t) => ['ok', 'soon'].includes(st.get(t.key)!.state)).length} of ${req.length}`} sub="business, licensing, employer and tax" tone={gaps.length ? 'warn' : 'good'} />
        <Tile label="Risk gaps" value={gaps.length} sub={gaps.length ? 'missing, expired or expiring' : 'nothing open'} tone={gaps.length ? 'warn' : 'good'} />
        <Tile label="Expiring in 60 days" value={[...st.values()].filter((s) => s.state === 'soon').length} sub="renew before they lapse" />
        <Tile label="Files on file" value={data.files.filter((f) => f.scope === 'agency').length} sub="agency legal & tax" />
      </Tiles>
      <AuditBar files={data.files} agency={me?.agency?.name || 'Agency'} />
      <Gaps gaps={gaps} onFix={fix} onMark={async (g, m) => { await setMark('agency', null, g.type.key, m); refresh() }} />
      <div ref={up}><Uploader scope="agency" people={[]} preset={preset} onDone={refresh} /></div>
      {AGENCY_GROUPS.map((g) => (
        <Panel key={g} title={g}>
          <div className="cf-list">{agencyTypes.filter((t) => t.group === g).map((t) => (
            <Item key={t.key} t={t} s={st.get(t.key)!} canDelete={me?.role === 'owner' || me?.role === 'admin'} refresh={refresh}
              onAdd={() => fix({ who: 'Agency', type: t, status: st.get(t.key)!, severity: 0 })} onMark={async (m) => { await setMark('agency', null, t.key, m); refresh() }} />
          ))}</div>
        </Panel>
      ))}
      <div className="band-note">A checklist of what California insurance agencies are commonly required to keep. Your accountant or attorney has the last word for your agency. Mark anything they keep for you, or that doesn’t apply, so it comes off the risk gaps.</div>
    </>
  )
}

/* ---------- Employee files ---------- */
export function EmployeeFiles() {
  const { me } = useAuth()
  const { data, error, refresh } = useCompliance()
  const [preset, setPreset] = useState<Preset | null>(null)
  const [who, setWho] = useState<string | null>(null)
  const [former, setFormer] = useState(false)
  const up = useRef<HTMLDivElement>(null)
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading what="Loading employee files" />
  const today = todayPacific()
  const people = data.people.filter((p) => former || p.active)
  const cols = TYPES.filter((t) => t.scope === 'person' && t.required !== false)
  const gaps = riskGaps(data.files, data.people, today, data.marks)
  const complete = data.people.filter((p) => p.active && !gaps.some((g) => g.who === p.name && g.status.state !== 'soon')).length
  const fix = (g: { who: string; type: DocType }) => { setPreset({ scope: 'person', doc_type: g.type.key, staff_name: g.who }); setTimeout(() => up.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30) }
  const person = who ? data.people.find((p) => p.name === who) : null
  return (
    <>
      <Tiles>
        <Tile label="Employees with a complete file" value={`${complete} of ${data.people.filter((p) => p.active).length}`} sub="current staff" tone={complete === data.people.filter((p) => p.active).length ? 'good' : 'warn'} />
        <Tile label="Risk gaps" value={gaps.length} sub={gaps.length ? 'missing, expired or expiring' : 'nothing open'} tone={gaps.length ? 'warn' : 'good'} />
        <Tile label="Timesheets on file" value={data.files.filter((f) => f.doc_type === 'timesheet').length} sub="uploaded timesheets" />
        <Tile label="Files on file" value={data.files.filter((f) => f.scope === 'person').length} sub="every employee" />
      </Tiles>
      <AuditBar files={data.files} agency={me?.agency?.name || 'Agency'} />
      <Gaps gaps={gaps} onFix={fix} onMark={async (g, m) => { await setMark('person', g.who, g.type.key, m); refresh() }} />
      <div ref={up}><Uploader scope="person" people={data.people} preset={preset} onDone={refresh} /></div>
      <Panel title="Who has what" sub="Click a name to open their file. ✓ on file · ! expiring · ✕ missing or expired · ◌ marked · – not needed for them"
        right={<label className="cf-check"><input type="checkbox" checked={former} onChange={(e) => setFormer(e.target.checked)} /> Show former staff</label>}>
        <div className="tbl-wrap"><table className="tbl cf-grid">
          <thead><tr><th>Employee</th>{cols.map((t) => <th key={t.key} className="c" title={t.label}>{t.short || t.label}</th>)}</tr></thead>
          <tbody>{people.map((p) => (
            <tr key={p.name} className={who === p.name ? 'cf-on' : ''}>
              <td><button className="linkbtn strong" onClick={() => setWho(who === p.name ? null : p.name)}>{p.name}</button><div className="sub">{p.role || ''}{p.hourly ? ' · hourly' : ''}{!p.active ? ' · former' : ''}</div></td>
              {cols.map((t) => { const s = statusOf(t, data.files, today, p, data.marks); return (
                <td key={t.key} className="c"><button className={'cf-cell pill ' + TONE[s.state]} title={`${t.label}: ${s.text}`} onClick={() => (s.state === 'na' ? null : s.files.length ? setWho(p.name) : fix({ who: p.name, type: t }))}>{ICON[s.state]}</button></td>
              ) })}
            </tr>
          ))}</tbody>
        </table></div>
        {!people.length && <Empty>No staff yet — add people under Staff & pay rates.</Empty>}
      </Panel>
      {person && (
        <Panel title={`${person.name}’s file`} sub={`${person.role || ''}${person.hired_on ? ` · started ${mdy(person.hired_on)}` : ''}${person.left_on ? ` · left ${mdy(person.left_on)}` : ''}`} right={<button className="btn-ghost" onClick={() => setWho(null)}>Close</button>}>
          {PERSON_GROUPS.map((g) => (
            <div key={g} className="cf-pg"><div className="cf-h">{g}</div>
              <div className="cf-list">{TYPES.filter((t) => t.scope === 'person' && t.group === g).map((t) => (
                <Item key={t.key} t={t} s={statusOf(t, data.files, today, person, data.marks)} canDelete={me?.role === 'owner' || me?.role === 'admin'} refresh={refresh}
                  onAdd={() => fix({ who: person.name, type: t })} onMark={async (m) => { await setMark('person', person.name, t.key, m); refresh() }} needed={t.required === false ? undefined : requiredFor(t, person)} />
              ))}</div>
            </div>
          ))}
        </Panel>
      )}
      <div className="band-note">W-4s, I-9s and other employee records are visible only to people with HR access. I-9s are kept 3 years after hire or 1 year after someone leaves, whichever is later; payroll and time records at least 3 years (4 for the IRS).</div>
    </>
  )
}

/* ---------- pieces ---------- */
function AuditBar({ files, agency }: { files: CFile[]; agency: string }) {
  const [busy, setBusy] = useState<string | null>(null)
  return (
    <div className="cf-audit">
      <div><b>Audit packet</b><span className="sub"> — every agency and employee file in folders, with an index, in one .zip</span></div>
      <button className="btn-primary" disabled={!!busy || !files.length} onClick={async () => {
        setBusy('Starting…')
        try { await auditPacket(files, agency, (d, n) => setBusy(`Packing ${d} of ${n}…`)) } catch (e) { alert('The packet could not be built: ' + (e instanceof Error ? e.message : String(e))) }
        setBusy(null)
      }}>{busy || `Download audit packet (${files.length} files)`}</button>
    </div>
  )
}

function Gaps({ gaps, onFix, onMark }: { gaps: Gap[]; onFix: (g: Gap) => void; onMark: (g: Gap, m: Mark['mark']) => Promise<void> }) {
  const [all, setAll] = useState(false)
  if (!gaps.length) return <Panel title="Risk gaps"><div className="cf-clear">✓ No open risk gaps. Every required record is on file and current.</div></Panel>
  const shown = all ? gaps : gaps.slice(0, 12)
  return (
    <Panel title={`Risk gaps to close (${gaps.length})`} sub="Required records that are missing, expired or about to expire — most serious first. Upload it, or mark it if your accountant keeps it or it doesn’t apply.">
      <div className="cf-gaps">{shown.map((g, i) => (
        <div key={g.who + g.type.key + i} className={'cf-gap cf-sev-' + Math.min(4, Math.max(1, g.severity))}>
          <div className="cf-gap-t"><b>{g.type.label}</b><span className="sub">{g.who} · <span className={'pill ' + TONE[g.status.state]}>{g.status.text}</span></span>{g.type.why && <small>{g.type.why}</small>}</div>
          <div className="cf-gap-a">
            <button className="btn-primary" onClick={() => onFix(g)}>Upload</button>
            <select className="fld" value="" aria-label="Mark it" onChange={(e) => e.target.value && onMark(g, e.target.value as Mark['mark'])}>
              <option value="">Mark…</option><option value="accountant">{MARK_LABEL.accountant}</option><option value="na">{MARK_LABEL.na}</option>
            </select>
          </div>
        </div>
      ))}</div>
      {gaps.length > 12 && <button className="linkbtn" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${gaps.length}`}</button>}
    </Panel>
  )
}

function Item({ t, s, canDelete, refresh, onAdd, onMark, needed }: { t: DocType; s: Status; canDelete: boolean; refresh: () => void; onAdd: () => void; onMark: (m: Mark['mark'] | null) => Promise<void>; needed?: boolean }) {
  return (
    <div className="cf-item">
      <div className="cf-item-h">
        <div className="cf-item-t"><b>{t.label}</b>{t.why && <small>{t.why}</small>}</div>
        <div className="cf-item-s">
          <span className={'pill ' + TONE[s.state]}>{needed === false ? 'Not needed for them' : s.text}</span>
          <button className="linkbtn" onClick={onAdd}>+ Add</button>
          {s.mark ? <button className="linkbtn" onClick={() => onMark(null)} title={`Marked by ${s.mark.marked_by || ''}`}>Unmark</button>
            : (s.state === 'missing' || s.state === 'expired' || s.state === 'soon') && <select className="fld cf-mark" value="" aria-label={`Mark ${t.label}`} onChange={(e) => e.target.value && onMark(e.target.value as Mark['mark'])}>
              <option value="">Mark…</option><option value="accountant">Accountant keeps it</option><option value="na">Doesn’t apply</option></select>}
        </div>
      </div>
      {s.files.length > 0 && <div className="cf-files">{s.files.map((f) => (
        <div key={f.id} className="cf-file">
          <span className="cf-file-n">{f.file_name}</span>
          <span className="sub">{[f.period_from && f.period_to ? `${mdy(f.period_from)} – ${mdy(f.period_to)}` : f.period_from ? mdy(f.period_from) : '', f.expires_on ? `expires ${mdy(f.expires_on)}` : '', `added ${mdy(f.created_at.slice(0, 10))}${f.uploaded_by ? ' by ' + f.uploaded_by : ''}`, f.size_bytes ? fmtBytes(f.size_bytes) : '', f.note || ''].filter(Boolean).join(' · ')}</span>
          <span className="cf-file-a"><button className="linkbtn" onClick={() => openFile(f)}>Open</button><button className="linkbtn" onClick={() => openFile(f, true)}>Download</button>
            {canDelete && <button className="linkbtn cf-del" onClick={async () => { if (!confirm(`Delete ${f.file_name}? This can’t be undone.`)) return; try { await deleteFile(f); refresh() } catch (e) { alert(e instanceof Error ? e.message : String(e)) } }}>Delete</button>}</span>
        </div>
      ))}</div>}
    </div>
  )
}

interface Preset { scope: Scope; doc_type: string; staff_name: string | null }
const AUTO = '__auto__'
const year0 = Number(todayPacific().slice(0, 4))
/** Upload one or more files as one document type: for a person (or matched to people by file name) and a period or expiry date. */
function Uploader({ scope, people, preset, onDone }: { scope: Scope; people: Person[]; preset: Preset | null; onDone: () => void }) {
  const { me } = useAuth()
  const types = TYPES.filter((t) => t.scope === scope)
  const groups = scope === 'agency' ? AGENCY_GROUPS : PERSON_GROUPS
  const [f, setF] = useState({ doc_type: types[0].key, staff_name: '', from: '', to: '', year: String(year0 - 1), quarter: '1', expires: '', note: '' })
  const [last, setLast] = useState<Preset | null>(null)
  if (preset && preset !== last) { setLast(preset); setF((x) => ({ ...x, doc_type: preset.doc_type, staff_name: preset.staff_name || x.staff_name })) }
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<{ file: string; ok: boolean; note: string }[]>([])
  const t = typeOf(f.doc_type)!
  const ordered = useMemo(() => [...people].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)), [people])
  const match = (file: string) => {
    const n = file.toLowerCase().replace(/[^a-z]+/g, ' ')
    const full = ordered.filter((p) => p.name.toLowerCase().split(/\s+/).every((w) => n.includes(w)))
    if (full.length === 1) return full[0].name
    const first = ordered.filter((p) => new RegExp('\\b' + p.name.toLowerCase().split(/\s+/)[0] + '\\b').test(n))
    return first.length === 1 ? first[0].name : null
  }
  const period = (): { period_from: string | null; period_to: string | null } | string => {
    if (t.freq === 'yearly') return { period_from: `${f.year}-01-01`, period_to: `${f.year}-12-31` }
    if (t.freq === 'quarterly') { const sm = (Number(f.quarter) - 1) * 3 + 1, em = sm + 2; return { period_from: `${f.year}-${String(sm).padStart(2, '0')}-01`, period_to: `${f.year}-${String(em).padStart(2, '0')}-${new Date(Date.UTC(Number(f.year), em, 0)).getUTCDate()}` } }
    if (t.freq === 'period') { if (!f.from || !f.to) return 'Enter the period’s first and last day.'; if (f.to < f.from) return 'The last day is before the first day.'; return { period_from: f.from, period_to: f.to } }
    return { period_from: null, period_to: null }
  }
  const run = async (list: FileList | null) => {
    if (!list?.length || !me?.agency_id) return
    if (scope === 'person' && !f.staff_name) { alert('Pick the employee (or “Match each file by its name”).'); return }
    const p = period(); if (typeof p === 'string') { alert(p); return }
    if (t.freq === 'expires' && !f.expires && !confirm('No expiry date entered — Declara won’t be able to warn you before it lapses. Upload anyway?')) return
    setBusy(true); setLog([])
    const out: typeof log = []
    for (const file of Array.from(list)) {
      const who = scope === 'person' ? (f.staff_name === AUTO ? match(file.name) : f.staff_name) : null
      if (scope === 'person' && !who) { out.push({ file: file.name, ok: false, note: 'no employee’s name in the file name — pick the employee and upload it again' }); setLog([...out]); continue }
      try { await uploadFile(me.agency_id, file, { scope, staff_name: who, doc_type: f.doc_type, ...p, expires_on: t.freq === 'expires' ? f.expires || null : null, note: f.note.trim() || null }); out.push({ file: file.name, ok: true, note: `${t.short || t.label}${who ? ' → ' + who : ''}` }) } catch (e) { out.push({ file: file.name, ok: false, note: e instanceof Error ? e.message : String(e) }) }
      setLog([...out])
    }
    setBusy(false); onDone()
  }
  return (
    <Panel title={scope === 'agency' ? 'Add agency documents' : 'Add employee documents'} sub={scope === 'person' ? 'Pick the employee and the kind of document, then choose the files. Many timesheets at once? Name each file with the person’s name and pick “Match each file by its name”.' : 'Pick the kind of document, then choose the files.'}>
      <div className="cf-up">
        {scope === 'person' && <label>Employee<select className="fld" value={f.staff_name} onChange={(e) => setF({ ...f, staff_name: e.target.value })}>
          <option value="">Choose…</option><option value={AUTO}>Match each file by its name</option>
          {ordered.map((p) => <option key={p.name} value={p.name}>{p.name}{p.active ? '' : ' (former)'}</option>)}</select></label>}
        <label>Document<select className="fld" value={f.doc_type} onChange={(e) => setF({ ...f, doc_type: e.target.value })}>
          {groups.map((g) => <optgroup key={g} label={g}>{types.filter((x) => x.group === g).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>)}</select></label>
        {(t.freq === 'yearly' || t.freq === 'quarterly') && <label>Year<select className="fld" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })}>{[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d}>{year0 - d}</option>)}</select></label>}
        {t.freq === 'quarterly' && <label>Quarter<select className="fld" value={f.quarter} onChange={(e) => setF({ ...f, quarter: e.target.value })}>{[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}</select></label>}
        {t.freq === 'period' && <><label>From<input className="fld" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label><label>To<input className="fld" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label></>}
        {t.freq === 'expires' && <label>Expires on<input className="fld" type="date" value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} /></label>}
        <label className="cf-up-note">Note (optional)<input className="fld" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. signed copy, renewal receipt" /></label>
        <label className={'btn-primary cf-up-btn' + (busy ? ' disabled' : '')}>{busy ? 'Uploading…' : 'Choose files & upload'}
          <input type="file" multiple hidden disabled={busy} accept=".pdf,image/*,.doc,.docx,.xls,.xlsx,.csv" onChange={(e) => { run(e.target.files); e.target.value = '' }} /></label>
      </div>
      {t.why && <div className="sub cf-why">{t.why}</div>}
      {log.length > 0 && <div className="doc-up-log">{log.map((l, i) => <div key={i} className={l.ok ? 'ok' : 'bad'}><b>{l.ok ? '✓' : '✕'} {l.file}</b> — {l.note}</div>)}{!busy && <button className="linkbtn" onClick={() => setLog([])}>Dismiss</button>}</div>}
    </Panel>
  )
}
