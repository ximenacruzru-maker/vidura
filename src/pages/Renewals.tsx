import { useMemo, useState } from 'react'
import { Empty, ErrorBox, Loading, PageHead, Panel, Search, Tabs, Tile, Tiles } from '../components/ui'
import { bookLabel, bookTab, BOOKS, daysUntil, getAccounts, getBookPolicies, getDocs, type Account } from '../lib/books'
import { downloadCsv, mdy, money0, todayPacific } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { AccountDrawer, RenewPill } from './Books'

type Win = '30' | '60' | '90' | '365' | 'expired'
const WINS: { key: Win; label: string }[] = [
  { key: '30', label: 'Next 30 days' }, { key: '60', label: 'Next 60 days' }, { key: '90', label: 'Next 90 days' },
  { key: '365', label: 'Next 12 months' }, { key: 'expired', label: 'Past expiration' },
]

export default function Renewals() {
  const today = todayPacific()
  const [win, setWin] = useState<Win>('60')
  const [book, setBook] = useState('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Account | null>(null)
  const { data, error } = useAsync(async () => {
    const [accounts, policies, docs] = await Promise.all([getAccounts(), getBookPolicies(), getDocs()])
    return { accounts, policies, docs }
  }, [])

  const rows = useMemo(() => {
    if (!data) return []
    const acct = new Map(data.accounts.map((a) => [a.id, a]))
    return data.policies
      .map((p) => ({ p, a: acct.get(p.account_id)!, d: daysUntil(p.expiration, today) }))
      .filter((r) => r.d != null && (win === 'expired' ? r.d < 0 : r.d >= 0 && r.d <= Number(win)))
      .filter((r) => book === 'all' || bookTab(r.p.book) === book)
      .filter((r) => !q || `${r.a?.name} ${r.p.insured} ${r.p.policy_number} ${r.p.carrier} ${r.p.product}`.toLowerCase().includes(q.toLowerCase()))
      .sort((x, y) => (win === 'expired' ? y.d! - x.d! : x.d! - y.d!))
  }, [data, win, book, q, today])

  const head = <PageHead kicker="Books of business" title="Renewals" sub="Every policy across all four books, by expiration date." />
  if (error) return <>{head}<ErrorBox error={error} /></>
  if (!data) return <>{head}<Loading /></>
  const prem = rows.reduce((s, r) => s + (r.p.premium || 0), 0)
  const undated = data.policies.filter((p) => !p.expiration).length

  return (
    <>
      {head}
      <Tabs tabs={WINS} value={win} onChange={setWin} />
      <Tiles>
        <Tile label="Policies" value={rows.length} sub={WINS.find((w) => w.key === win)!.label} />
        <Tile label="Premium at stake" value={money0(prem)} />
        <Tile label="Accounts" value={new Set(rows.map((r) => r.p.account_id)).size} />
        <Tile label="No date on file" value={undated} sub="policies missing an expiration" />
      </Tiles>
      <Panel title="Renewal list" right={
        <div className="filters">
          <select value={book} onChange={(e) => setBook(e.target.value)}>
            <option value="all">All books</option>
            {BOOKS.map((b) => <option key={b.key} value={b.key}>{b.short}</option>)}
          </select>
          <Search value={q} onChange={setQ} />
          <button className="btn-ghost" onClick={() => downloadCsv(`renewals-${win}-${today}.csv`, [
            ['Book', 'Account', 'Insured', 'Policy #', 'Carrier', 'Line', 'Expiration', 'Days', 'Premium'],
            ...rows.map((r) => [bookLabel(r.p.book), r.a?.name, r.p.insured, r.p.policy_number, r.p.carrier, r.p.product, r.p.expiration, r.d, r.p.premium]),
          ])}>Export CSV</button>
        </div>}>
        {rows.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Expires</th><th>Account</th><th>Policy</th><th>Book</th><th className="r">Premium</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.p.id} className="clickable" onClick={() => setOpen(r.a)}>
                    <td style={{ whiteSpace: 'nowrap' }}>{mdy(r.p.expiration!)} <RenewPill days={r.d} /></td>
                    <td><div className="strong">{r.a?.name}</div>{r.p.insured !== r.a?.name && <div className="sub">{r.p.insured}</div>}</td>
                    <td>{r.p.product} · {r.p.carrier}<div className="sub">{r.p.policy_number}</div></td>
                    <td className="sub">{bookLabel(r.p.book)}</td>
                    <td className="r mono">{r.p.premium != null ? money0(r.p.premium) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>Nothing in this window.</Empty>}
      </Panel>
      {open && <AccountDrawer account={open} policies={data.policies.filter((p) => p.account_id === open.id)} docs={data.docs.filter((d) => d.account_id === open.id)} onClose={() => setOpen(null)} />}
    </>
  )
}
