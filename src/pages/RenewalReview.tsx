// Retention › Daily renewal review: each workday, 20 renewals — 10 negative (the premium goes up; pulled from the ranked
// negative call list) and 10 positive (with a cross-sell to offer). For each: call the client (twice if they don't
// answer; a number marked DNC on the list is still called, the flag just shows). Before the call she writes up her findings on the renewal and attaches the
// renewal options PDF; after it she marks the result — reached the client, or no contact and the snapshot emailed — and
// notes what happened. The day's one-page report shows on screen and downloads
// as a PDF; Reports › Renewal reviews shows every day's work to the owner.
import { useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { getAccounts, getBookPolicies, type Account, type BookPolicy } from '../lib/books'
import { mdy, money0, money2, todayPacific } from '../lib/format'
import { loadScript } from '../lib/perf/commissionFiles'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

type Kind = 'negative' | 'positive'
type Call = 'no_answer' | 'voicemail' | 'reached'
export interface Review { id: number; name: string; day: string; kind: Kind; account_id: string | null; policy_id: string | null; client: string; policy: string | null; renewal_date: string | null; current_premium: number | null; renewal_premium: number | null; call1: Call | null; call2: Call | null; emailed: boolean; cross_sell: string | null; notes: string | null; findings: string | null
  phone: string | null; dnc: boolean; spoke: boolean; options_path: string | null; options_file: string | null }
interface Listed { id: number; kind: Kind; rank: number; client: string; policy_number: string | null; lob: string | null; renewal_date: string | null; current_premium: number | null; renewal_premium: number | null; phone: string | null; phone_type: string | null; dnc: boolean; notes: string | null }
export const GOAL: Record<Kind, number> = { negative: 10, positive: 10 }
export const DAY_GOAL = GOAL.negative + GOAL.positive
const CALL: Record<Call, string> = { no_answer: 'No answer', voicemail: 'Left voicemail', reached: 'Reached' }
// the call attempts that didn't reach the client (reaching them is the Reached client button)
const TRIES: Call[] = ['no_answer', 'voicemail']
/** spoke to the client: marked, or a call that reached them */
export const reached = (r: Review) => r.spoke || r.call1 === 'reached' || r.call2 === 'reached'
const change = (r: Review) => (r.current_premium != null && r.renewal_premium != null ? Number(r.renewal_premium) - Number(r.current_premium) : null)
/** the first phone number in the contact line, as digits to dial */
const dial = (s: string) => (s.match(/\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/)?.[0] || '').replace(/\D/g, '')
/** clears a call attempt recorded as reached (older rows), so the outcome buttons decide */
const unreach = (r: Review) => ({ ...(r.call1 === 'reached' ? { call1: null } : {}), ...(r.call2 === 'reached' ? { call2: null } : {}) })
/** a renewal counts as worked only once it has notes (findings before the call, or the result of the call) */
export const worked = (r: Pick<Review, 'findings' | 'notes'>) => !!(r.findings?.trim() || r.notes?.trim())
export const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '-' : '') + money0(Math.abs(n))
/** done: has notes, and spoke to the client or emailed the snapshot after two tries */
export const done = (r: Review) => worked(r) && (reached(r) || (r.emailed && !!r.call1 && !!r.call2))
/** the call list rows are tied to their review by policy_id, so a client is never worked twice */
const listKey = (l: Pick<Listed, 'policy_number' | 'id'>) => 'call-list:' + (l.policy_number || l.id)
const fromList = (l: Listed, name: string, day: string) => ({ name, day, kind: l.kind, policy_id: listKey(l), client: l.client,
  policy: [l.lob, l.policy_number].filter(Boolean).join(' · ') || null, renewal_date: l.renewal_date, current_premium: l.current_premium, renewal_premium: l.renewal_premium,
  phone: [l.phone && `${l.phone}${l.phone_type ? ` (${l.phone_type})` : ''}`, l.notes].filter(Boolean).join(' · ') || null, dnc: l.dnc })

export async function openOptions(r: Review) {
  if (!r.options_path) return
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(r.options_path, 120)
  if (error || !data) { alert('Could not open that file: ' + (error?.message || 'unknown error')); return }
  window.open(data.signedUrl, '_blank', 'noopener')
}

/** day: the day to open on; the review has its own date picker so any earlier day's work (and its PDF) can be pulled up */
export default function RenewalReview({ name, day: start, agency }: { name: string; day: string; agency: string }) {
  const today = todayPacific()
  const [day, setDay] = useState(start)
  const [reload, setReload] = useState(0)
  const rows = useAsync(async () => {
    const { data, error } = await supabase.from('renewal_reviews').select('*').eq('name', name).eq('day', day).order('kind').order('id')
    if (error) throw error
    return (data || []) as Review[]
  }, [name, day, reload])
  const [adding, setAdding] = useState<Kind | null>(null)
  const refresh = () => setReload((n) => n + 1)
  const list = rows.data || []
  const n = (k: Kind) => list.filter((r) => r.kind === k).length
  const wk = (k: Kind) => list.filter((r) => r.kind === k && worked(r)).length
  const done_ = list.filter(worked)
  const save = async (id: number, patch: Partial<Review>) => {
    const { error } = await supabase.from('renewal_reviews').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) alert(error.message); else refresh()
  }
  return (
    <section className="rr">
      <div className="rr-h">
        <div><div className="rr-k rr-day">Daily renewal review ·
            <button className="rr-step" onClick={() => setDay(workday(day, -1))} aria-label="Previous workday">‹</button>
            <input type="date" className="fld rr-date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value > today ? today : e.target.value)} aria-label="Review day" />
            <button className="rr-step" disabled={day >= today} onClick={() => setDay(workday(day, 1) > today ? today : workday(day, 1))} aria-label="Next workday">›</button>
            {day !== today && <button className="linkbtn" onClick={() => setDay(today)}>Back to today</button>}</div>
          <div className="rr-t">{done_.length} of {DAY_GOAL} renewals worked</div>
          <div className="rr-s">{GOAL.negative} negative (premium going up) · {GOAL.positive} positive with a cross-sell · call twice, then email the renewal snapshot · attach the renewal options PDF · a renewal counts as worked once it has notes</div></div>
        <div className="rr-score">
          <span className={wk('negative') >= GOAL.negative ? 'ok' : ''}>Negative {wk('negative')}/{GOAL.negative}</span>
          <span className={wk('positive') >= GOAL.positive ? 'ok' : ''}>Positive {wk('positive')}/{GOAL.positive}</span>
          <span>Reached {done_.filter(reached).length}</span><span>No contact, emailed {done_.filter((r) => !reached(r) && r.emailed).length}</span>
          <span>Options PDFs {list.filter((r) => r.options_path).length}</span>
          <button className="rp-btn" disabled={!list.length} onClick={() => reportPdf(list, name, day, agency)}>Day’s report (PDF)</button>
        </div>
      </div>
      {rows.error ? <div className="rr-err">{String((rows.error as Error).message || rows.error)}</div> : !rows.data ? <div className="rr-s">Loading…</div> : <>
        {(['negative', 'positive'] as Kind[]).map((k) => (
          <div key={k} className="rr-group">
            <div className="rr-gh"><b>{k === 'negative' ? 'Negative renewals — premium going up' : 'Positive renewals — with a cross-sell'}</b><span>{wk(k)} / {GOAL[k]} worked{n(k) > wk(k) ? ` · ${n(k) - wk(k)} on the list without notes` : ''}</span>
              {n(k) < GOAL[k] && <button className="linkbtn" onClick={() => setAdding(adding === k ? null : k)}>{adding === k ? 'Close' : '+ Add a renewal'}</button>}</div>
            {adding === k && <Picker kind={k} name={name} day={day} taken={list} onDone={() => { setAdding(null); refresh() }} />}
            {list.filter((r) => r.kind === k).map((r) => <Row key={r.id} r={r} save={save} refresh={refresh} remove={async () => { if (confirm(`Take ${r.client} off today’s list?`)) { if (r.options_path) await supabase.storage.from('documents').remove([r.options_path]); await supabase.from('renewal_reviews').delete().eq('id', r.id); refresh() } }} />)}
            {!n(k) && adding !== k && <div className="rr-empty">None yet — add {GOAL[k]} {k} renewals.</div>}
          </div>
        ))}
      </>}
    </section>
  )
}

function Row({ r, save, refresh, remove }: { r: Review; save: (id: number, p: Partial<Review>) => void; refresh: () => void; remove: () => void }) {
  const { me } = useAuth()
  const file = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const attach = async (f: File) => {
    setBusy(true)
    try {
      // a new file each time (storage refuses replacing in place); the old one is removed once the row points at the new
      const ext = (f.name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || 'pdf'
      const path = `${me?.agency_id}/renewals/${r.id}-${Date.now()}.${ext}`
      const up = await supabase.storage.from('documents').upload(path, f, { upsert: false, contentType: f.type || 'application/pdf' })
      if (up.error) throw up.error
      const { error } = await supabase.from('renewal_reviews').update({ options_path: path, options_file: f.name, updated_at: new Date().toISOString() }).eq('id', r.id)
      if (error) { await supabase.storage.from('documents').remove([path]); throw error }
      if (r.options_path) await supabase.storage.from('documents').remove([r.options_path])
      refresh()
    } catch (e) { alert('Could not attach the file: ' + String((e as Error)?.message || e)) } finally { setBusy(false) }
  }
  const [notes, setNotes] = useState(r.notes || ''), [findings, setFindings] = useState(r.findings || ''), [cross, setCross] = useState(r.cross_sell || ''), [ren, setRen] = useState(r.renewal_premium == null ? '' : String(r.renewal_premium))
  const ch = change(r)
  return (
    <div className={'rr-row' + (done(r) ? ' rr-done' : '')}>
      <div className="rr-c">
        <b>{r.client}</b><span>{[r.policy, r.renewal_date ? `renews ${mdy(r.renewal_date)}` : ''].filter(Boolean).join(' · ')}</span>
        {(r.phone || r.dnc) && <span>{r.phone && (!dial(r.phone) ? r.phone : <a href={`tel:${dial(r.phone)}`}>{r.phone}</a>)}{r.dnc && <b className="rr-dnc" title="Marked DNC on the call list — still reach out"> DNC on file</b>}</span>}
        <span>Now {r.current_premium != null ? money0(Number(r.current_premium)) : '—'} → renewal <input className="fld rr-in" inputMode="decimal" value={ren} placeholder="amount" onChange={(e) => setRen(e.target.value)}
          onBlur={() => { const v = ren === '' ? null : Number(ren.replace(/[$,]/g, '')); if (v !== r.renewal_premium && (v == null || !isNaN(v))) save(r.id, { renewal_premium: v }) }} aria-label="Renewal premium" />
          {ch != null && <b className={ch > 0 ? 'rr-up' : 'rr-down'}> {signed(ch)}</b>}</span>
      </div>
      <div className="rr-notes">
        <div className="rr-lbl">Before the call — findings</div>
        <textarea className="fld" rows={3} value={findings} placeholder="What you found reviewing the renewal: why it went up, coverage changes, options to offer" onChange={(e) => setFindings(e.target.value)} onBlur={() => findings !== (r.findings || '') && save(r.id, { findings: findings || null })} aria-label="Findings before the call" />
        {r.kind === 'positive' && <input className="fld" value={cross} placeholder="Cross-sell to offer (e.g. umbrella, auto)" onChange={(e) => setCross(e.target.value)} onBlur={() => cross !== (r.cross_sell || '') && save(r.id, { cross_sell: cross || null })} aria-label="Cross-sell to offer" />}
        <div className="rr-opt">
          {r.options_path ? <><button className="linkbtn" onClick={() => openOptions(r)} title={r.options_file || ''}>📄 Renewal options PDF</button><button className="linkbtn" disabled={busy} onClick={() => file.current?.click()}>Replace</button></>
            : <button className="linkbtn rr-attach" disabled={busy} onClick={() => file.current?.click()}>{busy ? 'Attaching…' : '+ Attach renewal options PDF'}</button>}
          <input ref={file} type="file" accept="application/pdf,image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) attach(f) }} />
        </div>
      </div>
      <div className="rr-calls">
        <div className="rr-lbl">Result of the call</div>
        <div className="rr-out">
          <button className={'rr-ob rr-ob-yes' + (reached(r) ? ' on' : '')} aria-pressed={reached(r)} onClick={() => save(r.id, reached(r) ? { spoke: false, ...unreach(r) } : { spoke: true })}>✓ Reached client</button>
          <button className={'rr-ob rr-ob-no' + (!reached(r) && r.emailed ? ' on' : '')} aria-pressed={!reached(r) && r.emailed} onClick={() => save(r.id, !reached(r) && r.emailed ? { emailed: false } : { spoke: false, emailed: true, ...unreach(r) })}>✉ No contact — emailed</button>
        </div>
        <div className="rr-tries">{(['call1', 'call2'] as const).map((c, i) => (
          <label key={c}>Call {i + 1}<select className="fld" value={r[c] === 'reached' ? '' : r[c] || ''} onChange={(e) => save(r.id, { [c]: e.target.value || null })}>
            <option value="">—</option>{TRIES.map((k) => <option key={k} value={k}>{CALL[k]}</option>)}</select></label>
        ))}</div>
        {!reached(r) && <button className="linkbtn" onClick={() => copySnapshot(r)}>Copy snapshot email</button>}
        <textarea className="fld" rows={2} value={notes} placeholder="What the client said, next step" onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (r.notes || '') && save(r.id, { notes: notes || null })} aria-label="Result of the call" />
      </div>
      <button className="rr-x" onClick={remove} aria-label={`Remove ${r.client}`}>×</button>
    </div>
  )
}

/** Renewals to add to today's list: the next ones on the ranked call list (not yet worked), or upcoming renewals in the
 * book (next 60 days, not already worked). */
function Picker({ kind, name, day, taken, onDone }: { kind: Kind; name: string; day: string; taken: Review[]; onDone: () => void }) {
  const calls = useAsync(async () => {
    const [l, w] = await Promise.all([
      supabase.from('renewal_call_list').select('*').eq('kind', kind).order('rank'),
      supabase.from('renewal_reviews').select('policy_id').like('policy_id', 'call-list:%'),
    ])
    if (l.error) throw l.error
    const worked = new Set((w.data || []).map((x: { policy_id: string }) => x.policy_id))
    return (l.data as Listed[]).filter((x) => !worked.has(listKey(x)))
  }, [kind])
  const [src, setSrc] = useState<'list' | 'book' | null>(null)
  const next = (calls.data || []).filter((l) => !taken.some((r) => r.policy_id === listKey(l)))
  const room = Math.max(0, GOAL[kind] - taken.filter((r) => r.kind === kind).length)
  const addList = async (rows: Listed[]) => {
    if (!rows.length) return
    const { error } = await supabase.from('renewal_reviews').insert(rows.map((l) => fromList(l, name, day)))
    if (error) alert(error.message); else onDone()
  }
  const which = src || (next.length ? 'list' : 'book')
  return (
    <div className="rr-pick">
      {!!calls.data?.length && <div className="cf-seg"><button className={which === 'list' ? 'on' : ''} onClick={() => setSrc('list')}>{kind === 'negative' ? 'Negative' : 'Positive'} call list ({next.length} left)</button><button className={which === 'book' ? 'on' : ''} onClick={() => setSrc('book')}>Book of business</button></div>}
      {which === 'list' ? <>
        {room > 0 && next.length > 0 && <button className="rp-btn" onClick={() => addList(next.slice(0, room))}>Add the next {Math.min(room, next.length)} from the list</button>}
        <div className="rr-pick-l">{next.slice(0, 40).map((l) => (
          <button key={l.id} className="rr-pick-r" onClick={() => addList([l])}><b>#{l.rank} {l.client}{l.dnc ? ' · DNC' : ''}</b>
            <span>{[l.lob, l.policy_number, l.renewal_date && `renews ${mdy(l.renewal_date)}`, l.renewal_premium != null && `renewal ${money0(Number(l.renewal_premium))}`, l.current_premium != null && l.renewal_premium != null && signed(Number(l.renewal_premium) - Number(l.current_premium))].filter(Boolean).join(' · ')}</span></button>
        ))}{!next.length && <div className="rr-s">Everyone on the list has been worked.</div>}</div>
      </> : <BookPicker kind={kind} name={name} day={day} taken={taken} onDone={onDone} />}
    </div>
  )
}

function BookPicker({ kind, name, day, taken, onDone }: { kind: Kind; name: string; day: string; taken: Review[]; onDone: () => void }) {
  const today = todayPacific()
  const book = useAsync(async () => {
    const [a, p] = await Promise.all([getAccounts(), getBookPolicies()])
    const { data } = await supabase.from('renewal_reviews').select('policy_id').eq('name', name).gte('day', addDays(today, -60))
    return { byId: new Map(a.map((x) => [x.id, x])), policies: p, worked: new Set((data || []).map((x: { policy_id: string | null }) => x.policy_id).filter(Boolean) as string[]) }
  }, [name])
  const [q, setQ] = useState('')
  const until = addDays(today, 60)
  const rows = useMemo(() => {
    if (!book.data) return []
    const t = q.trim().toLowerCase()
    return book.data.policies.filter((p) => p.expiration && p.expiration >= today && p.expiration <= until && !book.data!.worked.has(p.id) && !taken.some((r) => r.policy_id === p.id) && !/cancel/i.test(p.status || ''))
      .map((p) => ({ p, a: book.data!.byId.get(p.account_id) })).filter((x) => x.a && (!t || `${x.a.name} ${x.p.product} ${x.p.policy_number}`.toLowerCase().includes(t)))
      .sort((x, y) => (x.p.expiration! < y.p.expiration! ? -1 : 1)).slice(0, 40)
  }, [book.data, q, taken, today, until])
  const add = async (a: Account, p: BookPolicy) => {
    const { error } = await supabase.from('renewal_reviews').insert({ name, day, kind, account_id: a.id, policy_id: p.id, client: a.name, policy: [p.product, p.carrier, p.policy_number].filter(Boolean).join(' · '), renewal_date: p.expiration, current_premium: p.premium })
    if (error) alert(error.message); else onDone()
  }
  const addManual = async () => {
    const client = prompt('Client name (not in Books of Business):'); if (!client?.trim()) return
    const { error } = await supabase.from('renewal_reviews').insert({ name, day, kind, client: client.trim() })
    if (error) alert(error.message); else onDone()
  }
  return (
    <>
      <input className="fld" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search renewals in the next 60 days" aria-label="Search renewals" />
      {book.error ? <div className="rr-err">Couldn’t load the book.</div> : !book.data ? <div className="rr-s">Loading renewals…</div> : (
        <div className="rr-pick-l">{rows.map(({ p, a }) => (
          <button key={p.id} className="rr-pick-r" onClick={() => add(a!, p)}><b>{a!.name}</b><span>{p.product} · {p.carrier} · renews {mdy(p.expiration!)}{p.premium ? ` · ${money0(Number(p.premium))}` : ''}</span></button>
        ))}{!rows.length && <div className="rr-s">No renewals in the next 60 days match.</div>}</div>
      )}
      <button className="linkbtn" onClick={addManual}>Client not in the book? Add by name</button>
    </>
  )
}

/** the workday n steps away (weekends skipped) */
const workday = (iso: string, n: number) => { let d = addDays(iso, n); while ([0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())) d = addDays(d, n); return d }
const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/** The renewal snapshot email for a client who couldn't be reached: copied to paste into an email. */
function copySnapshot(r: Review) {
  const ch = change(r)
  const lines = [
    `Subject: Your ${r.policy?.split(' · ')[0] || 'policy'} renewal${r.renewal_date ? ` — ${mdy(r.renewal_date)}` : ''}`, '',
    `Hi ${r.client.split(/[ ,]/)[0]},`, '',
    `I tried calling about your upcoming renewal and wanted to send you a quick snapshot:`, '',
    `• Policy: ${r.policy || '—'}`,
    r.renewal_date ? `• Renews: ${mdy(r.renewal_date)}` : '',
    r.current_premium != null ? `• Current premium: ${money2(Number(r.current_premium))}` : '',
    r.renewal_premium != null ? `• Renewal premium: ${money2(Number(r.renewal_premium))}${ch != null ? ` (${ch > 0 ? 'up' : 'down'} ${money2(Math.abs(ch))})` : ''}` : '',
    '', r.kind === 'negative' ? 'Your premium is going up at renewal. I’d like to review your coverage and options with you to make sure you’re getting the best value — it only takes a few minutes.'
      : `Good news on your renewal.${r.cross_sell ? ` I’d also love to show you how adding ${r.cross_sell} could protect you further, often with a multi-policy discount.` : ''}`,
    '', 'Give me a call back at your convenience, or reply with a good time to talk.', '', 'Thank you,',
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '')
  navigator.clipboard?.writeText(lines.join('\n')).then(() => alert('Snapshot email copied — paste it into an email to the client.'), () => prompt('Copy this email:', lines.join('\n')))
}

/** The day's report: the counts, then every renewal with its findings and the result of the call printed in full. */
export async function reportPdf(list: Review[], name: string, day: string, agency: string) {
  const w = window as unknown as { jspdf?: { jsPDF: new (o: object) => any } }
  if (!w.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
  const pdf = new w.jspdf!.jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
  const W = 792, H = 612, L = 32, R = W - 32, BOTTOM = H - 36
  type RGB = [number, number, number]
  const INK: RGB = [30, 34, 48], MUTED: RGB = [110, 116, 134], NAVY: RGB = [22, 45, 120]
  const font = (size: number, bold = false, c: RGB = INK) => { pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.setTextColor(...c) }
  const txt = (s: string, x: number, y: number, size = 9, bold = false, c: RGB = INK, align?: 'right') => { font(size, bold, c); pdf.text(s, x, y, align ? { align } : undefined) }
  const wrap = (s: string, size: number, max: number, bold = false) => { font(size, bold); return pdf.splitTextToSize(s, max) as string[] }
  const done = list.filter(worked)
  pdf.setFillColor(...NAVY); pdf.rect(0, 0, W, 70, 'F')
  txt('Daily renewal review', L, 32, 18, true, [255, 255, 255]); txt(`${name} · ${mdy(day)}`, L, 52, 11, false, [220, 228, 255]); txt(agency, R, 32, 11, true, [220, 228, 255], 'right')
  const kpi = [['Worked (with notes)', `${done.length} / ${DAY_GOAL}`], ['Negative', `${done.filter((r) => r.kind === 'negative').length} / ${GOAL.negative}`], ['Positive', `${done.filter((r) => r.kind === 'positive').length} / ${GOAL.positive}`],
    ['Reached client', String(done.filter(reached).length)], ['No contact, emailed', String(done.filter((r) => !reached(r) && r.emailed).length)], ['Options PDFs', String(list.filter((r) => r.options_path).length)], ['On the list, no notes', String(list.length - done.length)]]
  const bw = (R - L - 60) / 7
  kpi.forEach(([l, v], i) => { const x = L + i * (bw + 10); pdf.setFillColor(245, 247, 252); pdf.roundedRect(x, 84, bw, 44, 5, 5, 'F'); txt(l.toUpperCase(), x + 8, 99, 6.5, true, MUTED); txt(v, x + 8, 120, 15, true) })
  // client and result on the left; the findings and the result of the call get the width, wrapped in full
  const cols: [string, number][] = [['Client', 168], ['Result', 104], ['Findings before the call', 228], ['Result of the call', 228]]
  const xs: number[] = []; { let x = L; cols.forEach(([, cw]) => { xs.push(x); x += cw }) }
  let y = 142
  const head = () => { pdf.setFillColor(...NAVY); pdf.rect(L, y, R - L, 17, 'F'); cols.forEach(([h], k) => txt(h, xs[k] + 6, y + 11.5, 8, true, [255, 255, 255])); y += 17 }
  head()
  const SIZE = 9, LH = 11.5
  list.forEach((r, i) => {
    const ch = change(r)
    const client = wrap(r.client, SIZE, cols[0][1] - 12, true)
    const sub = wrap([r.kind === 'negative' ? 'Negative' : 'Positive', r.policy, r.renewal_date && `renews ${mdy(r.renewal_date)}`, ch != null && signed(ch), r.dnc && 'DNC on file'].filter(Boolean).join(' · '), 7.5, cols[0][1] - 12)
    const result = !worked(r) ? ['Not worked — no notes'] : [reached(r) ? 'Reached client' : r.emailed ? 'No contact, emailed' : 'Not reached yet',
      ...[r.call1, r.call2].map((c, k) => (c ? `Call ${k + 1}: ${CALL[c]}` : '')).filter(Boolean), r.options_path ? 'Options PDF attached' : ''].filter(Boolean)
    const findings = wrap([r.findings, r.cross_sell && `Cross-sell: ${r.cross_sell}`].filter(Boolean).join('\n') || '—', SIZE, cols[2][1] - 12)
    const notes = wrap(r.notes || '—', SIZE, cols[3][1] - 12)
    const h = 10 + Math.max(client.length * LH + sub.length * 10, result.length * 11, findings.length * LH, notes.length * LH)
    if (y + h > BOTTOM) { pdf.addPage(); y = 32; head() }
    if (i % 2) { pdf.setFillColor(248, 249, 253); pdf.rect(L, y, R - L, h, 'F') }
    const top = y + 13
    client.forEach((ln, k) => txt(ln, xs[0] + 6, top + k * LH, SIZE, true))
    sub.forEach((ln, k) => txt(ln, xs[0] + 6, top + client.length * LH + k * 10, 7.5, false, MUTED))
    result.forEach((ln, k) => txt(ln, xs[1] + 6, top + k * 11, k ? 7.5 : 8.5, !k, k ? MUTED : !worked(r) ? [190, 40, 40] : reached(r) ? [22, 130, 70] : NAVY))
    findings.forEach((ln, k) => txt(ln, xs[2] + 6, top + k * LH, SIZE, false, findings[0] === '—' ? MUTED : INK))
    notes.forEach((ln, k) => txt(ln, xs[3] + 6, top + k * LH, SIZE, false, notes[0] === '—' ? MUTED : INK))
    pdf.setDrawColor(226, 229, 238); pdf.setLineWidth(0.6); pdf.line(L, y + h, R, y + h)
    y += h
  })
  const pages = pdf.getNumberOfPages()
  for (let i = 1; i <= pages; i++) { pdf.setPage(i); txt(`Made ${mdy(todayPacific())} in Declara`, L, H - 16, 8, false, MUTED); txt(`Page ${i} of ${pages}`, R, H - 16, 8, true, MUTED, 'right') }
  pdf.save(`renewal-review-${name.replace(/\s+/g, '-')}-${day}.pdf`)
}
