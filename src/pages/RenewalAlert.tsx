import { useMemo, useState } from 'react'
import { Empty, Search, Tabs } from '../components/ui'
import { daysUntil, type Account, type BookPolicy } from '../lib/books'
import { downloadCsv, mdy, money0 } from '../lib/format'
import { RenewPill } from './Books'
import { DateRange, resolveRange } from '../components/DateRange'
import { addDays } from '../lib/format'

type Win = '30' | '60' | '90' | '365' | 'expired' | 'custom'
const WINS: { key: Win; label: string }[] = [
  { key: '30', label: 'Next 30 days' }, { key: '60', label: 'Next 60 days' }, { key: '90', label: 'Next 90 days' },
  { key: '365', label: 'Next 12 months' }, { key: 'expired', label: 'Past expiration' }, { key: 'custom', label: 'Custom range' },
]

/** Renewals for the book being viewed: an alert bar that states what's coming due and opens the full
 *  renewal list in place (this used to be its own Renewals page). */
export default function RenewalAlert({ bookKey, accounts, policies, today, startOpen, onOpenAccount }: {
  bookKey: string; accounts: Account[]; policies: BookPolicy[]; today: string; startOpen?: boolean; onOpenAccount: (a: Account) => void
}) {
  const [open, setOpen] = useState(!!startOpen)
  const [win, setWin] = useState<Win>('30')
  const [q, setQ] = useState('')
  const [range, setRange] = useState({ from: today, to: addDays(today, 30) })
  const r = resolveRange(range, { from: today, to: addDays(today, 30) })
  const acct = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const dated = useMemo(() => policies.map((p) => ({ p, a: acct.get(p.account_id)!, d: daysUntil(p.expiration, today) })).filter((r) => r.d != null && r.a), [policies, acct, today])
  const due30 = dated.filter((r) => r.d! >= 0 && r.d! <= 30)
  const expired = dated.filter((r) => r.d! < 0)
  const prem = (rs: typeof dated) => rs.reduce((s, r) => s + (r.p.premium || 0), 0)
  const rows = dated
    .filter((x) => (win === 'custom' ? x.p.expiration! >= r.from && x.p.expiration! <= r.to : win === 'expired' ? x.d! < 0 : x.d! >= 0 && x.d! <= Number(win)))
    .filter((r) => !q || `${r.a.name} ${r.p.insured} ${r.p.policy_number} ${r.p.carrier} ${r.p.product}`.toLowerCase().includes(q.toLowerCase()))
    .sort((x, y) => (win === 'expired' ? y.d! - x.d! : x.d! - y.d!))
  const tone = due30.length || expired.length ? 'warn' : 'calm'

  return (
    <section className={'renew-alert renew-' + tone} aria-label="Renewals">
      <div className="renew-bar">
        <span className="renew-ico" aria-hidden="true">{tone === 'warn' ? '!' : '✓'}</span>
        <div className="renew-msg">
          {due30.length
            ? <><b>{due30.length} polic{due30.length === 1 ? 'y renews' : 'ies renew'} in the next 30 days</b> · {money0(prem(due30))} premium</>
            : <b>Nothing renews in the next 30 days</b>}
          {expired.length > 0 && <> · <b>{expired.length} past expiration</b> — confirm renewed or lapsed</>}
        </div>
        <button className="btn-ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide renewals' : 'Review renewals'}</button>
      </div>
      {open && (
        <div className="renew-body">
          <Tabs tabs={WINS} value={win} onChange={setWin} />
          <div className="filters" style={{ marginBottom: 10 }}>
            {win === 'custom' && <DateRange value={range} onChange={setRange} />}
            <Search value={q} onChange={setQ} />
            <button className="btn-ghost" onClick={() => downloadCsv(`renewals-${bookKey}-${win === 'custom' ? r.from + '_' + r.to : win}-${today}.csv`, [
              ['Account', 'Insured', 'Policy #', 'Carrier', 'Line', 'Expiration', 'Days', 'Premium'],
              ...rows.map((r) => [r.a.name, r.p.insured, r.p.policy_number, r.p.carrier, r.p.product, r.p.expiration, r.d, r.p.premium]),
            ])}>Export CSV</button>
            <span className="sub" style={{ alignSelf: 'center' }}>{rows.length} policies · {money0(prem(rows))} premium</span>
          </div>
          {rows.length ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Expires</th><th>Account</th><th>Policy</th><th className="r">Premium</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.p.id} className="clickable" onClick={() => onOpenAccount(r.a)}>
                      <td style={{ whiteSpace: 'nowrap' }}>{mdy(r.p.expiration!)} <RenewPill days={r.d} /></td>
                      <td><div className="strong">{r.a.name}</div>{r.p.insured !== r.a.name && <div className="sub">{r.p.insured}</div>}</td>
                      <td>{r.p.product} · {r.p.carrier}<div className="sub">{r.p.policy_number}</div></td>
                      <td className="r mono">{r.p.premium != null ? money0(r.p.premium) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>Nothing in this window.</Empty>}
        </div>
      )}
    </section>
  )
}
