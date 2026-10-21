// Retention › Daily renewal review: each workday, 10 renewals — 5 negative (the premium goes up) and 5 positive (with a
// cross-sell to offer). For each: call the client (twice if they don't answer), email a renewal snapshot when they
// can't be reached, note what happened. The day's one-page report shows on screen and downloads as a PDF.
import { useMemo, useState } from 'react'
import { getAccounts, getBookPolicies, type Account, type BookPolicy } from '../lib/books'
import { mdy, money0, money2, todayPacific } from '../lib/format'
import { loadScript } from '../lib/perf/commissionFiles'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

type Kind = 'negative' | 'positive'
type Call = 'no_answer' | 'voicemail' | 'reached'
export interface Review { id: number; name: string; day: string; kind: Kind; account_id: string | null; policy_id: string | null; client: string; policy: string | null; renewal_date: string | null; current_premium: number | null; renewal_premium: number | null; call1: Call | null; call2: Call | null; emailed: boolean; cross_sell: string | null; notes: string | null }
const GOAL: Record<Kind, number> = { negative: 5, positive: 5 }
const CALL: Record<Call, string> = { no_answer: 'No answer', voicemail: 'Left voicemail', reached: 'Reached' }
const reached = (r: Review) => r.call1 === 'reached' || r.call2 === 'reached'
const change = (r: Review) => (r.current_premium != null && r.renewal_premium != null ? Number(r.renewal_premium) - Number(r.current_premium) : null)
/** done: reached the client, or tried twice and emailed the snapshot */
const signed = (n: number) => (n > 0 ? '+' : n < 0 ? '-' : '') + money0(Math.abs(n))
const done = (r: Review) => reached(r) || (!!r.call1 && !!r.call2 && r.emailed)

export default function RenewalReview({ name, day, agency }: { name: string; day: string; agency: string }) {
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
  const save = async (id: number, patch: Partial<Review>) => {
    const { error } = await supabase.from('renewal_reviews').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) alert(error.message); else refresh()
  }
  return (
    <section className="rr">
      <div className="rr-h">
        <div><div className="rr-k">Daily renewal review · {mdy(day)}</div>
          <div className="rr-t">{list.length} of 10 renewals worked</div>
          <div className="rr-s">5 negative (premium going up) · 5 positive with a cross-sell · call twice, then email the renewal snapshot</div></div>
        <div className="rr-score">
          <span className={n('negative') >= 5 ? 'ok' : ''}>Negative {n('negative')}/5</span>
          <span className={n('positive') >= 5 ? 'ok' : ''}>Positive {n('positive')}/5</span>
          <span>Reached {list.filter(reached).length}</span>
          <span>Emailed {list.filter((r) => r.emailed).length}</span>
          <button className="rp-btn" disabled={!list.length} onClick={() => reportPdf(list, name, day, agency)}>Day’s report (PDF)</button>
        </div>
      </div>
      {rows.error ? <div className="rr-err">{String((rows.error as Error).message || rows.error)}</div> : !rows.data ? <div className="rr-s">Loading…</div> : <>
        {(['negative', 'positive'] as Kind[]).map((k) => (
          <div key={k} className="rr-group">
            <div className="rr-gh"><b>{k === 'negative' ? 'Negative renewals — premium going up' : 'Positive renewals — with a cross-sell'}</b><span>{n(k)} / {GOAL[k]}</span>
              {n(k) < GOAL[k] && <button className="linkbtn" onClick={() => setAdding(adding === k ? null : k)}>{adding === k ? 'Close' : '+ Add a renewal'}</button>}</div>
            {adding === k && <Picker kind={k} name={name} day={day} taken={list} onDone={() => { setAdding(null); refresh() }} />}
            {list.filter((r) => r.kind === k).map((r) => <Row key={r.id} r={r} save={save} remove={async () => { if (confirm(`Take ${r.client} off today’s list?`)) { await supabase.from('renewal_reviews').delete().eq('id', r.id); refresh() } }} />)}
            {!n(k) && adding !== k && <div className="rr-empty">None yet — add {GOAL[k]} {k} renewals.</div>}
          </div>
        ))}
      </>}
    </section>
  )
}

function Row({ r, save, remove }: { r: Review; save: (id: number, p: Partial<Review>) => void; remove: () => void }) {
  const [notes, setNotes] = useState(r.notes || ''), [cross, setCross] = useState(r.cross_sell || ''), [ren, setRen] = useState(r.renewal_premium == null ? '' : String(r.renewal_premium))
  const ch = change(r)
  return (
    <div className={'rr-row' + (done(r) ? ' rr-done' : '')}>
      <div className="rr-c">
        <b>{r.client}</b><span>{[r.policy, r.renewal_date ? `renews ${mdy(r.renewal_date)}` : ''].filter(Boolean).join(' · ')}</span>
        <span>Now {r.current_premium != null ? money0(Number(r.current_premium)) : '—'} → renewal <input className="fld rr-in" inputMode="decimal" value={ren} placeholder="amount" onChange={(e) => setRen(e.target.value)}
          onBlur={() => { const v = ren === '' ? null : Number(ren.replace(/[$,]/g, '')); if (v !== r.renewal_premium && (v == null || !isNaN(v))) save(r.id, { renewal_premium: v }) }} aria-label="Renewal premium" />
          {ch != null && <b className={ch > 0 ? 'rr-up' : 'rr-down'}> {signed(ch)}</b>}</span>
      </div>
      <div className="rr-calls">
        {(['call1', 'call2'] as const).map((c, i) => (
          <label key={c}>Call {i + 1}<select className="fld" value={r[c] || ''} onChange={(e) => save(r.id, { [c]: e.target.value || null })}>
            <option value="">—</option>{Object.entries(CALL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        ))}
        <label className="rr-check"><input type="checkbox" checked={r.emailed} onChange={(e) => save(r.id, { emailed: e.target.checked })} /> Emailed snapshot</label>
        {!reached(r) && <button className="linkbtn" onClick={() => copySnapshot(r)}>Copy snapshot email</button>}
      </div>
      <div className="rr-notes">
        {r.kind === 'positive' && <input className="fld" value={cross} placeholder="Cross-sell offered (e.g. umbrella, auto)" onChange={(e) => setCross(e.target.value)} onBlur={() => cross !== (r.cross_sell || '') && save(r.id, { cross_sell: cross || null })} aria-label="Cross-sell offered" />}
        <textarea className="fld" rows={2} value={notes} placeholder="Notes — what the client said, next step" onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (r.notes || '') && save(r.id, { notes: notes || null })} aria-label="Notes" />
      </div>
      <button className="rr-x" onClick={remove} aria-label={`Remove ${r.client}`}>×</button>
    </div>
  )
}

/** Upcoming renewals (next 60 days, not already worked) to add to today's list. */
function Picker({ kind, name, day, taken, onDone }: { kind: Kind; name: string; day: string; taken: Review[]; onDone: () => void }) {
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
    <div className="rr-pick">
      <input className="fld" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search renewals in the next 60 days" aria-label="Search renewals" />
      {book.error ? <div className="rr-err">Couldn’t load the book.</div> : !book.data ? <div className="rr-s">Loading renewals…</div> : (
        <div className="rr-pick-l">{rows.map(({ p, a }) => (
          <button key={p.id} className="rr-pick-r" onClick={() => add(a!, p)}><b>{a!.name}</b><span>{p.product} · {p.carrier} · renews {mdy(p.expiration!)}{p.premium ? ` · ${money0(Number(p.premium))}` : ''}</span></button>
        ))}{!rows.length && <div className="rr-s">No renewals in the next 60 days match.</div>}</div>
      )}
      <button className="linkbtn" onClick={addManual}>Client not in the book? Add by name</button>
    </div>
  )
}

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

/** The day's one-page report. */
export async function reportPdf(list: Review[], name: string, day: string, agency: string) {
  const w = window as unknown as { jspdf?: { jsPDF: new (o: object) => any } }
  if (!w.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
  const pdf = new w.jspdf!.jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' })
  const W = 792, L = 32, R = W - 32
  const txt = (s: string, x: number, y: number, size = 9, bold = false, c: [number, number, number] = [30, 34, 48], align?: 'right') => { pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.setTextColor(...c); pdf.text(s, x, y, align ? { align } : undefined) }
  const fit = (s: string, size: number, max: number) => { pdf.setFontSize(size); let t = s; if (pdf.getTextWidth(t) <= max) return t; while (t.length > 1 && pdf.getTextWidth(t + '…') > max) t = t.slice(0, -1); return t + '…' }
  pdf.setFillColor(22, 45, 120); pdf.rect(0, 0, W, 70, 'F')
  txt('Daily renewal review', L, 32, 18, true, [255, 255, 255]); txt(`${name} · ${mdy(day)}`, L, 52, 11, false, [220, 228, 255]); txt(agency, R, 32, 11, true, [220, 228, 255], 'right')
  const kpi = [['Worked', `${list.length} / 10`], ['Negative', `${list.filter((r) => r.kind === 'negative').length} / 5`], ['Positive', `${list.filter((r) => r.kind === 'positive').length} / 5`], ['Reached', String(list.filter(reached).length)], ['Emailed snapshot', String(list.filter((r) => r.emailed).length)], ['Cross-sells offered', String(list.filter((r) => r.cross_sell).length)]]
  const bw = (R - L - 50) / 6
  kpi.forEach(([l, v], i) => { const x = L + i * (bw + 10); pdf.setFillColor(245, 247, 252); pdf.roundedRect(x, 84, bw, 44, 5, 5, 'F'); txt(l.toUpperCase(), x + 8, 99, 7, true, [110, 116, 134]); txt(v, x + 8, 120, 15, true) })
  const cols: [string, number][] = [['Type', 54], ['Client', 120], ['Policy · renews', 150], ['Change', 60], ['Calls', 110], ['Reached', 46], ['Emailed', 46], ['Cross-sell · notes', 142]]
  let y = 150; let x = L
  pdf.setFillColor(22, 45, 120); pdf.rect(L, y - 11, R - L, 16, 'F')
  cols.forEach(([h, cw]) => { txt(h, x + 4, y, 8, true, [255, 255, 255]); x += cw }); y += 16
  const rowsH = Math.min(30, (560 - y) / Math.max(1, list.length))
  list.forEach((r, i) => {
    if (i % 2) { pdf.setFillColor(250, 251, 254); pdf.rect(L, y - 10, R - L, rowsH, 'F') }
    const ch = change(r)
    const cells = [r.kind === 'negative' ? 'Negative' : 'Positive', r.client, `${r.policy || ''}${r.renewal_date ? ' · ' + mdy(r.renewal_date) : ''}`, ch == null ? '—' : signed(ch),
      [r.call1 && CALL[r.call1], r.call2 && CALL[r.call2]].filter(Boolean).join(', ') || 'Not called', reached(r) ? 'Yes' : 'No', r.emailed ? 'Yes' : 'No', [r.cross_sell && `Cross-sell: ${r.cross_sell}`, r.notes].filter(Boolean).join(' — ')]
    x = L
    cells.forEach((c, k) => { txt(fit(String(c), 8.5, cols[k][1] - 8), x + 4, y, 8.5, k === 1); x += cols[k][1] })
    y += rowsH
  })
  txt(`Made ${mdy(todayPacific())} in Declara`, L, 590, 8, false, [110, 116, 134])
  pdf.save(`renewal-review-${name.replace(/\s+/g, '-')}-${day}.pdf`)
}
