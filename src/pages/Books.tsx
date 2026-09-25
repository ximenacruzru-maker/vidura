import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Drawer, Empty, ErrorBox, KV, Loading, PageHead, Panel, Search, Tabs, Tile, Tiles } from '../components/ui'
import { BOOKS, bookTab, daysUntil, fmtBytes, getAccounts, getBookPolicies, getDocs, openDoc, type Account, type BookPolicy, type Doc } from '../lib/books'
import { downloadCsv, mdy, money0, money2, todayPacific } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { useAuth } from '../auth'
import { isAdmin } from '../lib/data'
import DocUpload from '../components/DocUpload'
import RenewalAlert from './RenewalAlert'

export function RenewPill({ days }: { days: number | null }) {
  if (days == null) return <span className="pill pill-muted">no date</span>
  if (days < 0) return <span className="pill pill-bad">expired {-days}d ago</span>
  if (days <= 30) return <span className="pill pill-warn">{days}d</span>
  if (days <= 90) return <span className="pill pill-blue">{days}d</span>
  return <span className="pill pill-muted">{days}d</span>
}

export default function Books() {
  const { book = 'farmers' } = useParams()
  const nav = useNavigate()
  const key = bookTab(book)
  const meta = BOOKS.find((b) => b.key === key)!
  const today = todayPacific()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Account | null>(null)
  const [params, setParams] = useSearchParams()
  const { me } = useAuth()
  const [reload, setReload] = useState(0)
  const [renewalsOpen] = useState(() => params.get('renewals') === '1')

  const { data, error } = useAsync(async () => {
    const [accounts, policies, docs] = await Promise.all([getAccounts(key), getBookPolicies(key), getDocs()])
    return { accounts, policies, docs }
  }, [key, reload])

  useEffect(() => {
    const id = params.get('open')
    if (id && data) { const a = data.accounts.find((x) => x.id === id); if (a) setOpen(a); setParams({}, { replace: true }) }
  }, [params, data, setParams])

  const rows = useMemo(() => {
    if (!data) return []
    const byAcct = new Map<string, BookPolicy[]>()
    data.policies.forEach((p) => { const l = byAcct.get(p.account_id) || []; l.push(p); byAcct.set(p.account_id, l) })
    const docCount = new Map<string, number>()
    data.docs.forEach((d) => d.account_id && docCount.set(d.account_id, (docCount.get(d.account_id) || 0) + 1))
    return data.accounts.map((a) => {
      const pols = byAcct.get(a.id) || []
      const upcoming = pols.map((p) => p.expiration).filter((d): d is string => !!d && d >= today).sort()[0] || null
      return {
        a, pols, premium: pols.reduce((s, p) => s + (p.premium || 0), 0), next: upcoming,
        lines: [...new Set(pols.map((p) => p.product).filter(Boolean))].join(', '),
        docs: docCount.get(a.id) || 0,
        text: (a.name + ' ' + (a.dba || '') + ' ' + (a.address || '') + ' ' + pols.map((p) => `${p.policy_number} ${p.carrier} ${p.product} ${p.location}`).join(' ')).toLowerCase(),
      }
    }).sort((x, y) => y.premium - x.premium)
  }, [data, today])

  const shown = q ? rows.filter((r) => r.text.includes(q.toLowerCase())) : rows
  const head = <PageHead kicker="Books of business" title={meta.label} sub={meta.blurb} />
  const tabs = <Tabs tabs={BOOKS.map((b) => ({ key: b.key, label: b.short }))} value={key} onChange={(k) => { setQ(''); nav('/books/' + k) }} />
  if (error) return <>{head}{tabs}<ErrorBox error={error} /></>
  if (!data) return <>{head}{tabs}<Loading /></>

  const total = rows.reduce((s, r) => s + r.premium, 0)
  const pols = data.policies
  const due60 = pols.filter((p) => { const d = daysUntil(p.expiration, today); return d != null && d >= 0 && d <= 60 })
  const expired = pols.filter((p) => { const d = daysUntil(p.expiration, today); return d != null && d < 0 })

  const exportCsv = () => downloadCsv(`${key}-book-${today}.csv`, [
    ['Account', 'DBA', 'Policy #', 'Insured', 'Carrier', 'Line', 'Effective', 'Expiration', 'Premium', 'Status', 'Location'],
    ...shown.flatMap((r) => r.pols.map((p) => [r.a.name, r.a.dba, p.policy_number, p.insured, p.carrier, p.product, p.effective, p.expiration, p.premium, p.status, p.location])),
  ])

  return (
    <>
      {head}
      {tabs}
      <RenewalAlert key={key} bookKey={key} accounts={data.accounts} policies={data.policies} today={today} startOpen={renewalsOpen} onOpenAccount={setOpen} />
      <Tiles>
        <Tile label="Accounts" value={rows.length} sub={`${pols.length} policies`} />
        <Tile label="Annual premium" value={money0(total)} sub={rows.length ? money0(total / rows.length) + ' per account' : ''} />
        <Tile label="Renewing in 60 days" value={due60.length} sub={money0(due60.reduce((s, p) => s + (p.premium || 0), 0)) + ' premium'} tone={due60.length ? 'warn' : undefined} />
        <Tile label="Past expiration" value={expired.length} sub={expired.length ? 'confirm renewed or lapsed' : 'none'} />
      </Tiles>
      <Panel title="Accounts" sub={`${shown.length} of ${rows.length} · click an account for policies, notes and documents`}
        right={<div className="filters"><Search value={q} onChange={setQ} placeholder="Name, policy #, carrier, address" /><button className="btn-ghost" onClick={exportCsv}>Export CSV</button>{isAdmin(me?.role) && <DocUpload onDone={() => setReload((n) => n + 1)} />}</div>}>
        {shown.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Account</th><th>Lines</th><th className="r">Policies</th><th className="r">Premium</th><th>Next renewal</th><th className="r">Docs</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.a.id} className="clickable" onClick={() => setOpen(r.a)}>
                    <td><div className="strong">{r.a.name}</div>{r.a.dba && r.a.dba !== r.a.name && <div className="sub">{r.a.dba}</div>}</td>
                    <td className="sub">{r.lines}</td>
                    <td className="r">{r.pols.length}</td>
                    <td className="r mono">{money0(r.premium)}</td>
                    <td>{r.next ? <>{mdy(r.next)} <RenewPill days={daysUntil(r.next, today)} /></> : <span className="sub">—</span>}</td>
                    <td className="r">{r.docs || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>No accounts match.</Empty>}
      </Panel>
      {open && <AccountDrawer account={open} policies={data.policies.filter((p) => p.account_id === open.id)} docs={data.docs.filter((d) => d.account_id === open.id)} onClose={() => setOpen(null)} />}
    </>
  )
}

const HIDE = new Set(['id', 'insured', 'policyNumber', 'policyNumberFormatted', 'annualPremium', 'inception', 'renewal', 'productType', 'carrier',
  'effective', 'expiration', 'kind', 'coverageType', 'premium', 'termFrom', 'termTo', 'policy', 'start', 'named', 'address', 'locationId', 'locationName', 'locationAddress', 'status'])

function label(k: string) { return k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()) }
function show(v: any): string {
  if (v == null || v === '') return ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.map((x) => (Array.isArray(x) ? x.join(': ') : typeof x === 'object' ? Object.values(x).filter(Boolean).join(' · ') : String(x))).join('\n')
  if (typeof v === 'object') return Object.entries(v).filter(([, x]) => x != null && x !== '').map(([k, x]) => `${label(k)}: ${typeof x === 'object' ? JSON.stringify(x) : x}`).join('\n')
  return String(v)
}

export function AccountDrawer({ account, policies, docs, onClose }: { account: Account; policies: BookPolicy[]; docs: Doc[]; onClose: () => void }) {
  const today = todayPacific()
  const total = policies.reduce((s, p) => s + (p.premium || 0), 0)
  const d = account.data || {}
  return (
    <Drawer open onClose={onClose} title={account.name} sub={[account.dba !== account.name ? account.dba : null, `${policies.length} policies · ${money0(total)}`].filter(Boolean).join(' · ')}>
      <KV rows={[['Contact', account.contact], ['Phone', account.phone], ['Address', account.address], ['Producer', account.producer],
        ['Broker', d.broker], ['AOR', d.aor], ['Household', d.household], ['Source', d.source === 'shannon-transfer' ? 'Shannon book transfer' : d.source]]} />
      {d.wcNote && <div className="note-box">{d.wcNote}</div>}

      <Panel title="Policies">
        {policies.length ? policies.map((p) => {
          const extra = Object.entries(p.data || {}).filter(([k, v]) => !HIDE.has(k) && show(v))
          return (
            <div key={p.id} className="plan">
              <div className="plan-h" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div><b>{p.product || 'Policy'}</b> · {p.carrier} {p.policy_number && <span className="sub">#{p.policy_number}</span>}</div>
                <div><b className="mono">{p.premium != null ? money2(p.premium) : '—'}</b> {p.status && <span className="pill pill-muted">{p.status}</span>}</div>
              </div>
              <KV rows={[['Insured', p.insured], ['Location', p.location], ['Effective', p.effective ? mdy(p.effective) : ''],
                ['Expiration', p.expiration ? <>{mdy(p.expiration)} <RenewPill days={daysUntil(p.expiration, today)} /></> : '']]} />
              {extra.length > 0 && (
                <details><summary className="linkbtn">More detail ({extra.length})</summary>
                  <KV rows={extra.map(([k, v]) => [label(k), <span style={{ whiteSpace: 'pre-wrap' }}>{show(v)}</span>])} />
                </details>
              )}
            </div>
          )
        }) : <Empty>No policies on file.</Empty>}
      </Panel>

      <Panel title="Documents">
        <DocList docs={docs} empty="No documents filed for this account yet." />
      </Panel>
    </Drawer>
  )
}

export function DocList({ docs, empty }: { docs: Doc[]; empty: string }) {
  if (!docs.length) return <Empty>{empty}</Empty>
  return (
    <table className="tbl">
      <tbody>
        {docs.map((d) => (
          <tr key={d.id}>
            <td><div className="strong">{d.title}</div><div className="sub">{d.file_name} {fmtBytes(d.size_bytes)}</div></td>
            <td className="r">
              {d.uploaded ? (
                <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                  <button className="linkbtn" onClick={() => openDoc(d)}>View</button>
                  <button className="linkbtn" onClick={() => openDoc(d, true)}>Download</button>
                </div>
              ) : <span className="pill pill-muted">importing…</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
