import { useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { Empty, ErrorBox, Loading, PageHead, Panel, Tile, Tiles } from '../components/ui'
import { getSdrPeriods, getSdrTransfers, type SdrPeriod } from '../lib/data'
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

  const qb = Number(period?.qualified_transfer_bonus) || 0, bb = Number(period?.bound_policy_bonus) || 0
  const rows = transfers.data || []
  const qualified = rows.filter((t) => t.az_qualifies).length, bound = rows.filter((t) => t.bound).length
  const bonus = qualified * qb + bound * bb
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
        sub={period ? `$${qb} per qualified transfer · $${bb} per bound policy · paid on ${mdy(period.pay_date)}` : ''}
        right={<div className="filters"><select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
          {months.map((p) => <option key={p.month} value={p.month}>{monthLabel(p.month)}{p.month === thisMonth ? ' (this month)' : ''}</option>)}
        </select></div>}>
        {err ? <ErrorBox error={err} /> : !transfers.data || !periods.data ? <Loading what="Adding up your month" /> : (
          <Tiles>
            <Tile label={live ? 'Bonus so far' : 'Bonus earned'} value={money2(bonus)} sub={pace != null ? `on pace for ${money0(pace)} this month` : period?.closed ? 'month closed' : `paid ${mdy(period?.pay_date || '')}`} tone="good" />
            <Tile label="Transfers" value={rows.length} sub={live ? `${dayNow} of ${days} days in` : `${days} days`} />
            <Tile label="Qualified" value={qualified} sub={`${rate}% of transfers · ${money0(qualified * qb)}`} tone={qualified ? 'good' : undefined} />
            <Tile label="Bound" value={bound} sub={money0(bound * bb)} tone={bound ? 'good' : undefined} />
          </Tiles>
        )}
      </Panel>

      {transfers.data && (
        <Panel title="My transfers" sub="A transfer qualifies once AgencyZoom shows a real quote on it; bound once the policy is sold.">
          {rows.length ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Transferred</th><th>Client</th><th>Producer</th><th>Status</th><th className="r">Quoted</th><th>Qualifies</th><th>Bound</th><th className="r">Earned</th></tr></thead>
                <tbody>{rows.map((t) => (
                  <tr key={t.lead_id}><td>{mdy(String(t.date_time).slice(0, 10))}</td><td>{t.client}</td><td>{t.producer}</td><td>{t.status}</td>
                    <td className="r mono">{t.az_quote_premium ? money2(t.az_quote_premium) : '—'}</td>
                    <td><span className={'pill ' + (t.az_qualifies ? 'pill-good' : 'pill-muted')}>{t.az_qualifies ? 'Yes' : 'Not yet'}</span></td>
                    <td>{t.bound ? <span className="pill pill-good">Bound</span> : ''}</td>
                    <td className="r mono">{money0((t.az_qualifies ? qb : 0) + (t.bound ? bb : 0))}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : <Empty>No transfers credited to you in {monthLabel(month)} yet.</Empty>}
        </Panel>
      )}
    </>
  )
}
