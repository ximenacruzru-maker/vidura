import { useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { Empty, ErrorBox, Loading, PageHead, Panel, Tile, Tiles } from '../components/ui'
import { getSdrPeriods, getSdrQuoteNumbers, getSdrTransfers, saveSdrQuoteNumber, type SdrPeriod, type SdrQuoteNumber, type SdrTransfer } from '../lib/data'
import { mdy, money0, money2, todayPacific } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { useSyncStamp } from '../lib/syncEvents'

/** My Commissions: an SDR's month — their transfers, how many qualified and bound, and the bonus that adds up to —
 *  opening on the month in progress, with a picker for earlier months. My Pay shows what lands on each payday;
 *  this is how the month is going. Only the SDR's own transfers are shown (the database returns no one else's). */

const monthLabel = (m: string) => new Date(m + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const nextMonth21 = (m: string) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01-21` : `${y}-${String(mo + 1).padStart(2, '0')}-21` }

export default function MyCommissions() {
  const { me } = useAuth()
  const names = useMemo(() => new Set([me?.display_name, me?.producer_name].filter(Boolean).flatMap((n) => [n!.trim().toLowerCase(), n!.trim().split(/\s+/)[0].toLowerCase()])), [me])
  const today = todayPacific(), thisMonth = today.slice(0, 7)
  const [month, setMonth] = useState(thisMonth)
  const synced = useSyncStamp()
  const periods = useAsync(getSdrPeriods, [])
  // every SDR month on file, plus the month in progress even before it is set up (priced at the latest rates)
  const months = useMemo(() => {
    const list = [...(periods.data || [])]
    if (!list.some((p) => p.month === thisMonth)) {
      const last = list[0]
      list.unshift({ month: thisMonth, pay_date: nextMonth21(thisMonth), period_label: monthLabel(thisMonth), closed: false,
        qualified_transfer_bonus: last ? last.qualified_transfer_bonus : 0, bound_policy_bonus: last ? last.bound_policy_bonus : 0 } as SdrPeriod)
    }
    return list.filter((p) => p.month <= thisMonth).sort((a, b) => b.month.localeCompare(a.month))
  }, [periods.data, thisMonth])
  const period = months.find((p) => p.month === month)
  const transfers = useAsync(async () => (await getSdrTransfers(month)).filter((t) => names.has(String(t.sdr || '').trim().toLowerCase())), [month, names, synced])
  const [saved, setSaved] = useState(0)
  const quotes = useAsync(() => getSdrQuoteNumbers(month), [month, saved])

  const qb = Number(period?.qualified_transfer_bonus) || 0, bb = Number(period?.bound_policy_bonus) || 0
  const rows = transfers.data || []
  // a bound transfer earns the bound bonus in place of the qualified one ($35 total, not $15 + $35)
  const qualified = rows.filter((t) => t.az_qualifies).length, bound = rows.filter((t) => t.bound).length
  const qOnly = rows.filter((t) => t.az_qualifies && !t.bound).length
  const bonus = qOnly * qb + bound * bb
  // pace for the month in progress: what the month comes to if the rest of it goes like the days so far
  const [y, mo] = month.split('-').map(Number)
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  const live = month === thisMonth, dayNow = live ? Number(today.slice(8, 10)) : days
  const pace = live && dayNow < days ? Math.round((bonus / dayNow) * days) : null
  const rate = rows.length ? Math.round((qualified / rows.length) * 100) : 0

  const err = periods.error || transfers.error
  return (
    <>
      <PageHead kicker="Workspace" title="My Commissions" sub="How your month is going: your transfers, how many qualified and bound, and the bonus they add up to." />
      <Panel title={monthLabel(month) + (live ? ' · in progress' : '')}
        sub={period ? `$${qb} per qualified transfer · $${bb} total per bound policy · paid on ${mdy(period.pay_date)}` : ''}
        right={<div className="filters"><select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
          {months.map((p) => <option key={p.month} value={p.month}>{monthLabel(p.month)}{p.month === thisMonth ? ' (this month)' : ''}</option>)}
        </select></div>}>
        {err ? <ErrorBox error={err} /> : !transfers.data || !periods.data ? <Loading what="Adding up your month" /> : (
          <Tiles>
            <Tile label={live ? 'Bonus so far' : 'Bonus earned'} value={money2(bonus)} sub={pace != null ? `on pace for ${money0(pace)} this month` : period?.closed ? 'month closed' : `paid ${mdy(period?.pay_date || '')}`} tone="good" />
            <Tile label="Transfers" value={rows.length} sub={live ? `${dayNow} of ${days} days in` : `${days} days`} />
            <Tile label="Qualified" value={qualified} sub={`${rate}% of transfers · ${money0(qOnly * qb)} not yet bound`} tone={qualified ? 'good' : undefined} />
            <Tile label="Bound" value={bound} sub={`${money0(bb)} earned on bound · ${money0(bound * bb)}`} tone={bound ? 'good' : undefined} />
          </Tiles>
        )}
      </Panel>

      {transfers.data && quotes.data && <ApexQuotes rows={rows} quotes={quotes.data} closed={!!period?.closed} onSaved={() => setSaved((n) => n + 1)} />}
      {quotes.error && <ErrorBox error={quotes.error} />}

      {/* bound policies, front and center: each one earns the bound bonus */}
      {transfers.data && (
        <section className="panel sdr-bound">
          <div className="sdr-bound-h">
            <div>
              <div className="sdr-bound-k">Bound policies · {monthLabel(month)}</div>
              <div className="sdr-bound-n">{bound}<span> bound</span></div>
              <div className="sdr-bound-earn">{money0(bb)} earned on bound</div>
            </div>
            <div className="sdr-bound-total"><div className="sdr-bound-k">Earned on bound</div><div className="sdr-bound-amt">{money0(bound * bb)}</div></div>
          </div>
          {bound ? (
            <div className="sdr-bound-list">{rows.filter((t) => t.bound).map((t) => (
              <div key={t.lead_id} className="sdr-bound-row">
                <span className="pill pill-good">Bound</span>
                <div className="sdr-bound-c"><div className="strong">{t.client}</div><div className="sub">{mdy(String(t.date_time).slice(0, 10))}{t.producer ? ` · ${t.producer}` : ''}</div></div>
                <div className="sdr-bound-plus">+{money0(bb)} earned on bound</div>
              </div>
            ))}</div>
          ) : <div className="sub">No bound policies yet this month — every transfer that binds earns {money0(bb)}.</div>}
        </section>
      )}

      {transfers.data && (
        <Panel title="My transfers" sub="A transfer qualifies once AgencyZoom shows a real quote on it; bound once the policy is sold.">
          {rows.length ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Transferred</th><th>Client</th><th>Producer</th><th>Status</th><th>Apex quote #</th><th className="r">Quoted</th><th>Qualifies</th><th>Bound</th><th className="r">Earned</th></tr></thead>
                <tbody>{rows.map((t) => (
                  <tr key={t.lead_id} className={t.bound ? 'row-bound' : undefined}><td>{mdy(String(t.date_time).slice(0, 10))}</td><td>{t.client}</td><td>{t.producer}</td><td>{t.status}</td>
                    <td className="mono">{quotes.data?.get(t.lead_id)?.quote_number || <span className="pill pill-warn">Needed</span>}</td>
                    <td className="r mono">{t.az_quote_premium ? money2(t.az_quote_premium) : '—'}</td>
                    <td><span className={'pill ' + (t.az_qualifies ? 'pill-good' : 'pill-muted')}>{t.az_qualifies ? 'Yes' : 'Not yet'}</span></td>
                    <td>{t.bound ? <span className="pill pill-good">Bound · {money0(bb)} earned</span> : ''}</td>
                    <td className="r mono">{money0(t.bound ? bb : t.az_qualifies ? qb : 0)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : <Empty>No transfers credited to you in {monthLabel(month)} yet.</Empty>}
        </Panel>
      )}
    </>
  )
}

/** Apex quote numbers: required for every transfer, so admins can match each bonus to its quote when they reconcile
 *  payroll. The SDR types the number next to each transfer; once the month is closed only an admin can change it. */
function ApexQuotes({ rows, quotes, closed, onSaved }: { rows: SdrTransfer[]; quotes: Map<string, SdrQuoteNumber>; closed: boolean; onSaved: () => void }) {
  const missing = rows.filter((t) => !quotes.get(t.lead_id)).length
  return (
    <Panel title="Apex quote numbers" sub="Required — you’re responsible for adding the Apex quote # for every transfer you send. Admins match each one to your bonus on the payroll sheet, so a missing number holds up the reconciliation."
      right={rows.length ? <span className={'pill ' + (missing ? 'pill-warn' : 'pill-good')}>{missing ? `${missing} of ${rows.length} still needed` : 'All entered'}</span> : undefined}>
      {rows.length ? (
        <div className="apex-list">{rows.map((t) => <ApexRow key={t.lead_id} t={t} q={quotes.get(t.lead_id)} closed={closed} onSaved={onSaved} />)}</div>
      ) : <Empty>No transfers yet this month.</Empty>}
    </Panel>
  )
}

function ApexRow({ t, q, closed, onSaved }: { t: SdrTransfer; q?: SdrQuoteNumber; closed: boolean; onSaved: () => void }) {
  const [v, setV] = useState(q?.quote_number || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const dirty = v.trim() !== (q?.quote_number || '')
  const save = async () => {
    if (!v.trim()) return setErr('Enter the Apex quote #.')
    setBusy(true); setErr('')
    try { await saveSdrQuoteNumber(t.lead_id, v); onSaved() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <div className={'apex-row' + (q ? '' : ' apex-missing')}>
      <div className="apex-c"><div className="strong">{t.client}</div><div className="sub">{mdy(String(t.date_time).slice(0, 10))}{t.producer ? ` · ${t.producer}` : ''}</div></div>
      <form className="apex-f" onSubmit={(e) => { e.preventDefault(); save() }}>
        <input className="fld mono" value={v} onChange={(e) => setV(e.target.value)} placeholder="Apex quote #" aria-label={`Apex quote # for ${t.client}`} maxLength={40} disabled={closed || busy} required />
        {!closed && <button className="btn-primary" disabled={busy || !dirty}>{busy ? 'Saving…' : q ? 'Update' : 'Save'}</button>}
      </form>
      <div className="apex-s">{err ? <span className="apex-err">{err}</span> : q ? <span className="pill pill-good">Saved</span> : <span className="pill pill-warn">Needed</span>}</div>
    </div>
  )
}
