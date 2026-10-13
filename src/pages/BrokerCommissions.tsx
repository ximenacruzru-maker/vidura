import { Fragment, useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { GoalCard, Section } from '../components/Report'
import { ErrorBox, Loading } from '../components/ui'
import { mdy, money2, todayPacific } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

/** Broker commissions: commission payments brokers, wholesalers and brokered carriers pay the agency — by month, with
 *  anything not yet deposited up top. Permanent like client payments: no deletes, no edits to what was received; a
 *  mistake is voided with a reason, and every step is kept in the history. */

interface Commission {
  id: number; received_on: string; broker: string; method: Method; amount: number; period: string | null; reference: string | null
  clients: string | null; note: string | null; received_by: string; status: 'received' | 'deposited' | 'void'
  deposited_on: string | null; deposited_by: string | null; deposited_ref: string | null; closed_reason: string | null; closed_by: string | null
}
interface Event { id: number; at: string; by_name: string | null; action: string; detail: string | null }
type Method = 'check' | 'ach' | 'wire' | 'card' | 'other'
const METHOD: Record<Method, string> = { check: 'Check', ach: 'ACH / direct deposit', wire: 'Wire', card: 'Card', other: 'Other' }
const STATUS: Record<Commission['status'], { label: string; kind: string }> = {
  received: { label: 'Not deposited', kind: 'k-warn' }, deposited: { label: 'Deposited', kind: 'k-save' }, void: { label: 'Void', kind: 'k-review' },
}
const monthLabel = (m: string) => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const amt = (n: number | null | undefined) => money2(Number(n) || 0)

export default function BrokerCommissions({ month, setMonth, months }: { month: string; setMonth: (m: string) => void; months: string[] }) {
  const { me } = useAuth()
  const today = todayPacific(), who = me?.display_name || 'Staff'
  const [reload, setReload] = useState(0)
  const bump = () => setReload((n) => n + 1)
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const data = useAsync(async () => {
    const from = month + '-01', [y, m] = month.split('-').map(Number), to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    const [inMonth, waiting] = await Promise.all([
      supabase.from('broker_commissions').select('*').gte('received_on', from).lte('received_on', to).order('received_on', { ascending: false }).order('id', { ascending: false })
        .then((r) => { if (r.error) throw r.error; return r.data as Commission[] }),
      supabase.from('broker_commissions').select('*').eq('status', 'received').order('received_on').then((r) => { if (r.error) throw r.error; return r.data as Commission[] }),
    ])
    return { inMonth, waiting }
  }, [month, reload])
  const byBroker = useMemo(() => {
    const t: Record<string, number> = {}
    for (const c of data.data?.inMonth || []) if (c.status !== 'void') t[c.broker] = (t[c.broker] || 0) + Number(c.amount)
    return Object.entries(t).sort((a, b) => b[1] - a[1])
  }, [data.data])

  if (data.error) return <ErrorBox error={data.error} />
  if (!data.data) return <Loading what="Loading broker commissions" />
  const live = data.data.inMonth.filter((c) => c.status !== 'void'), waiting = data.data.waiting
  const sum = (l: Commission[]) => l.reduce((a, c) => a + Number(c.amount), 0)
  const csv = () => {
    const q = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
    const head = ['Received', 'Broker / payer', 'Method', 'Amount', 'Statement period', 'Reference #', 'Clients / policies', 'Accepted by', 'Status', 'Deposited on', 'Deposited by', 'Deposit ref', 'Void reason', 'Note']
    const rows = data.data!.inMonth.map((c) => [mdy(c.received_on), c.broker, METHOD[c.method], Number(c.amount).toFixed(2), c.period, c.reference, c.clients, c.received_by, STATUS[c.status].label,
      c.deposited_on ? mdy(c.deposited_on) : '', c.deposited_by, c.deposited_ref, c.closed_reason, c.note])
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([[head, ...rows].map((l) => l.map(q).join(',')).join('\n')], { type: 'text/csv' }))
    a.download = `Broker_Commissions_${month}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 500)
  }
  return (<>
    <div className="row-actions pay-tabbar">
      <select className="fld" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
      <button className="btn-ghost" onClick={csv}>Download month (CSV)</button>
      <button className={adding ? 'btn-ghost' : 'btn-primary'} onClick={() => setAdding(!adding)}>{adding ? 'Close' : '+ Log a commission payment'}</button>
    </div>
    {adding && <LogForm today={today} who={who} onSaved={(m) => { setAdding(false); setMonth(m); bump() }} />}
    <div className="rp-cards">
      <GoalCard label={`Received · ${monthLabel(month)}`} show={amt(sum(live))} note={`${live.length} payment${live.length === 1 ? '' : 's'} from ${byBroker.length} broker${byBroker.length === 1 ? '' : 's'}`} good={false} neutral />
      <GoalCard label={`Deposited · ${monthLabel(month)}`} show={amt(sum(live.filter((c) => c.status === 'deposited')))} note={`${live.filter((c) => c.status === 'deposited').length} of ${live.length}`} good={live.length > 0 && live.every((c) => c.status === 'deposited')} pct={live.length ? live.filter((c) => c.status === 'deposited').length / live.length : 0} />
      <GoalCard label="Not deposited · any month" show={amt(sum(waiting))} note={waiting.length ? `${waiting.length} waiting` : 'all deposited'} good={!waiting.length} />
      <GoalCard label="Top broker this month" show={byBroker[0]?.[0] || '—'} note={byBroker[0] ? amt(byBroker[0][1]) : 'nothing yet'} good={false} neutral />
    </div>
    {waiting.length > 0 && <Section title="Not deposited yet" sub="every month"><Table rows={waiting} open={open} setOpen={setOpen} who={who} today={today} onChange={bump} /></Section>}
    <Section title={monthLabel(month)} sub={`${data.data.inMonth.length} logged · by the day received`}>
      {data.data.inMonth.length ? <Table rows={data.data.inMonth} open={open} setOpen={setOpen} who={who} today={today} onChange={bump} /> : <div className="rp-empty">No broker commissions logged for {monthLabel(month)}.</div>}
    </Section>
    {byBroker.length > 0 && (
      <Section title="By broker" sub={monthLabel(month)}>
        <div className="tbl-wrap"><table className="rp-tbl"><thead><tr><th>Broker / payer</th><th className="r">Received</th></tr></thead>
          <tbody>{byBroker.map(([b, v]) => <tr key={b}><td className="strong">{b}</td><td className="r mono">{amt(v)}</td></tr>)}</tbody></table></div>
      </Section>
    )}
    <div className="rp-muted" style={{ marginTop: 14 }}>Commission records can’t be deleted or edited — not by anyone. If something was logged wrong, void it with the reason and log it again.</div>
  </>)
}

function Table({ rows, open, setOpen, who, today, onChange }: { rows: Commission[]; open: number | null; setOpen: (n: number | null) => void; who: string; today: string; onChange: () => void }) {
  return (
    <div className="tbl-wrap"><table className="rp-tbl pay-tbl">
      <thead><tr><th>Received</th><th>Broker / payer</th><th>Method</th><th>Period</th><th className="r">Amount</th><th>Status</th><th /></tr></thead>
      <tbody>{rows.map((c) => (<Fragment key={c.id}>
        <tr className={c.status === 'void' ? 'pay-void' : undefined}>
          <td className="mono">{mdy(c.received_on)}<div className="rp-muted">accepted by {c.received_by}</div></td>
          <td><div className="strong">{c.broker}</div>{c.note && <div className="rp-muted">{c.note}</div>}</td>
          <td>{METHOD[c.method]}{c.reference && <div className="rp-muted">#{c.reference}</div>}</td>
          <td>{c.period || '—'}</td>
          <td className="r mono strong">{amt(c.amount)}</td>
          <td><span className={'rp-pill ' + STATUS[c.status].kind}>{STATUS[c.status].label}</span>{c.status === 'deposited' && <div className="rp-muted">{mdy(c.deposited_on!)} · {c.deposited_by}</div>}</td>
          <td className="r"><button className="linkbtn" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Close' : c.status === 'received' ? 'Deposit / details' : 'Details'}</button></td>
        </tr>
        {open === c.id && <tr className="pay-open"><td colSpan={7}><Details c={c} who={who} today={today} onChange={onChange} /></td></tr>}
      </Fragment>))}</tbody>
    </table></div>
  )
}

function Details({ c, who, today, onChange }: { c: Commission; who: string; today: string; onChange: () => void }) {
  const hist = useAsync(async () => {
    const { data, error } = await supabase.from('broker_commission_events').select('*').eq('commission_id', c.id).order('at')
    if (error) throw error
    return data as Event[]
  }, [c.id, c.status])
  const [dp, setDp] = useState({ on: today, ref: '' })
  const [why, setWhy] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (f: () => PromiseLike<{ error: { message: string } | null }>) => { setBusy(true); const { error } = await f(); setBusy(false); if (error) alert(error.message); else onChange() }
  return (
    <div className="pay-details">
      <div className="pay-facts">
        {([['Received', mdy(c.received_on)], ['Accepted by', c.received_by], ['Broker / payer', c.broker], ['Method', METHOD[c.method]], ['Amount', amt(c.amount)],
          ['Statement period', c.period || ''], ['Reference #', c.reference || ''], ['Clients / policies', c.clients || ''], ['Note', c.note || ''],
          ['Deposited', c.deposited_on ? `${mdy(c.deposited_on)} by ${c.deposited_by}${c.deposited_ref ? ' · ' + c.deposited_ref : ''}` : ''],
          ['Voided', c.closed_reason ? `${c.closed_reason} · ${c.closed_by}` : '']] as [string, string][]).filter(([, v]) => v).map(([k, v]) => <div key={k}><span className="rp-k">{k}</span><div>{v}</div></div>)}
      </div>
      {c.status === 'received' && why == null && (
        <div className="pay-act">
          <div className="strong">Mark it deposited</div>
          <div className="form-grid">
            <label>Deposited on<input className="fld" type="date" max={today} min={c.received_on} value={dp.on} onChange={(e) => setDp({ ...dp, on: e.target.value })} /></label>
            <label style={{ gridColumn: 'span 2' }}>Deposit slip / reference #<input className="fld" value={dp.ref} onChange={(e) => setDp({ ...dp, ref: e.target.value })} /></label>
          </div>
          <div className="row-actions" style={{ marginTop: 10 }}>
            <button className="btn-primary" disabled={busy || !dp.on} onClick={() => run(() => supabase.from('broker_commissions').update({ status: 'deposited', deposited_on: dp.on, deposited_by: who, deposited_ref: dp.ref.trim() || null }).eq('id', c.id))}>Mark deposited</button>
            <button className="btn-ghost" onClick={() => setWhy('')}>Void (logged by mistake)</button>
          </div>
        </div>
      )}
      {why != null && (
        <div className="pay-act">
          <div className="strong">Void this entry — the reason is required and permanent</div>
          <input className="fld" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. duplicate entry; wrong amount — logged again correctly" />
          <div className="row-actions" style={{ marginTop: 10 }}>
            <button className="btn-primary" disabled={busy || !why.trim()} onClick={() => run(() => supabase.from('broker_commissions').update({ status: 'void', closed_reason: why.trim(), closed_by: who, closed_at: new Date().toISOString() }).eq('id', c.id))}>Void it</button>
            <button className="btn-ghost" onClick={() => setWhy(null)}>Cancel</button>
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
          <button className="btn-ghost" disabled={busy || !note.trim()} onClick={() => run(async () => { const res = await supabase.from('broker_commission_events').insert({ commission_id: c.id, action: 'note', detail: note.trim(), by_name: who }); if (!res.error) setNote(''); return res })}>Add</button>
        </div>
      </div>
    </div>
  )
}

function LogForm({ today, who, onSaved }: { today: string; who: string; onSaved: (month: string) => void }) {
  const staff = useAsync(async () => {
    const { data } = await supabase.from('staff_directory').select('display_name')
    return [...new Set(((data || []) as { display_name: string | null }[]).map((p) => p.display_name).filter(Boolean) as string[])].sort()
  }, [])
  const blank = { received_on: today, broker: '', method: 'check' as Method, amount: '', period: '', reference: '', clients: '', note: '', accepted_by: who }
  const [d, setD] = useState(blank)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof blank, v: string) => setD({ ...d, [k]: v })
  const save = async () => {
    if (!d.broker.trim()) return alert('Which broker or carrier paid it?')
    if (!(Number(d.amount) > 0)) return alert('Enter the amount.')
    if (!confirm(`Log ${money2(Number(d.amount))} from ${d.broker.trim()} (${METHOD[d.method]}), received ${mdy(d.received_on)}, accepted by ${d.accepted_by}?\n\nThis can't be edited or deleted afterwards.`)) return
    setBusy(true)
    const { error } = await supabase.from('broker_commissions').insert({ received_on: d.received_on, broker: d.broker.trim(), method: d.method, amount: Number(d.amount), period: d.period.trim() || null,
      reference: d.reference.trim() || null, clients: d.clients.trim() || null, note: d.note.trim() || null, received_by: d.accepted_by })
    setBusy(false)
    if (error) alert(error.message); else onSaved(d.received_on.slice(0, 7))
  }
  return (
    <Section title="Log a commission payment" sub="a broker, wholesaler or brokered carrier paying the agency · permanent once saved">
      <div className="rt-add">
        <div className="row-actions" role="group" aria-label="Method" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
          {(Object.keys(METHOD) as Method[]).map((k) => <button key={k} className={d.method === k ? 'btn-primary' : 'btn-ghost'} onClick={() => set('method', k)}>{METHOD[k]}</button>)}
        </div>
        <div className="form-grid">
          <label>Received on<input className="fld" type="date" max={today} value={d.received_on} onChange={(e) => set('received_on', e.target.value || today)} /></label>
          <label>Broker / payer<input className="fld" value={d.broker} onChange={(e) => set('broker', e.target.value)} placeholder="e.g. a wholesaler or brokered carrier" /></label>
          <label>Amount<input className="fld" type="number" min={0} step="0.01" value={d.amount} onChange={(e) => set('amount', e.target.value)} /></label>
          <label>Accepted by<select className="fld" value={d.accepted_by} onChange={(e) => set('accepted_by', e.target.value)}>{[...new Set([who, ...(staff.data || [])])].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <label>Statement period<input className="fld" value={d.period} onChange={(e) => set('period', e.target.value)} placeholder="e.g. September 2026" /></label>
          <label>Check / reference #<input className="fld" value={d.reference} onChange={(e) => set('reference', e.target.value)} /></label>
          <label style={{ gridColumn: '1 / -1' }}>Clients / policies <span className="rp-muted">(optional)</span><input className="fld" value={d.clients} onChange={(e) => set('clients', e.target.value)} /></label>
          <label style={{ gridColumn: '1 / -1' }}>Note<input className="fld" value={d.note} onChange={(e) => set('note', e.target.value)} /></label>
        </div>
        <div className="row-actions" style={{ marginTop: 12 }}><button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Log commission payment'}</button></div>
      </div>
    </Section>
  )
}
