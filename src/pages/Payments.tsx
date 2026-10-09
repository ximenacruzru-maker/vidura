import { useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { GoalCard, Section } from '../components/Report'
import { ErrorBox, Loading } from '../components/ui'
import { agencyName } from '../lib/data'
import { mdy, money2, todayPacific } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

/** Checks & Cash: every check, money order and cash payment that comes into the office, and what happened to it —
 *  mailed to the carrier with the remittance coupon (Farmers checks can't be applied in the office any more) and/or
 *  applied to the client's account — by month, with everything still waiting (from any month) up top. Records are
 *  permanent: the database refuses deletes and changes to what was received; a mistake is voided with a reason and
 *  logged again, and every step is kept in the payment's history. */

export interface Receipt {
  id: number; received_on: string; method: Method; amount: number; payer: string; insured: string | null; account_number: string | null
  carrier: string | null; check_number: string | null; check_date: string | null; amount_due: number | null; note: string | null
  received_by: string; status: 'received' | 'mailed' | 'applied' | 'returned' | 'void'; mailed_on: string | null; mailed_by: string | null; mailed_note: string | null; applied_on: string | null; applied_by: string | null
  applied_ref: string | null; applied_note: string | null; closed_reason: string | null; closed_by: string | null; closed_at: string | null
  scan_path: string | null; created_at: string
}
interface Event { id: number; receipt_id: number; at: string; by_name: string | null; action: string; detail: string | null }
type Method = 'check' | 'cash' | 'money_order' | 'cashiers_check' | 'other'
const METHOD: Record<Method, string> = { check: 'Check', cash: 'Cash', money_order: 'Money order', cashiers_check: 'Cashier’s check', other: 'Other' }
const STATUS: Record<Receipt['status'], { label: string; kind: string }> = {
  received: { label: 'Not sent yet', kind: 'k-warn' }, mailed: { label: 'Mailed', kind: 'k-cross_sell' }, applied: { label: 'Applied', kind: 'k-save' },
  returned: { label: 'Returned', kind: 'k-loss' }, void: { label: 'Void', kind: 'k-review' },
}
const BUCKET = 'payment-records'
const monthLabel = (m: string) => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const daysSince = (iso: string, today: string) => Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(iso + 'T12:00:00Z')) / 864e5)
const amt = (n: number | null | undefined) => money2(Number(n) || 0)

export default function Payments() {
  const { me } = useAuth()
  const today = todayPacific()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [reload, setReload] = useState(0)
  const bump = () => setReload((n) => n + 1)
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<number | null>(null)

  const data = useAsync(async () => {
    const from = month + '-01', [y, m] = month.split('-').map(Number), to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    const [inMonth, waiting, months] = await Promise.all([
      supabase.from('payment_receipts').select('*').gte('received_on', from).lte('received_on', to).order('received_on', { ascending: false }).order('id', { ascending: false })
        .then((r) => { if (r.error) throw r.error; return r.data as Receipt[] }),
      supabase.from('payment_receipts').select('*').eq('status', 'received').order('received_on').then((r) => { if (r.error) throw r.error; return r.data as Receipt[] }),
      supabase.from('payment_receipts').select('received_on').order('received_on').limit(1).then((r) => (r.data as { received_on: string }[] | null)?.[0]?.received_on || today),
    ])
    return { inMonth, waiting, first: months }
  }, [month, reload])

  const months = useMemo(() => {
    const out: string[] = [], first = (data.data?.first || today).slice(0, 7)
    for (let d = new Date(today.slice(0, 7) + '-15T12:00:00Z'); d.toISOString().slice(0, 7) >= first; d.setUTCMonth(d.getUTCMonth() - 1)) out.push(d.toISOString().slice(0, 7))
    return out
  }, [data.data?.first, today])

  if (data.error) return <ErrorBox error={data.error} />
  if (!data.data) return <Loading what="Loading checks & cash" />
  const { inMonth, waiting } = data.data
  const live = inMonth.filter((r) => r.status !== 'void')
  const sum = (l: Receipt[]) => l.reduce((a, r) => a + Number(r.amount), 0)
  const applied = live.filter((r) => r.status === 'applied' || r.status === 'mailed'), returned = live.filter((r) => r.status === 'returned')
  const oldest = waiting[0] ? daysSince(waiting[0].received_on, today) : 0
  const who = me?.display_name || 'Staff'

  const csv = () => {
    const q = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
    const head = ['Received', 'Method', 'Amount', 'Payer', 'Insured', 'Account / policy #', 'Carrier', 'Check #', 'Check date', 'Amount due', 'Received by', 'Status', 'Mailed on', 'Mailed by', 'Mailing note', 'Applied on', 'Applied by', 'Confirmation #', 'Applied note', 'Returned/void reason', 'Note']
    const rows = inMonth.map((r) => [mdy(r.received_on), METHOD[r.method], Number(r.amount).toFixed(2), r.payer, r.insured, r.account_number, r.carrier, r.check_number, r.check_date ? mdy(r.check_date) : '',
      r.amount_due ?? '', r.received_by, STATUS[r.status].label, r.mailed_on ? mdy(r.mailed_on) : '', r.mailed_by, r.mailed_note, r.applied_on ? mdy(r.applied_on) : '', r.applied_by, r.applied_ref, r.applied_note, r.closed_reason, r.note])
    const blob = new Blob([[head, ...rows].map((l) => l.map(q).join(',')).join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Checks_and_Cash_${month}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 500)
  }

  return (
    <div className="rp">
      <header className="rp-band">
        <div className="rp-band-l">
          <div className="rp-kick">Agency Management</div>
          <h1>Checks &amp; Cash</h1>
          <div className="rp-who">Every payment received, and whether it was mailed or applied · records are permanent</div>
        </div>
        <div className="rp-band-r">
          <div className="rp-agency">{agencyName(me)}</div>
          <div className="rp-actions">
            <select className="fld" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
            <button className="rp-btn" onClick={csv}>Download month (CSV)</button>
            <button className="rp-btn" onClick={() => setAdding(!adding)}>{adding ? 'Close' : '+ Log a payment'}</button>
          </div>
        </div>
      </header>

      {adding && <LogForm today={today} who={who} onSaved={(m) => { setAdding(false); setMonth(m); bump() }} />}

      <div className="rp-cards">
        <GoalCard label={`Received · ${monthLabel(month)}`} show={amt(sum(live))} note={`${live.length} payment${live.length === 1 ? '' : 's'}`} good={false} neutral />
        <GoalCard label={`Mailed or applied · ${monthLabel(month)}`} show={amt(sum(applied))} note={`${applied.length} of ${live.length}`} pct={live.length ? applied.length / live.length : 0} good={live.length > 0 && applied.length === live.length - returned.length} />
        <GoalCard label="Not sent yet · any month" show={amt(sum(waiting))} note={waiting.length ? `${waiting.length} waiting · oldest ${oldest} day${oldest === 1 ? '' : 's'}` : 'all caught up'} good={!waiting.length} />
        <GoalCard label={`Returned · ${monthLabel(month)}`} show={amt(sum(returned))} note={`${returned.length} bounced or sent back`} good={!returned.length} neutral={!returned.length} />
      </div>

      {waiting.length > 0 && (
        <Section title="Waiting to go out" sub="every month · mail or apply these the same day they come in">
          <Table rows={waiting} today={today} open={open} setOpen={setOpen} who={who} onChange={bump} showAge />
        </Section>
      )}

      <Section title={`${monthLabel(month)}`} sub={`${inMonth.length} logged · by the day received`}>
        {inMonth.length ? <Table rows={inMonth} today={today} open={open} setOpen={setOpen} who={who} onChange={bump} />
          : <div className="rp-empty">Nothing logged for {monthLabel(month)}.</div>}
      </Section>
      <div className="rp-muted" style={{ marginTop: 14 }}>Payment records can’t be deleted or edited — not by anyone. If something was logged wrong, void it with the reason and log it again; both stay on file.</div>
    </div>
  )
}

function Table({ rows, today, open, setOpen, who, onChange, showAge }: { rows: Receipt[]; today: string; open: number | null; setOpen: (n: number | null) => void; who: string; onChange: () => void; showAge?: boolean }) {
  return (
    <div className="tbl-wrap"><table className="rp-tbl pay-tbl">
      <thead><tr><th>Received</th><th>Method</th><th>Payer / insured</th><th>Account #</th><th className="r">Amount</th><th>Status</th><th /></tr></thead>
      <tbody>{rows.map((r) => (<RowGroup key={r.id} r={r} today={today} open={open === r.id} toggle={() => setOpen(open === r.id ? null : r.id)} who={who} onChange={onChange} showAge={showAge} />))}</tbody>
    </table></div>
  )
}

function RowGroup({ r, today, open, toggle, who, onChange, showAge }: { r: Receipt; today: string; open: boolean; toggle: () => void; who: string; onChange: () => void; showAge?: boolean }) {
  const age = daysSince(r.received_on, today)
  return (<>
    <tr className={r.status === 'void' ? 'pay-void' : undefined}>
      <td className="mono">{mdy(r.received_on)}{showAge && <div className={'rp-muted' + (age > 1 ? ' warn' : '')}>{age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}</div>}</td>
      <td>{METHOD[r.method]}{r.check_number && <div className="rp-muted">#{r.check_number}</div>}</td>
      <td><div className="strong">{r.payer}</div>{r.insured && r.insured !== r.payer && <div className="rp-muted">{r.insured}</div>}</td>
      <td className="mono">{r.account_number || '—'}{r.carrier && <div className="rp-muted">{r.carrier}</div>}</td>
      <td className="r mono strong">{amt(r.amount)}</td>
      <td><span className={'rp-pill ' + STATUS[r.status].kind}>{STATUS[r.status].label}</span>
        {r.status === 'applied' && <div className="rp-muted">{mdy(r.applied_on!)} · {r.applied_by}</div>}
        {r.status === 'mailed' && <div className="rp-muted">{mdy(r.mailed_on!)} · {r.mailed_by}</div>}</td>
      <td className="r"><button className="linkbtn" onClick={toggle}>{open ? 'Close' : r.status === 'received' ? 'Mail / apply' : 'Details'}</button></td>
    </tr>
    {open && <tr className="pay-open"><td colSpan={7}><Details r={r} today={today} who={who} onChange={onChange} /></td></tr>}
  </>)
}

function Details({ r, today, who, onChange }: { r: Receipt; today: string; who: string; onChange: () => void }) {
  const hist = useAsync(async () => {
    const { data, error } = await supabase.from('payment_receipt_events').select('*').eq('receipt_id', r.id).order('at')
    if (error) throw error
    return data as Event[]
  }, [r.id, r.status, r.scan_path])
  const [ap, setAp] = useState({ on: today, ref: '', note: '' })
  const [ml, setMl] = useState({ on: today, note: 'Mailed with the remittance coupon to the address on the coupon' })
  const [close, setClose] = useState<{ to: 'returned' | 'void'; why: string } | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (f: () => Promise<{ error: { message: string } | null }>) => { setBusy(true); const { error } = await f(); setBusy(false); if (error) alert(error.message); else onChange() }
  const viewScan = async () => { const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(r.scan_path!, 300); if (error) alert(error.message); else window.open(data.signedUrl, '_blank') }
  const attach = async (file: File) => {
    const agency = (await supabase.rpc('current_agency_id')).data as string
    const path = `${agency}/${r.received_on.slice(0, 7)}/${r.id}-${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]+/g, '_')}`
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream' })
    if (up.error) return alert(up.error.message)
    await run(async () => supabase.from('payment_receipts').update({ scan_path: path }).eq('id', r.id))
  }
  return (
    <div className="pay-details">
      <div className="pay-facts">
        {([['Received', `${mdy(r.received_on)} by ${r.received_by}`], ['Method', METHOD[r.method] + (r.check_number ? ` #${r.check_number}` : '')], ['Check date', r.check_date ? mdy(r.check_date) : ''],
          ['Amount', amt(r.amount)], ['Amount due', r.amount_due != null ? amt(r.amount_due) : ''], ['Payer', r.payer], ['Insured', r.insured || ''], ['Account / policy #', r.account_number || ''],
          ['Carrier', r.carrier || ''], ['Note', r.note || ''], ['Mailed', r.mailed_on ? `${mdy(r.mailed_on)} by ${r.mailed_by}${r.mailed_note ? ' · ' + r.mailed_note : ''}` : ''], ['Applied', r.applied_on ? `${mdy(r.applied_on)} by ${r.applied_by}${r.applied_ref ? ' · confirmation ' + r.applied_ref : ''}${r.applied_note ? ' · ' + r.applied_note : ''}` : ''],
          [r.status === 'void' ? 'Voided' : 'Returned', r.closed_reason ? `${r.closed_reason} · ${r.closed_by}` : '']] as [string, string][]).filter(([, v]) => v).map(([k, v]) => (
          <div key={k}><span className="rp-k">{k}</span><div>{v}</div></div>
        ))}
        <div><span className="rp-k">Scan</span><div>{r.scan_path ? <button className="linkbtn" onClick={viewScan}>View the scan</button>
          : <label className="linkbtn" style={{ cursor: 'pointer' }}>Attach the scan<input type="file" accept="application/pdf,image/*" hidden onChange={(e) => e.target.files?.[0] && attach(e.target.files[0])} /></label>}</div></div>
      </div>

      {r.status === 'received' && r.method !== 'cash' && (
        <div className="pay-act">
          <div className="strong">Mark it mailed <span className="rp-muted">— Farmers checks go by mail with the remittance coupon, to the address on the coupon</span></div>
          <div className="form-grid">
            <label>Mailed on<input className="fld" type="date" max={today} min={r.received_on} value={ml.on} onChange={(e) => setMl({ ...ml, on: e.target.value })} /></label>
            <label style={{ gridColumn: 'span 2' }}>Note<input className="fld" value={ml.note} onChange={(e) => setMl({ ...ml, note: e.target.value })} /></label>
          </div>
          <div className="row-actions" style={{ marginTop: 10 }}>
            <button className="btn-primary" disabled={busy || !ml.on} onClick={() => run(async () => supabase.from('payment_receipts').update({ status: 'mailed', mailed_on: ml.on, mailed_by: who, mailed_note: ml.note.trim() || null }).eq('id', r.id))}>Mark mailed</button>
          </div>
        </div>
      )}
      {(r.status === 'received' || r.status === 'mailed') && (
        <div className="pay-act">
          <div className="strong">{r.status === 'mailed' ? 'Confirm it posted to the account' : 'Mark it applied'} <span className="rp-muted">— {r.status === 'mailed' ? 'once the payment shows on the policy' : 'for carriers that let the office apply it'}</span></div>
          <div className="form-grid">
            <label>Applied on<input className="fld" type="date" max={today} min={r.received_on} value={ap.on} onChange={(e) => setAp({ ...ap, on: e.target.value })} /></label>
            <label>Confirmation # <span className="rp-muted">(from the carrier)</span><input className="fld" value={ap.ref} onChange={(e) => setAp({ ...ap, ref: e.target.value })} /></label>
            <label style={{ gridColumn: '1 / -1' }}>Note<input className="fld" value={ap.note} onChange={(e) => setAp({ ...ap, note: e.target.value })} placeholder="e.g. applied in EZLynx / Farmers portal" /></label>
          </div>
          <div className="row-actions" style={{ marginTop: 10 }}>
            <button className="btn-primary" disabled={busy || !ap.on} onClick={() => run(async () => supabase.from('payment_receipts').update({ status: 'applied', applied_on: ap.on, applied_by: who, applied_ref: ap.ref.trim() || null, applied_note: ap.note.trim() || null }).eq('id', r.id))}>Mark applied</button>
            <button className="btn-ghost" onClick={() => setClose({ to: 'returned', why: '' })}>It bounced / was returned</button>
            {r.status === 'received' && <button className="btn-ghost" onClick={() => setClose({ to: 'void', why: '' })}>Void (logged by mistake)</button>}
          </div>
        </div>
      )}
      {r.status === 'applied' && !close && <div className="row-actions"><button className="btn-ghost" onClick={() => setClose({ to: 'returned', why: '' })}>It bounced after it was applied</button></div>}
      {close && (
        <div className="pay-act">
          <div className="strong">{close.to === 'void' ? 'Void this entry' : 'Mark it returned'} — the reason is required and permanent</div>
          <input className="fld" value={close.why} onChange={(e) => setClose({ ...close, why: e.target.value })} placeholder={close.to === 'void' ? 'e.g. duplicate entry; wrong amount — logged again correctly' : 'e.g. NSF — check bounced 10/12'} />
          <div className="row-actions" style={{ marginTop: 10 }}>
            <button className="btn-primary" disabled={busy || !close.why.trim()} onClick={() => run(async () => supabase.from('payment_receipts').update({ status: close.to, closed_reason: close.why.trim(), closed_by: who, closed_at: new Date().toISOString() }).eq('id', r.id))}>{close.to === 'void' ? 'Void it' : 'Mark returned'}</button>
            <button className="btn-ghost" onClick={() => setClose(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="pay-hist">
        <div className="rp-k">History</div>
        {!hist.data ? <Loading what="Loading history" /> : hist.data.map((e) => (
          <div key={e.id} className="pay-ev"><span className="mono rp-muted">{new Date(e.at).toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' })}</span>
            <b>{e.action === 'note' ? 'Note' : e.action[0].toUpperCase() + e.action.slice(1)}</b><span>{e.detail}</span><span className="rp-muted">— {e.by_name}</span></div>
        ))}
        <div className="pay-note">
          <input className="fld" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note to the history (permanent)" />
          <button className="btn-ghost" disabled={busy || !note.trim()} onClick={() => run(async () => { const res = await supabase.from('payment_receipt_events').insert({ receipt_id: r.id, action: 'note', detail: note.trim(), by_name: who }); if (!res.error) setNote(''); return res })}>Add</button>
        </div>
      </div>
    </div>
  )
}

function LogForm({ today, who, onSaved }: { today: string; who: string; onSaved: (month: string) => void }) {
  const blank = { method: 'check' as Method, received_on: today, amount: '', payer: '', insured: '', account_number: '', carrier: 'Farmers', check_number: '', check_date: '', amount_due: '', note: '' }
  const [d, setD] = useState(blank)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof blank, v: string) => setD({ ...d, [k]: v })
  const save = async () => {
    if (!(Number(d.amount) > 0)) return alert('Enter the amount.')
    if (!d.payer.trim()) return alert('Who paid? Enter the name on the check (or the person who paid cash).')
    if (!confirm(`Log ${METHOD[d.method].toLowerCase()} of ${money2(Number(d.amount))} from ${d.payer.trim()}, received ${mdy(d.received_on)}?\n\nThis can't be edited or deleted afterwards.`)) return
    setBusy(true)
    const { data, error } = await supabase.from('payment_receipts').insert({
      received_on: d.received_on, method: d.method, amount: Number(d.amount), payer: d.payer.trim(), insured: d.insured.trim() || null, account_number: d.account_number.trim() || null,
      carrier: d.carrier.trim() || null, check_number: d.method === 'cash' ? null : d.check_number.trim() || null, check_date: d.check_date || null,
      amount_due: d.amount_due ? Number(d.amount_due) : null, note: d.note.trim() || null, received_by: who,
    }).select('id').single()
    if (!error && file && data) {
      const agency = (await supabase.rpc('current_agency_id')).data as string
      const path = `${agency}/${d.received_on.slice(0, 7)}/${data.id}-${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]+/g, '_')}`
      const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream' })
      if (up.error) alert('Saved, but the scan didn’t upload: ' + up.error.message + ' — attach it from the payment’s details.')
      else await supabase.from('payment_receipts').update({ scan_path: path }).eq('id', data.id)
    }
    setBusy(false)
    if (error) alert(error.message); else { setD(blank); setFile(null); onSaved(d.received_on.slice(0, 7)) }
  }
  return (
    <Section title="Log a payment" sub="as soon as it comes in · permanent once saved">
      <div className="rt-add">
        <div className="row-actions" role="group" aria-label="Method" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
          {(Object.keys(METHOD) as Method[]).map((k) => <button key={k} className={d.method === k ? 'btn-primary' : 'btn-ghost'} onClick={() => set('method', k)}>{METHOD[k]}</button>)}
        </div>
        <div className="form-grid">
          <label>Received on<input className="fld" type="date" max={today} value={d.received_on} onChange={(e) => set('received_on', e.target.value || today)} /></label>
          <label>Amount<input className="fld" type="number" min={0} step="0.01" value={d.amount} onChange={(e) => set('amount', e.target.value)} /></label>
          <label>Payer <span className="rp-muted">(name on the check)</span><input className="fld" value={d.payer} onChange={(e) => set('payer', e.target.value)} /></label>
          <label>Insured <span className="rp-muted">(if different)</span><input className="fld" value={d.insured} onChange={(e) => set('insured', e.target.value)} /></label>
          <label>Account / policy #<input className="fld" value={d.account_number} onChange={(e) => set('account_number', e.target.value)} /></label>
          <label>Carrier<input className="fld" value={d.carrier} onChange={(e) => set('carrier', e.target.value)} /></label>
          {d.method !== 'cash' && <label>Check / money order #<input className="fld" value={d.check_number} onChange={(e) => set('check_number', e.target.value)} /></label>}
          {d.method !== 'cash' && <label>Date on the check<input className="fld" type="date" value={d.check_date} onChange={(e) => set('check_date', e.target.value)} /></label>}
          <label>Amount due <span className="rp-muted">(on the bill)</span><input className="fld" type="number" min={0} step="0.01" value={d.amount_due} onChange={(e) => set('amount_due', e.target.value)} /></label>
          <label>Scan of the check / receipt<input className="fld" type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
          <label style={{ gridColumn: '1 / -1' }}>Note<input className="fld" value={d.note} onChange={(e) => set('note', e.target.value)} placeholder="e.g. dropped off at the front desk; partial payment" /></label>
        </div>
        <div className="row-actions" style={{ marginTop: 12 }}><button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Log payment'}</button></div>
        <div className="pay-rule">
          <b>Farmers checks can’t be applied in the office.</b> Mail the check with the remittance coupon to the address on the coupon (or have the customer mail it), then mark it mailed here.
          Need a same-day payment? Use <a href="https://agencynews.farmers.com/content/dam/apex/documents/non-srn/training-nonsrn/SMS_Secure_Pay_Job_Aid.pdf" target="_blank" rel="noreferrer">SMS SecurePay</a>,
          a <a href="https://farmerssrm.my.site.com/AgencyCommunityPortal/apex/KM_CommunityViewPage?id=kAD1L000000fzVnWAI&persona=EA" target="_blank" rel="noreferrer">one-time payment on Farmers.com</a>, or a
          {' '}<a href="https://farmerssrm.my.site.com/AgencyCommunityPortal/articles/Knowledge/Payment-Authorization-Form-Collection" target="_blank" rel="noreferrer">one-time bank withdrawal / automatic payments</a>.
        </div>
      </div>
    </Section>
  )
}
