import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Drawer, Empty, ErrorBox, KV, Loading, MoreMenu, PageHead, Panel, Search, Tabs, Tile, Tiles } from '../components/ui'
import { BOOKS, bookLabel, bookTab, daysUntil, fmtBytes, getAccounts, getBookPolicies, getDocs, openDoc, type Account, type BookPolicy, type Doc } from '../lib/books'
import { issuedAt, mdy, money0, money2, todayPacific } from '../lib/format'
import { downloadSheet } from '../lib/excelExport'
import { useAsync } from '../lib/useAsync'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth'
import { isAdmin } from '../lib/data'
import DocUpload from '../components/DocUpload'
import LoginCreds from '../components/LoginCreds'
import { getLogins, loginsFor } from '../lib/logins'
import RenewalAlert from './RenewalAlert'
import ClientPortalPanel from './client/ClientPortalPanel'

export function RenewPill({ days }: { days: number | null }) {
  if (days == null) return <span className="pill pill-muted">no date</span>
  if (days < 0) return <span className="pill pill-bad">expired {-days}d ago</span>
  if (days <= 30) return <span className="pill pill-warn">{days}d</span>
  if (days <= 90) return <span className="pill pill-blue">{days}d</span>
  return <span className="pill pill-muted">{days}d</span>
}

/** CA FAIR Plan: who sold a policy — the AgencyZoom producer (matched by policy number or insured name), else the broker
 *  on FAIR Plan's own record */
export const soldBy = (p: BookPolicy): { name: string; from: 'AgencyZoom' | 'FAIR Plan record' } | null =>
  p.data?.soldBy ? { name: String(p.data.soldBy), from: 'AgencyZoom' } : p.data?.broker ? { name: String(p.data.broker), from: 'FAIR Plan record' } : null

const NO_PRODUCER = '__none__'
/** Lost business: a client who canceled (book_accounts.data.lost = { on, reason, by }). Their account leaves the active
 *  books and renewal alerts and is listed under the Lost business tab; their policies are marked Cancelled. */
type Lost = { on: string; reason?: string | null; by?: string | null }
const lostOf = (a: Account) => (a.data?.lost as Lost | undefined) || null
const LOST_META = { key: 'lost', label: 'Lost business', short: 'Lost business', blurb: 'Clients who canceled: when, why and the premium that left the book.' }

export default function Books() {
  const { book = 'farmers' } = useParams()
  const nav = useNavigate()
  const lostView = book === 'lost'
  const key = bookTab(book)
  const meta = lostView ? LOST_META : BOOKS.find((b) => b.key === key)!
  const today = todayPacific()
  const [q, setQ] = useState('')
  const [seller, setSeller] = useState('') // CA FAIR Plan: '' = everyone, a name, or NO_PRODUCER
  const [open, setOpen] = useState<Account | null>(null)
  const [params, setParams] = useSearchParams()
  const { me } = useAuth()
  const [reload, setReload] = useState(0)
  const [renewalsOpen] = useState(() => params.get('renewals') === '1')

  const { data, error } = useAsync(async () => {
    // the Lost business tab gathers lost accounts from every book; each book's own tab leaves them out
    const [all, allPolicies, docs] = await Promise.all([getAccounts(lostView ? undefined : key), getBookPolicies(lostView ? undefined : key), getDocs()])
    const accounts = all.filter((a) => !!lostOf(a) === lostView), ids = new Set(accounts.map((a) => a.id))
    return { accounts, policies: allPolicies.filter((p) => ids.has(p.account_id)), docs }
  }, [key, lostView, reload])

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
        sold: [...new Map(pols.map(soldBy).filter((x): x is NonNullable<ReturnType<typeof soldBy>> => !!x).map((x) => [x.name, x])).values()],
        text: (a.name + ' ' + (a.dba || '') + ' ' + (a.address || '') + ' ' + pols.map((p) => `${p.policy_number} ${p.carrier} ${p.product} ${p.location}`).join(' ')).toLowerCase(),
      }
    }).sort((x, y) => y.premium - x.premium)
  }, [data, today])

  // CA FAIR Plan: only the policies the chosen person sold (or with no producer in AgencyZoom), and the accounts holding them
  const sellerOf = (p: BookPolicy) => soldBy(p)?.name || NO_PRODUCER
  const bySeller = key === 'fair_plan' && seller ? rows.map((r) => {
    const pols = r.pols.filter((p) => sellerOf(p) === seller)
    return { ...r, pols, premium: pols.reduce((t, p) => t + (p.premium || 0), 0), sold: r.sold.filter((x) => x.name === seller) }
  }).filter((r) => r.pols.length) : rows
  const shown = q ? bySeller.filter((r) => r.text.includes(q.toLowerCase())) : bySeller
  const sellers = useMemo(() => {
    const m = new Map<string, { n: number; az: boolean }>()
    ;(data?.policies || []).forEach((p) => { const s = soldBy(p), k = s?.name || NO_PRODUCER, o = m.get(k) || { n: 0, az: false }; o.n++; if (s?.from === 'AgencyZoom') o.az = true; m.set(k, o) })
    return [...m.entries()].sort((a, b) => Number(b[1].az) - Number(a[1].az) || (a[0] === NO_PRODUCER ? 1 : 0) - (b[0] === NO_PRODUCER ? 1 : 0) || a[0].localeCompare(b[0]))
  }, [data])
  const head = <PageHead kicker="Agency Management" title="Books of Business" sub={meta.blurb} />
  const tabs = <Tabs tabs={[...BOOKS.map((b) => ({ key: b.key as string, label: b.short })), { key: 'lost', label: 'Lost business' }]} value={lostView ? 'lost' : key} onChange={(k) => { setQ(''); setSeller(''); nav('/books/' + k) }} />
  if (error) return <>{head}{tabs}<ErrorBox error={error} /></>
  if (!data) return <>{head}{tabs}<Loading /></>

  const total = rows.reduce((s, r) => s + r.premium, 0)
  const pols = data.policies
  const due60 = pols.filter((p) => { const d = daysUntil(p.expiration, today); return d != null && d >= 0 && d <= 60 })
  const expired = pols.filter((p) => { const d = daysUntil(p.expiration, today); return d != null && d < 0 })
  // CA FAIR Plan: payments are billed straight to the client, so what's due soon and what's pending cancellation is what to watch
  const fair = key === 'fair_plan'
  const payDue30 = pols.filter((p) => { const d = daysUntil(p.data?.paymentDue, today); return d != null && d >= 0 && d <= 30 })
  const cancelPending = pols.filter((p) => /cancel/i.test(p.status || ''))
  const azSold: Record<string, number> = {}
  pols.forEach((p) => { if (p.data?.soldBy) azSold[p.data.soldBy] = (azSold[p.data.soldBy] || 0) + 1 })
  const azCount = Object.values(azSold).reduce((a, n) => a + n, 0)

  const exportCsv = () => downloadSheet(`${key}-book-${today}.xlsx`, [
    ['Account', 'DBA', 'Policy #', 'Insured', 'Carrier', 'Line', 'Effective', 'Expiration', 'Premium', 'Status', 'Location', ...(fair ? ['Payment plan', 'Payment method', 'Next payment due', 'Broker', 'Sold by (AgencyZoom)', 'Sold date (AgencyZoom)'] : [])],
    ...shown.flatMap((r) => r.pols.map((p) => [r.a.name, r.a.dba, p.policy_number, p.insured, p.carrier, p.product, p.effective, p.expiration, p.premium, p.status, p.location,
      ...(fair ? [p.data?.paymentPlan, p.data?.paymentMethod, p.data?.paymentDue, p.data?.broker, p.data?.soldBy, p.data?.soldDate] : [])])),
  ], { sheet: 'Book' })

  return (
    <>
      {head}
      {tabs}
      {!lostView && <RenewalAlert key={key} bookKey={key} accounts={data.accounts} policies={data.policies} today={today} startOpen={renewalsOpen} onOpenAccount={setOpen} />}
      {lostView ? <Tiles>
        <Tile label="Accounts lost" value={rows.length} sub={`${pols.length} policies`} />
        <Tile label="Premium lost" value={money0(total)} sub="annual premium on those policies" tone={rows.length ? 'warn' : undefined} />
        <Tile label="Lost this month" value={rows.filter((r) => (lostOf(r.a)?.on || '').slice(0, 7) === today.slice(0, 7)).length} sub={money0(rows.filter((r) => (lostOf(r.a)?.on || '').slice(0, 7) === today.slice(0, 7)).reduce((t, r) => t + r.premium, 0)) + ' premium'} />
      </Tiles> : <Tiles>
        <Tile label="Accounts" value={rows.length} sub={`${pols.length} policies`} />
        <Tile label="Annual premium" value={money0(total)} sub={rows.length ? money0(total / rows.length) + ' per account' : ''} />
        <Tile label="Renewing in 60 days" value={due60.length} sub={money0(due60.reduce((s, p) => s + (p.premium || 0), 0)) + ' premium'} tone={due60.length ? 'warn' : undefined} />
        {fair ? <>
          <Tile label="Payments due in 30 days" value={payDue30.length} sub={money0(payDue30.reduce((s, p) => s + (p.premium || 0), 0)) + ' premium on those policies'} tone={payDue30.length ? 'warn' : undefined} />
          <Tile label="Cancel pending" value={cancelPending.length} sub={cancelPending.length ? cancelPending.map((p) => p.insured).join(', ') : 'none'} tone={cancelPending.length ? 'warn' : undefined} />
          <Tile label="Sold by (AgencyZoom)" value={`${azCount} of ${pols.length}`} sub={azCount ? Object.entries(azSold).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n.split(' ')[0]} ${c}`).join(' · ') : 'no producer set in AgencyZoom'} />
        </> : <Tile label="Past expiration" value={expired.length} sub={expired.length ? 'confirm renewed or lapsed' : 'none'} />}
      </Tiles>}
      <Panel title="Accounts" sub={`${shown.length} of ${rows.length}${fair && seller ? ` · sold by ${seller === NO_PRODUCER ? "no producer on file" : seller}` : ""} · click an account for policies, notes and documents`}
        right={<div className="filters"><Search value={q} onChange={setQ} placeholder="Name, policy #, carrier, address" />
          {fair && <select className="fld" value={seller} onChange={(e) => setSeller(e.target.value)} aria-label="Sold by">
            <option value="">Sold by: everyone</option>
            {sellers.map(([n, o]) => <option key={n} value={n}>{n === NO_PRODUCER ? 'No producer on file' : n + (o.az ? '' : ' (FAIR Plan record)')} · {o.n}</option>)}
          </select>}<MoreMenu title="More" items={[{ label: 'Export to Excel', onClick: exportCsv }]} />{isAdmin(me?.role) && <DocUpload onDone={() => setReload((n) => n + 1)} />}</div>}>
        {shown.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Account</th>{lostView && <th>Book</th>}{fair && <th>Sold by</th>}<th>Lines</th><th className="r">Policies</th><th className="r">Premium</th>{lostView ? <><th>Lost on</th><th>Reason</th></> : <th>Next renewal</th>}<th className="r">Docs</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.a.id} className="clickable" onClick={() => setOpen(r.a)}>
                    <td><div className="strong">{r.a.name}</div>{r.a.dba && r.a.dba !== r.a.name && <div className="sub">{r.a.dba}</div>}</td>
                    {lostView && <td className="sub">{bookLabel(r.a.book)}</td>}
                    {fair && <td>{r.sold.length ? r.sold.map((x) => <div key={x.name} className={x.from === 'AgencyZoom' ? '' : 'sub'} title={x.from}>{x.name}{x.from === 'AgencyZoom' ? '' : ' · FAIR Plan record'}</div>) : <span className="sub">—</span>}</td>}
                    <td className="sub">{r.lines}</td>
                    <td className="r">{r.pols.length}</td>
                    <td className="r mono">{money0(r.premium)}</td>
                    {lostView ? <><td>{lostOf(r.a)?.on ? mdy(lostOf(r.a)!.on) : '—'}</td><td className="sub">{lostOf(r.a)?.reason || '—'}</td></>
                      : <td>{r.next ? <>{mdy(r.next)} <RenewPill days={daysUntil(r.next, today)} /></> : <span className="sub">—</span>}</td>}
                    <td className="r">{r.docs || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>No accounts match.</Empty>}
      </Panel>
      {open && <AccountDrawer account={open} policies={data.policies.filter((p) => p.account_id === open.id)} docs={data.docs.filter((d) => d.account_id === open.id)} onClose={() => setOpen(null)}
        onChange={isAdmin(me?.role) ? () => { setOpen(null); setReload((n) => n + 1) } : undefined} />}
    </>
  )
}

const HIDE = new Set(['soldBy', 'soldDate', 'azPolicyId', 'soldByMatch', 'paymentDue', 'paymentPlan', 'paymentMethod', 'id', 'insured', 'policyNumber', 'policyNumberFormatted', 'annualPremium', 'inception', 'renewal', 'productType', 'carrier',
  'effective', 'expiration', 'kind', 'coverageType', 'premium', 'termFrom', 'termTo', 'policy', 'start', 'named', 'address', 'locationId', 'locationName', 'locationAddress', 'status'])

function label(k: string) { return k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()) }
function show(v: any): string {
  if (v == null || v === '') return ''
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.map((x) => (Array.isArray(x) ? x.join(': ') : typeof x === 'object' ? Object.values(x).filter(Boolean).join(' · ') : String(x))).join('\n')
  if (typeof v === 'object') return Object.entries(v).filter(([, x]) => x != null && x !== '').map(([k, x]) => `${label(k)}: ${typeof x === 'object' ? JSON.stringify(x) : x}`).join('\n')
  return String(v)
}

/** The wholesale brokers' and carriers' sites, matched to an account's broker and its policies' carriers. The saved
 *  logins for each (Passwords) show beside it for staff who can see passwords. */
const PORTALS: { rx: RegExp; name: string; url: string; kind: 'Wholesale broker' | 'Carrier'; note?: string }[] = [
  { rx: /\busg\b/i, name: 'USG Insurance Services', url: 'https://usginslink.com/', kind: 'Wholesale broker', note: 'Binders, endorsements and documents for policies placed through USG' },
  { rx: /evanston|markel/i, name: 'Markel (Evanston Insurance Company)', url: 'https://www.markel.com/', kind: 'Carrier' },
  { rx: /kinsale/i, name: 'Kinsale Insurance', url: 'https://www.kinsaleins.com/', kind: 'Carrier' },
  { rx: /penn-?star/i, name: 'Penn-Star (Global Indemnity)', url: 'https://www.global-indemnity.com/', kind: 'Carrier' },
  { rx: /richmond national/i, name: 'Richmond National', url: 'https://www.richmondnational.com/', kind: 'Carrier' },
  { rx: /fair plan/i, name: 'California FAIR Plan', url: 'https://www.cfpnet.com/insfront/pgLogin.aspx', kind: 'Carrier' },
  { rx: /bamboo/i, name: 'Bamboo Insurance', url: 'https://agent.bambooinsurance.com/', kind: 'Carrier' },
]

function Portals({ account, policies }: { account: Account; policies: BookPolicy[] }) {
  const logins = useAsync(() => getLogins().catch(() => []), [])
  const text = [account.data?.broker, ...policies.map((p) => p.carrier), ...policies.map((p) => p.data?.broker)].filter(Boolean).join(' · ')
  const hits = PORTALS.filter((x) => x.rx.test(text))
  if (!hits.length) return null
  return (
    <Panel title="Broker & carrier logins" sub="Open the site to find this client's record">
      {hits.map((x) => (
        <div key={x.name} className="plan">
          <div className="plan-h" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div><b>{x.name}</b> <span className="sub">· {x.kind}</span></div>
            <a className="linkbtn" href={x.url} target="_blank" rel="noreferrer">Open site ↗</a>
          </div>
          {x.note && <div className="sub">{x.note}</div>}
          <LoginCreds logins={loginsFor(logins.data || [], { name: x.name, portal: x.url })} />
        </div>
      ))}
    </Panel>
  )
}

/** Marks a client as lost business (their policies Cancelled, each keeping the status it had, to restore) or puts them back. */
async function setLost(account: Account, policies: BookPolicy[], lost: Lost | null) {
  const data = { ...(account.data || {}) }
  if (lost) data.lost = lost; else delete data.lost
  const a = await supabase.from('book_accounts').update({ data }).eq('id', account.id)
  if (a.error) throw a.error
  for (const p of policies) {
    const pd = { ...(p.data || {}) }
    let status = p.status
    if (lost) { if (!/cancel/i.test(p.status || '')) { pd.statusBefore = p.status; status = 'Cancelled' } }
    else { status = (pd.statusBefore as string | undefined) ?? p.status; delete pd.statusBefore }
    const r = await supabase.from('book_policies').update({ status, data: pd }).eq('id', p.id)
    if (r.error) throw r.error
  }
}

function LostControl({ account, policies, onChange }: { account: Account; policies: BookPolicy[]; onChange: () => void }) {
  const { me } = useAuth()
  const lost = lostOf(account)
  const [busy, setBusy] = useState(false)
  const run = async (next: Lost | null) => {
    setBusy(true)
    try { await setLost(account, policies, next); onChange() } catch (e) { alert('Could not save: ' + String((e as Error)?.message || e)) } finally { setBusy(false) }
  }
  const mark = () => {
    const on = prompt('Date they canceled (YYYY-MM-DD):', todayPacific()); if (on === null) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(on.trim())) { alert('Use a date like 2026-11-20.'); return }
    const reason = prompt('Why they left (optional, e.g. price, went with another agent):', '') ?? ''
    void run({ on: on.trim(), reason: reason.trim() || null, by: me?.display_name || null })
  }
  const editReason = () => {
    const reason = prompt('Why they left:', lost?.reason || ''); if (reason === null) return
    void run({ ...lost!, reason: reason.trim() || null })
  }
  if (lost) return (
    <div className="note-box">
      <b>Lost business</b> · canceled {mdy(lost.on)}{lost.reason ? ` · ${lost.reason}` : ''}{lost.by ? ` · marked by ${lost.by}` : ''}
      <div className="row-actions" style={{ marginTop: 8 }}>
        <button className="btn-ghost" disabled={busy} onClick={editReason}>{lost.reason ? 'Change reason' : 'Add reason'}</button>
        <button className="btn-ghost" disabled={busy} onClick={() => { if (confirm(`Put ${account.name} back on the active book?`)) void run(null) }}>Restore to active book</button>
      </div>
    </div>
  )
  return <div className="row-actions" style={{ justifyContent: 'flex-end' }}><button className="btn-ghost" disabled={busy} onClick={mark}>Mark as lost business</button></div>
}

export function AccountDrawer({ account, policies, docs, onClose, onChange }: { account: Account; policies: BookPolicy[]; docs: Doc[]; onClose: () => void; onChange?: () => void }) {
  const today = todayPacific()
  const total = policies.reduce((s, p) => s + (p.premium || 0), 0)
  const d = account.data || {}
  return (
    <Drawer open onClose={onClose} title={account.name} sub={[account.dba !== account.name ? account.dba : null, `${policies.length} policies · ${money0(total)}`].filter(Boolean).join(' · ')}>
      <KV rows={[['Contact', account.contact], ['Phone', account.phone], ['Address', account.address], ['Producer', account.producer],
        ['Broker', d.broker], ['AOR', d.aor], ['Household', d.household], ['Source', d.source === 'shannon-transfer' ? 'Shannon book transfer' : d.source]]} />
      {d.wcNote && <div className="note-box">{d.wcNote}</div>}
      {onChange ? <LostControl account={account} policies={policies} onChange={onChange} /> : lostOf(account) && <div className="note-box"><b>Lost business</b> · canceled {mdy(lostOf(account)!.on)}{lostOf(account)!.reason ? ` · ${lostOf(account)!.reason}` : ''}</div>}

      <Portals account={account} policies={policies} />

      <Panel title="Policies">
        {policies.length ? policies.map((p) => {
          const extra = Object.entries(p.data || {}).filter(([k, v]) => !HIDE.has(k) && show(v))
          return (
            <div key={p.id} className="plan">
              <div className="plan-h" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div><b>{p.product || 'Policy'}</b> · {p.carrier} {p.policy_number && <span className="sub">#{p.policy_number}</span>}</div>
                <div><b className="mono">{p.premium != null ? money2(p.premium) : '—'}</b> {p.status && <span className="pill pill-muted">{p.status}</span>}</div>
              </div>
              <KV rows={[['Insured', p.insured], ...(p.book === 'fair_plan' ? [['Sold by', (() => { const s = soldBy(p); return s ? <>{s.name} <span className="sub">· {s.from === 'AgencyZoom' ? `AgencyZoom${p.data?.soldDate ? `, sold ${mdy(p.data.soldDate)}` : ''}` : 'FAIR Plan record (no producer in AgencyZoom)'}</span></> : 'Not found in AgencyZoom' })()]] as [string, ReactNode][] : []), ['Location', p.location], ...(p.data?.paymentDue ? [['Next payment due', <>{mdy(p.data.paymentDue)} <RenewPill days={daysUntil(p.data.paymentDue, today)} /></>], ['Payment plan', [p.data.paymentPlan, p.data.paymentMethod].filter(Boolean).join(' · ')]] as [string, ReactNode][] : []), ['Effective', p.effective ? mdy(p.effective) : ''],
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

      <CertificatesIssued docs={docs.filter((x) => x.category === 'coi')} />

      <ClientPortalPanel account={account} />

      <Panel title="Documents">
        <DocList docs={docs} empty="No documents filed for this account yet." />
      </Panel>
    </Drawer>
  )
}

/** Every certificate of insurance made for this client in the COI generator: the holder, the exact date and time it was
 *  issued (Pacific) and who issued it, newest first — the agency's record of what went out. */
function CertificatesIssued({ docs }: { docs: Doc[] }) {
  const certs = [...docs].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  const holder = (t: string) => t.replace(/^Certificate\s*[—-]\s*/, '').replace(/\s*\([^)]*\)\s*$/, '') || t
  return (
    <Panel title={`Certificates issued${certs.length ? ` (${certs.length})` : ''}`} sub="Made in the COI generator · the exact date and time each one was issued">
      {certs.length ? (
        <table className="tbl">
          <thead><tr><th>Certificate holder</th><th>Issued</th><th /></tr></thead>
          <tbody>{certs.map((d) => (
            <tr key={d.id}>
              <td><div className="strong">{holder(d.title)}</div>{d.policy_number && <div className="sub">Policy #{d.policy_number}</div>}</td>
              <td><div>{issuedAt(d.created_at) || '—'}</div>{d.issued_by && <div className="sub">by {d.issued_by}</div>}</td>
              <td className="r"><div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                <button className="linkbtn" onClick={() => openDoc(d)}>View</button>
                <button className="linkbtn" onClick={() => openDoc(d, true)}>Download</button>
              </div></td>
            </tr>
          ))}</tbody>
        </table>
      ) : <Empty>No certificates issued for this client yet. Certificates made in the COI generator are filed here automatically.</Empty>}
    </Panel>
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
