import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Drawer, Empty, ErrorBox, KV, Loading, Panel, Tabs, Tile, Tiles } from '../../components/ui'
import { getClientFile, openClientDoc, type ClientDoc, type ClientFile, type ClientItem, type ClientPolicy } from '../../lib/client'
import { daysUntil, fmtBytes } from '../../lib/books'
import { mdy, money0, money2, timeAgo, todayPacific } from '../../lib/format'

/** The client portal: a client's own file, live. Their policies by location, what they spend and where, renewals and
 *  anything that needs attention, the agency's pending items and updates, and their documents. It re-reads the file
 *  every 15 seconds while open (and the moment the tab comes back), so an update the agency makes shows up on its own.
 *  Staff open the same screen as a preview of one account (previewAccount). */

const LIVE_MS = 15000
const CATS: Record<string, string> = { dec: 'Declarations pages', binder: 'Binders', wc: 'Workers’ comp', coi: 'Certificates of insurance', other: 'Other documents' }
const catLabel = (c: string) => CATS[c] || c.charAt(0).toUpperCase() + c.slice(1)
const tidy = (s: string | null) => (s ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/ - /g, ' · ').replace(/\bDec Sheet\b/, 'Dec Page') : '—')
const ended = (p: ClientPolicy, today: string) => !!p.expiration && p.expiration < today
const cancelled = (p: ClientPolicy) => /cancel|lapse/i.test(p.status || '')
const inForce = (p: ClientPolicy, today: string) => !ended(p, today) && !cancelled(p)
const locKey = (p: ClientPolicy) => p.location_name || (p.location || '').split(' · ')[0] || 'Other'
function statusTone(p: ClientPolicy, today: string): 'good' | 'warn' | 'muted' {
  if (ended(p, today) || cancelled(p) || /action|expired/i.test(p.status || '')) return 'warn'
  if (/await|pending/i.test(p.status || '')) return 'muted'
  return 'good'
}
const statusText = (p: ClientPolicy, today: string) => (ended(p, today) && !/expired/i.test(p.status || '') ? 'Term ended' : tidy(p.status))

interface Alert { tone: 'warn' | 'info'; title: ReactNode; sub?: ReactNode; policy?: ClientPolicy }
function alertsFor(f: ClientFile, today: string): Alert[] {
  const out: Alert[] = []
  const where = (p: ClientPolicy) => `${p.product || 'Policy'} · ${locKey(p)}`
  for (const p of f.policies) {
    const d = daysUntil(p.expiration, today)
    if (/action/i.test(p.status || '')) out.push({ tone: 'warn', title: <>Action needed: {where(p)}</>, sub: 'Your agent will reach out with what’s needed — or call us.', policy: p })
    if (cancelled(p)) out.push({ tone: 'warn', title: <>{tidy(p.status)}: {where(p)}</>, sub: 'Contact your agent right away to keep this coverage.', policy: p })
    else if (d != null && d < 0) out.push({ tone: 'warn', title: <>Term ended {mdy(p.expiration!)}: {where(p)}</>, sub: 'Check with your agent that this policy has renewed.', policy: p })
    else if (d != null && d <= 60) out.push({ tone: d <= 30 ? 'warn' : 'info', title: <>Renews in {d} day{d === 1 ? '' : 's'}: {where(p)}</>, sub: `Renewal date ${mdy(p.expiration!)} · ${p.carrier || ''}`, policy: p })
    if ((p.amount_due_now || 0) > 0) out.push({ tone: 'warn', title: <>Payment due now: {money2(p.amount_due_now!)}</>, sub: where(p), policy: p })
    const pd = daysUntil(p.payment_due, today)
    if (pd != null && pd >= 0 && pd <= 30) out.push({ tone: pd <= 7 ? 'warn' : 'info', title: <>Payment due {mdy(p.payment_due!)}</>, sub: where(p), policy: p })
    if (/await/i.test(p.status || '')) out.push({ tone: 'info', title: <>Bound, waiting on the carrier’s paperwork: {where(p)}</>, sub: 'You’re covered. The declarations page will appear under Documents when it arrives.', policy: p })
  }
  return out.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'warn' ? -1 : 1))
}

function useLiveFile(previewAccount?: string) {
  const [file, setFile] = useState<ClientFile | null | undefined>(undefined)
  const [error, setError] = useState<unknown>(null)
  const [checked, setChecked] = useState<string | null>(null)
  const [changed, setChanged] = useState<string | null>(null)
  const stamp = useRef<string | null | undefined>(undefined)
  const load = useCallback(async () => {
    try {
      const f = await getClientFile(previewAccount)
      setError(null); setChecked(new Date().toISOString())
      const s = f?.updated_at ?? null
      if (stamp.current !== undefined && s !== stamp.current) setChanged(new Date().toISOString())
      stamp.current = s
      setFile(f)
    } catch (e) { setError(e) }
  }, [previewAccount])
  useEffect(() => {
    load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, LIVE_MS)
    const back = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', back); window.addEventListener('focus', back)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', back); window.removeEventListener('focus', back) }
  }, [load])
  return { file, error, checked, changed, reload: load }
}

/** A labelled bar per row, longest first: one measure (annual premium), so one color; the amounts are text. */
function SpendBars({ rows, total }: { rows: { label: string; sub?: string; value: number; count: number }[]; total: number }) {
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div className="cp-bars">{rows.map((r) => (
      <div key={r.label} className="cp-bar" title={`${r.label}: ${money2(r.value)} · ${r.count} polic${r.count === 1 ? 'y' : 'ies'} · ${total ? Math.round((r.value / total) * 100) : 0}% of your premium`}>
        <div className="cp-bar-l"><b>{r.label}</b>{r.sub && <small>{r.sub}</small>}</div>
        <div className="cp-bar-track"><i style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></div>
        <div className="cp-bar-v"><b className="mono">{money0(r.value)}</b><small>{total ? Math.round((r.value / total) * 100) : 0}% · {r.count}</small></div>
      </div>
    ))}</div>
  )
}

function group(pols: ClientPolicy[], key: (p: ClientPolicy) => string, sub?: (p: ClientPolicy) => string | undefined) {
  const m = new Map<string, { label: string; sub?: string; value: number; count: number }>()
  for (const p of pols) { const k = key(p); const o = m.get(k) || { label: k, sub: sub?.(p), value: 0, count: 0 }; o.value += p.premium || 0; o.count++; m.set(k, o) }
  return [...m.values()].sort((a, b) => b.value - a.value)
}

export default function ClientPortal({ previewAccount, onSignOut, onChangePassword }: { previewAccount?: string; onSignOut?: () => void; onChangePassword?: () => void }) {
  const { file, error, checked, changed } = useLiveFile(previewAccount)
  const [tab, setTab] = useState<'overview' | 'policies' | 'documents'>('overview')
  const [open, setOpen] = useState<ClientPolicy | null>(null)
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(t) }, [])
  const today = todayPacific()

  const view = useMemo(() => {
    if (!file) return null
    const live = file.policies.filter((p) => inForce(p, today))
    const total = live.reduce((s, p) => s + (p.premium || 0), 0)
    const locAddr = new Map(file.accounts.flatMap((a) => a.locations.map((l) => [l.name, l.address] as const)))
    const next = live.filter((p) => p.expiration).sort((a, b) => a.expiration!.localeCompare(b.expiration!))[0]
    return {
      live, total, next,
      byLoc: group(live, locKey, (p) => p.location_address || locAddr.get(locKey(p)) || undefined),
      byLine: group(live, (p) => p.product || 'Other'),
      byCarrier: group(live, (p) => p.carrier || 'Other'),
      locations: new Set(file.policies.map(locKey)).size,
      alerts: alertsFor(file, today),
      pending: file.items.filter((i) => i.kind === 'pending' && i.status === 'open'),
      updates: file.items.filter((i) => i.kind === 'update' || i.status === 'done').sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    }
  }, [file, today])

  if (error && !file) return <div className="cp"><ErrorBox error={error} /></div>
  if (file === undefined) return <div className="center"><Loading what="Opening your file" /></div>
  if (!file || !view) return <div className="cp"><Empty>No client file is set up for this login yet. Please contact your agent.</Empty></div>

  const acct = file.accounts[0]
  const first = (file.viewer.display_name || acct?.contact || '').split(' ')[0]
  const agency = file.agency?.name || 'Your agency'
  const docsFor = (p: ClientPolicy) => file.documents.filter((d) => d.policy_number && p.policy_number && d.policy_number.replace(/\W/g, '').toLowerCase() === p.policy_number.replace(/\W/g, '').toLowerCase())
  const fresh = changed && Date.now() - Date.parse(changed) < 60000

  const live = (
    <div className={'cp-live' + (fresh ? ' cp-live-new' : '')} role="status" aria-live="polite">
      <span className="cp-dot" />{fresh ? 'Just updated' : 'Live'}<small>{checked ? `checked ${timeAgo(checked)}` : ''}{file.updated_at ? ` · file updated ${timeAgo(file.updated_at)}` : ''}</small>
    </div>
  )

  return (
    <div className={'cp' + (previewAccount ? ' cp-preview' : '')}>
      {previewAccount ? (
        <div className="cp-preview-band">Preview — this is exactly what <b>{file.viewer.display_name || acct?.name}</b> sees in the client portal. Internal notes never appear here.</div>
      ) : (
        <header className="cp-top">
          <div className="cp-brand"><b>{agency}</b><small>Client portal</small></div>
          <div className="cp-who">
            <span>{file.viewer.display_name}</span>
            {onChangePassword && <button className="btn-ghost" onClick={onChangePassword}>Password</button>}
            {onSignOut && <button className="btn-ghost" onClick={onSignOut}>Sign out</button>}
          </div>
        </header>
      )}

      <section className="cp-hero">
        <div>
          <div className="kicker">{acct?.dba || acct?.name}</div>
          <h1>{first ? `Welcome, ${first}` : 'Your insurance'}</h1>
          <div className="sub">Everything on file with {agency}, updated live as your agent works on it.</div>
        </div>
        {live}
      </section>

      <Tabs tabs={[{ key: 'overview' as const, label: 'Dashboard' }, { key: 'policies' as const, label: `Policies (${file.policies.length})` }, { key: 'documents' as const, label: `Documents (${file.documents.length})` }]} value={tab} onChange={setTab} />

      {tab === 'overview' && <>
        {view.alerts.length > 0 && (
          <section className="panel cp-alerts">
            <div className="panel-h"><div><div className="panel-t">Alerts</div><div className="panel-s">{view.alerts.filter((a) => a.tone === 'warn').length} need attention · renewals in the next 60 days and anything pending on a policy</div></div></div>
            <div className="cp-alert-list">{view.alerts.map((a, i) => (
              <button key={i} className={'cp-alert cp-alert-' + a.tone} onClick={() => a.policy && setOpen(a.policy)}>
                <span className="cp-alert-ic" aria-hidden="true">{a.tone === 'warn' ? '!' : 'i'}</span>
                <span><b>{a.title}</b>{a.sub && <small>{a.sub}</small>}</span>
              </button>
            ))}</div>
          </section>
        )}

        <Tiles>
          <Tile label="Annual premium" value={money0(view.total)} sub={`${view.live.length} policies in force`} />
          <Tile label="Locations" value={view.locations} sub={`${file.policies.length} policies on file`} />
          <Tile label="Next renewal" value={view.next ? mdy(view.next.expiration!) : '—'} sub={view.next ? `${view.next.product} · ${locKey(view.next)}` : ''} />
          <Tile label="Pending items" value={view.pending.length} sub={view.pending.length ? 'see below' : 'nothing waiting'} tone={view.pending.length ? 'warn' : 'good'} />
        </Tiles>

        <Panel title="Pending & updates" sub="What your agent is working on for you, and anything they need from you">
          {view.pending.length || view.updates.length ? (
            <div className="cp-items">
              {view.pending.map((i) => <ItemRow key={i.id} i={i} today={today} />)}
              {view.updates.slice(0, 8).map((i) => <ItemRow key={i.id} i={i} today={today} />)}
            </div>
          ) : <Empty>Nothing pending right now.</Empty>}
        </Panel>

        <div className="cp-grid">
          <Panel title="Spend by location" sub={`Annual premium of policies in force · ${money0(view.total)}`}>
            {view.byLoc.length ? <SpendBars rows={view.byLoc} total={view.total} /> : <Empty>No policies in force.</Empty>}
          </Panel>
          <div className="cp-col">
            <Panel title="Spend by coverage" sub="Annual premium by line of coverage">
              {view.byLine.length ? <SpendBars rows={view.byLine} total={view.total} /> : <Empty>—</Empty>}
            </Panel>
            <Panel title="Spend by carrier" sub="Who your coverage is placed with">
              {view.byCarrier.length ? <SpendBars rows={view.byCarrier} total={view.total} /> : <Empty>—</Empty>}
            </Panel>
          </div>
        </div>

        <Panel title="Renewal calendar" sub="Every policy by its renewal date">
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Renews</th><th>Coverage</th><th>Location</th><th>Carrier</th><th className="r">Premium</th><th>Status</th></tr></thead>
            <tbody>{[...file.policies].sort((a, b) => (a.expiration || '9').localeCompare(b.expiration || '9')).map((p) => {
              const d = daysUntil(p.expiration, today)
              return (
                <tr key={p.id} className="clickable" onClick={() => setOpen(p)}>
                  <td>{p.expiration ? mdy(p.expiration) : '—'} {d != null && <span className={'pill ' + (d < 0 ? 'pill-warn' : d <= 60 ? 'pill-warn' : 'pill-muted')}>{d < 0 ? 'ended' : `${d}d`}</span>}</td>
                  <td>{p.product}</td><td>{locKey(p)}</td><td className="sub">{p.carrier}</td>
                  <td className="r mono">{p.premium != null ? money0(p.premium) : '—'}</td>
                  <td><span className={'pill pill-' + statusTone(p, today)}>{statusText(p, today)}</span></td>
                </tr>
              )
            })}</tbody>
          </table></div>
        </Panel>
      </>}

      {tab === 'policies' && <div className="cp-locs">
        {[...new Set(file.policies.map(locKey))].map((loc) => {
          const ps = file.policies.filter((p) => locKey(p) === loc)
          const addr = ps.find((p) => p.location_address)?.location_address || acct?.locations.find((l) => l.name === loc)?.address
          return (
            <Panel key={loc} title={loc} sub={[addr, `${ps.length} polic${ps.length === 1 ? 'y' : 'ies'}`, money0(ps.filter((p) => inForce(p, today)).reduce((s, p) => s + (p.premium || 0), 0)) + ' / year'].filter(Boolean).join(' · ')}>
              <div className="cp-pols">{ps.map((p) => (
                <button key={p.id} className="cp-pol" onClick={() => setOpen(p)}>
                  <div className="cp-pol-m"><b>{p.product}</b><small>{p.carrier}{p.policy_number ? ` · #${p.policy_number}` : ''}</small></div>
                  <div className="cp-pol-t sub">{p.effective ? mdy(p.effective) : '—'} – {p.expiration ? mdy(p.expiration) : '—'}</div>
                  <div className="cp-pol-p mono">{p.premium != null ? money0(p.premium) : '—'}</div>
                  <span className={'pill pill-' + statusTone(p, today)}>{statusText(p, today)}</span>
                  <span className="cp-pol-d sub">{docsFor(p).length ? `${docsFor(p).length} doc${docsFor(p).length === 1 ? '' : 's'}` : ''}</span>
                </button>
              ))}</div>
            </Panel>
          )
        })}
        {!file.policies.length && <Empty>No policies on file yet.</Empty>}
      </div>}

      {tab === 'documents' && <Documents docs={file.documents} policies={file.policies} />}

      {open && (
        <Drawer open onClose={() => setOpen(null)} title={`${open.product || 'Policy'} · ${locKey(open)}`} sub={[open.carrier, open.policy_number && `#${open.policy_number}`].filter(Boolean).join(' · ')}>
          <KV rows={[
            ['Status', <span className={'pill pill-' + statusTone(open, today)}>{statusText(open, today)}</span>],
            ['Annual premium', open.premium != null ? money2(open.premium) : ''],
            ['Policy term', `${open.effective ? mdy(open.effective) : '—'} – ${open.expiration ? mdy(open.expiration) : '—'}`],
            ['Renews', open.expiration ? (() => { const d = daysUntil(open.expiration, today)!; return d < 0 ? `term ended ${-d} days ago` : `in ${d} days` })() : ''],
            ['Location', [open.location_name, open.location_address].filter(Boolean).join(' · ') || open.location],
            ['Coverage', open.coverage],
            ['Payment', [open.financed ? 'Premium financed' : null, open.payment_plan, open.payment_method].filter(Boolean).join(' · ')],
            ['Next payment due', open.payment_due ? mdy(open.payment_due) : ''],
            ['Due now', (open.amount_due_now || 0) > 0 ? money2(open.amount_due_now!) : ''],
          ]} />
          <Panel title="Documents for this policy">
            {docsFor(open).length ? <DocRows docs={docsFor(open)} /> : <Empty>No documents filed for this policy yet — they’ll appear here as soon as your agent adds them.</Empty>}
          </Panel>
        </Drawer>
      )}

      <footer className="cp-foot">Questions about your coverage? Contact {agency}. This page refreshes on its own every few seconds.</footer>
    </div>
  )
}

function ItemRow({ i, today }: { i: ClientItem; today: string }) {
  const d = daysUntil(i.due_on, today)
  const done = i.status === 'done'
  return (
    <div className={'cp-item' + (done ? ' cp-item-done' : i.kind === 'pending' ? ' cp-item-pending' : '')}>
      <span className={'pill ' + (done ? 'pill-good' : i.kind === 'pending' ? 'pill-warn' : 'pill-muted')}>{done ? 'Done' : i.kind === 'pending' ? 'Pending' : 'Update'}</span>
      <div className="cp-item-b"><b>{i.title}</b>{i.detail && <div className="sub" style={{ whiteSpace: 'pre-wrap' }}>{i.detail}</div>}</div>
      <div className="cp-item-w sub">
        {i.due_on && !done && <div className={d != null && d < 0 ? 'cp-late' : ''}>due {mdy(i.due_on)}</div>}
        <div>{done && i.done_at ? `done ${timeAgo(i.done_at)}` : `posted ${timeAgo(i.created_at)}`}</div>
      </div>
    </div>
  )
}

function DocRows({ docs }: { docs: ClientDoc[] }) {
  return (
    <div className="cp-docs">{docs.map((d) => (
      <div key={d.id} className="cp-doc">
        <div><b>{d.title}</b><small>{[catLabel(d.category), d.policy_number && `#${d.policy_number}`, mdy(d.created_at.slice(0, 10)), d.size_bytes ? fmtBytes(d.size_bytes) : ''].filter(Boolean).join(' · ')}</small></div>
        <div className="cp-doc-a"><button className="btn-ghost" onClick={() => openClientDoc(d)}>Open</button><button className="btn-ghost" onClick={() => openClientDoc(d, true)}>Download</button></div>
      </div>
    ))}</div>
  )
}

function Documents({ docs, policies }: { docs: ClientDoc[]; policies: ClientPolicy[] }) {
  const [q, setQ] = useState('')
  const where = new Map(policies.filter((p) => p.policy_number).map((p) => [p.policy_number!.replace(/\W/g, '').toLowerCase(), `${p.product} · ${locKey(p)}`]))
  const shown = docs.filter((d) => !q || `${d.title} ${d.file_name} ${d.policy_number} ${catLabel(d.category)} ${where.get((d.policy_number || '').replace(/\W/g, '').toLowerCase()) || ''}`.toLowerCase().includes(q.toLowerCase()))
  const cats = [...new Set(shown.map((d) => d.category))]
  return (
    <Panel title="Documents" sub="Declarations pages, binders, certificates and everything else your agent files" right={<input className="fld" placeholder="Search documents" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" />}>
      {cats.length ? cats.map((c) => (
        <div key={c} className="cp-doc-group"><div className="cp-doc-h">{catLabel(c)}</div><DocRows docs={shown.filter((d) => d.category === c)} /></div>
      )) : <Empty>{docs.length ? 'No documents match.' : 'No documents filed yet — they’ll appear here as soon as your agent adds them.'}</Empty>}
    </Panel>
  )
}
