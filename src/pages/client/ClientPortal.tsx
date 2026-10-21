import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getClientFile, openClientDoc, type ClientDoc, type ClientFile, type ClientItem, type ClientPolicy, type PortalGroup } from '../../lib/client'
import { daysUntil } from '../../lib/books'
import { COPYRIGHT, mdy, money0, money2, timeAgo, todayPacific } from '../../lib/format'
import { PageHead, Panel, Tabs, Tile, Tiles } from '../../components/ui'
import { Icon } from '../../components/icons'
import { applyLook, getLook, onLook } from '../../lib/theme'
import logo from '../../assets/logo.jpg'
import logoHalloween from '../../assets/logo-halloween.jpg'

/** The client portal: a client's own file, live, laid out by location. The main page has the alerts, carrier totals,
 *  next renewals and a card per location (its coverages, premium, next renewal and documents); a location opens to what
 *  the client pays for there and a card per policy (summary, payment, WC info). It re-reads the file every 15 seconds
 *  while open (and the moment the tab comes back), so the agency's updates show up on their own. Staff open the same
 *  screen as a preview of one account (previewAccount). Only client-safe fields ever reach it (see client_portal()). */

const LIVE_MS = 15000
const tidy = (s: string | null | undefined) => (s ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/ - /g, ' · ').replace(/\bDec Sheet\b/, 'Dec Page') : '—')
const norm = (s: string | null | undefined) => (s || '').replace(/\W/g, '').toLowerCase()
const locKey = (p: ClientPolicy) => p.location_name || (p.location || '').split(' · ')[0] || 'Other'
const isWc = (p: ClientPolicy) => /workers/i.test(p.product || '')
const chip = (p: ClientPolicy) => (isWc(p) ? 'Workers Comp' : /property\s*\/\s*bop|package/i.test(`${p.product} ${p.coverage}`) ? 'GL/Property' : /general liability/i.test(p.product || '') ? 'GL' : p.product || 'Policy')
const paying = (p: ClientPolicy) => (chip(p) === 'GL/Property' ? 'Property + GL (combined policy)' : chip(p) === 'GL' ? 'General Liability' : chip(p))
type Tone = 'bad' | 'warn' | 'good'
function tone(p: ClientPolicy, today: string): Tone {
  const s = p.status || ''
  if (/cancel|lapse|action|expired/i.test(s) || (!!p.expiration && p.expiration < today)) return 'bad'
  if (/await|pending/i.test(s)) return 'warn'
  return 'good'
}
const statusLabel = (p: ClientPolicy, today: string) => (p.expiration && p.expiration < today && !/expired/i.test(p.status || '') ? 'Term ended' : tidy(p.status))
const docWord = (d: ClientDoc, p?: ClientPolicy) => {
  const what = p ? chip(p) : ''
  if (d.category === 'wc') return 'WC info'
  if (d.category === 'dec') return `${what} dec sheet`.trim()
  if (d.category === 'binder') return `${what} binder`.trim()
  if (d.category === 'coi') return 'certificate'
  return d.title
}
function renewIn(exp: string | null, today: string) {
  const d = daysUntil(exp, today)
  if (d == null) return null
  return d < 0 ? { text: `Expired ${-d}d ago`, bad: true } : { text: `Renews in ${d}d`, bad: false }
}

/* --- small inline icons (stroke = currentColor) --- */
const I = {
  building: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M8 8h3M8 12h3M8 16h3M3 21h18" /></svg>,
  shield: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" /></svg>,
  hat: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17h18M5 17a7 7 0 0 1 14 0M10 10V7h4v3" /></svg>,
  down: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>,
  pin: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>,
  warn: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 18H2L12 3zM12 10v5M12 18v.5" /></svg>,
  clock: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  trend: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8M15 7h6v6" /></svg>,
  search: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>,
  back: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>,
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
  return { file, error, checked, changed }
}

interface Alert { key: string; tone: 'bad' | 'warn'; text: ReactNode; loc?: string }
function alertsFor(f: ClientFile, today: string): Alert[] {
  const out: Alert[] = []
  for (const p of f.policies) {
    const loc = locKey(p), d = daysUntil(p.expiration, today), what = `${p.product}${p.policy_number ? ` (${p.policy_number})` : ''}`
    const k = (s: string) => `${p.id}:${s}:${p.status}:${p.expiration}`
    if (/cancel/i.test(p.status || '')) out.push({ key: k('cancel'), tone: 'bad', loc, text: <><b>{loc}:</b> {(p.status || '').toUpperCase()} — {what}. Contact your agent right away to keep this coverage.</> })
    else if (d != null && d < 0) out.push({ key: k('expired'), tone: 'bad', loc, text: <><b>{loc}</b> — {what} expired {-d} day{d === -1 ? '' : 's'} ago. Check with your agent that it has renewed.</> })
    else if (d != null && d <= 30) out.push({ key: k('renew'), tone: 'warn', loc, text: <><b>{loc}</b> — {what} renews in {d} day{d === 1 ? '' : 's'} ({mdy(p.expiration!)}).</> })
    if (/action/i.test(p.status || '')) out.push({ key: k('action'), tone: 'bad', loc, text: <><b>{loc}:</b> ACTION NEEDED — {what}. Your agent will reach out with what’s needed, or call us.</> })
    if ((p.amount_due_now || 0) > 0) out.push({ key: k('due'), tone: 'bad', loc, text: <><b>{loc}:</b> {money2(p.amount_due_now!)} due now on {what}.</> })
    const pd = daysUntil(p.payment_due, today)
    if (pd != null && pd >= 0 && pd <= 14) out.push({ key: k('paydue'), tone: 'warn', loc, text: <><b>{loc}:</b> payment due {mdy(p.payment_due!)} on {what}.</> })
  }
  for (const i of f.items.filter((x) => x.kind === 'pending' && x.status === 'open')) {
    out.push({ key: `item:${i.id}:${i.updated_at}`, tone: 'warn', text: <><b>Pending:</b> {i.title}{i.due_on ? ` — due ${mdy(i.due_on)}` : ''}{i.detail ? <span className="cpx-al-d"> {i.detail}</span> : null}</> })
  }
  return out.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'bad' ? -1 : 1))
}

const DISMISS = 'declara_portal_dismissed'
function useDismissed() {
  const [set, setSet] = useState<Set<string>>(() => { try { return new Set(JSON.parse(sessionStorage.getItem(DISMISS) || '[]')) } catch { return new Set() } })
  const dismiss = (k: string) => setSet((s) => { const n = new Set(s); n.add(k); try { sessionStorage.setItem(DISMISS, JSON.stringify([...n])) } catch { /* private window */ } return n })
  return [set, dismiss] as const
}

function Alerts({ list, dismissed, dismiss }: { list: Alert[]; dismissed: Set<string>; dismiss: (k: string) => void }) {
  const shown = list.filter((a) => !dismissed.has(a.key))
  if (!shown.length) return null
  return (
    <div className="cpx-alerts" role="status">{shown.map((a) => (
      <div key={a.key} className={'cpx-al cpx-al-' + a.tone}>
        <span className="cpx-al-t">{a.text}</span>
        <button className="cpx-x" aria-label="Dismiss" onClick={() => dismiss(a.key)}>×</button>
      </div>
    ))}</div>
  )
}

function groupFor(p: ClientPolicy, groups?: PortalGroup[]) {
  const c = (p.carrier || '').toLowerCase()
  const g = groups?.find((x) => x.carriers.some((m) => c.includes(m.toLowerCase())))
  if (g) return { label: g.label, producer: g.producer || null }
  if (/farmers|mid-century|truck insurance/.test(c)) return { label: 'Farmers Insurance', producer: null }
  return { label: p.carrier || 'Other', producer: null }
}

type Sec = 'dash' | 'locs' | 'pols' | 'docs'
const SECS: { key: Sec; label: string; icon: string }[] = [
  { key: 'dash', label: 'Dashboard', icon: 'executive' }, { key: 'locs', label: 'Locations', icon: 'book' },
  { key: 'pols', label: 'Policies', icon: 'reports' }, { key: 'docs', label: 'Documents', icon: 'service' },
]

export default function ClientPortal({ previewAccount, onSignOut, onChangePassword }: { previewAccount?: string; onSignOut?: () => void; onChangePassword?: () => void }) {
  const { file, error, checked, changed } = useLiveFile(previewAccount)
  const [sec, setSec] = useState<Sec>('dash')
  const [loc, setLoc] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [dismissed, dismiss] = useDismissed()
  // a client's portal is always the standard Declara Blue (not whatever theme was last used on this device);
  // a staff preview keeps the staff member's own theme
  useEffect(() => {
    if (previewAccount) return
    const before = getLook()
    applyLook({ theme: 'declara', font: 'normal' })
    return () => applyLook(before)
  }, [previewAccount])
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 5000); return () => clearInterval(t) }, [])
  useEffect(() => { window.scrollTo?.(0, 0) }, [loc, sec])
  const today = todayPacific()

  const view = useMemo(() => {
    if (!file) return null
    const acct = file.accounts[0]
    const addr = new Map(file.accounts.flatMap((a) => a.locations.map((l) => [l.name, l.address] as const)))
    const docsFor = (p: ClientPolicy) => file.documents.filter((d) => d.policy_number && p.policy_number && norm(d.policy_number) === norm(p.policy_number))
    const order = [...new Set([...file.accounts.flatMap((a) => a.locations.map((l) => l.name)), ...file.policies.map(locKey)])]
    const locs = order.map((name) => {
      const ps = file.policies.filter((p) => locKey(p) === name)
      const exp = ps.map((p) => p.expiration).filter((x): x is string => !!x).sort()[0] || null
      return {
        name, address: ps.find((p) => p.location_address)?.location_address || addr.get(name) || '',
        ps, premium: ps.reduce((s, p) => s + (p.premium || 0), 0), next: exp,
        bad: ps.some((p) => tone(p, today) === 'bad'),
        docs: ps.flatMap((p) => docsFor(p).map((d) => ({ d, p }))),
      }
    }).filter((l) => l.ps.length)
    const groups = new Map<string, { label: string; producer: string | null; total: number; count: number }>()
    for (const p of file.policies) { const g = groupFor(p, acct?.portal?.groups); const o = groups.get(g.label) || { ...g, total: 0, count: 0 }; o.total += p.premium || 0; o.count++; groups.set(g.label, o) }
    const byLine = new Map<string, { label: string; total: number; count: number }>()
    for (const p of file.policies) { const k = paying(p); const o = byLine.get(k) || { label: k, total: 0, count: 0 }; o.total += p.premium || 0; o.count++; byLine.set(k, o) }
    const upcoming = file.policies.filter((p) => p.expiration && p.expiration >= today).sort((a, b) => a.expiration!.localeCompare(b.expiration!))
    const matched = new Set(file.policies.flatMap((p) => docsFor(p).map((d) => d.id)))
    return {
      acct, locs, docsFor, groups: [...groups.values()].sort((a, b) => b.total - a.total), byLine: [...byLine.values()].sort((a, b) => b.total - a.total),
      upcoming, alerts: alertsFor(file, today), total: file.policies.reduce((s, p) => s + (p.premium || 0), 0),
      inForce: file.policies.filter((p) => tone(p, today) !== 'bad' || /action/i.test(p.status || '')).length,
      pending: file.items.filter((i) => i.kind === 'pending' && i.status === 'open'),
      updates: file.items.filter((i) => i.kind === 'update' || i.status === 'done').sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6),
      loose: file.documents.filter((d) => !matched.has(d.id)),
    }
  }, [file, today])

  const box = (msg: string) => <div className="cpx cpx-solo"><div className="cpx-wrap"><div className="cpx-card cpx-pad">{msg}</div></div></div>
  if (error && !file) return box('We couldn’t load your file just now. Please refresh, or contact your agent.')
  if (file === undefined) return box('Opening your file…')
  if (!file || !view) return box('No client file is set up for this login yet. Please contact your agent.')

  const agency = file.agency?.name || 'Your agency'
  const fresh = !!changed && Date.now() - Date.parse(changed) < 60000
  const openLoc = (name: string) => { setSec('locs'); setLoc(name) }
  const goSec = (k: Sec) => { setSec(k); setLoc(null) }
  const open = sec === 'locs' && loc ? view.locs.find((l) => l.name === loc) : null
  const ql = q.trim().toLowerCase()
  const shown = ql ? view.locs.filter((l) => `${l.name} ${l.address} ${l.ps.map((p) => `${p.policy_number} ${p.carrier} ${p.product}`).join(' ')}`.toLowerCase().includes(ql)) : view.locs
  const live = (
    <span className={'cpx-live' + (fresh ? ' cpx-live-new' : '')} role="status" aria-live="polite" title={checked ? `Checked ${timeAgo(checked)}` : ''}>
      <span className="cpx-dot" />{fresh ? 'Just updated' : 'Live'}{file.updated_at && <small> · updated {timeAgo(file.updated_at)}</small>}
    </span>
  )
  const name = view.acct?.dba || view.acct?.name || ''
  const first = (file.viewer.display_name || view.acct?.contact || '').split(' ')[0]

  const body = (
    <div className="cpx cpx-themed">
      <div className="cpx-wrap">
        {sec === 'dash' && <>
          <PageHead kicker={name} title={first ? `Welcome, ${first}` : 'Your insurance'} sub={`Every policy, location and renewal you have with ${agency} — updated live as your agent works on it.`} right={live} />
          <Alerts list={view.alerts} dismissed={dismissed} dismiss={dismiss} />
          <Tiles>
            <Tile label="Annual premium" value={money0(view.total)} sub={`${file.policies.length} policies on file`} />
            <Tile label="Locations" value={view.locs.length} sub={`${view.locs.filter((l) => l.bad).length || 'none'} need${view.locs.filter((l) => l.bad).length === 1 ? 's' : ''} attention`} tone={view.locs.some((l) => l.bad) ? 'warn' : 'good'} />
            <Tile label="Next renewal" value={view.upcoming[0] ? `${daysUntil(view.upcoming[0].expiration, today)} days` : '—'} sub={view.upcoming[0] ? `${locKey(view.upcoming[0])} · ${mdy(view.upcoming[0].expiration!)}` : ''} />
            <Tile label="Pending items" value={view.pending.length} sub={view.pending.length ? 'see alerts above' : 'nothing waiting on you'} tone={view.pending.length ? 'warn' : 'good'} />
          </Tiles>
          <div className="cpx-two">
            <Panel title="Carrier totals" sub="Annual premium by carrier, with your producer">
              {view.groups.map((g) => (
                <div key={g.label} className="cpx-ct">
                  <div><b>{g.label}</b><small>{g.producer ? <>Producer: <span>{g.producer}</span> · </> : null}{g.count} polic{g.count === 1 ? 'y' : 'ies'}</small></div>
                  <b className="cpx-amt">{money2(g.total)}</b>
                </div>
              ))}
            </Panel>
            <Panel title="Next renewals" sub="Coming up first">
              {view.upcoming.length ? view.upcoming.slice(0, 6).map((p) => (
                <button key={p.id} className="cpx-nr" onClick={() => openLoc(locKey(p))} title={`${p.product} · ${mdy(p.expiration!)}`}>
                  <span>{locKey(p)}<small>{p.product} · {mdy(p.expiration!)}</small></span><b>{daysUntil(p.expiration, today)}d</b>
                </button>
              )) : <div className="cpx-muted">Nothing renewing soon.</div>}
            </Panel>
          </div>
          <div className="cpx-two cpx-two-even">
            <Panel title="Spend by location" sub={`Annual premium · ${money0(view.total)} across ${view.locs.length} locations`}>
              <Bars rows={[...view.locs].sort((a, b) => b.premium - a.premium).map((l) => ({ key: l.name, label: l.name, value: l.premium, note: `${l.ps.length} polic${l.ps.length === 1 ? 'y' : 'ies'}`, onClick: () => openLoc(l.name), bad: l.bad }))} total={view.total} />
            </Panel>
            <Panel title="Spend by coverage" sub="What you pay for, across every location">
              <Bars rows={view.byLine.map((g) => ({ key: g.label, label: g.label, value: g.total, note: `${g.count} polic${g.count === 1 ? 'y' : 'ies'}` }))} total={view.total} />
            </Panel>
          </div>
          {(view.pending.length > 0 || view.updates.length > 0) && (
            <Panel title="From your agent" sub="Things pending and recent updates on your file">
              {view.pending.map((i) => <Update key={i.id} i={i} />)}
              {view.updates.map((i) => <Update key={i.id} i={i} />)}
            </Panel>
          )}
        </>}

        {sec === 'locs' && !open && <>
          <PageHead kicker={name} title="Locations" sub="Every location with its coverages, premium and next renewal. Click one for its policies and documents." right={live} />
          <Alerts list={view.alerts} dismissed={dismissed} dismiss={dismiss} />
          <div className="cpx-lh">
            <h2>Locations ({view.locs.length})</h2>
            <label className="cpx-search">{I.search}<input placeholder="Search location, policy #, carrier…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search locations" /></label>
          </div>
          <div className="cpx-grid">
            {shown.map((l) => {
              const r = renewIn(l.next, today)
              return (
                <article key={l.name} className={'cpx-loc' + (l.bad ? ' cpx-loc-bad' : '')}>
                  <button className="cpx-loc-open" onClick={() => setLoc(l.name)} aria-label={`Open ${l.name}`}>
                    <div className="cpx-loc-h">
                      <span className="cpx-ic">{I.building}</span>
                      <div className="cpx-loc-n"><b>{l.name}</b><small>{l.address}</small></div>
                      {l.bad && <span className="cpx-warn" title="Needs attention">{I.warn}</span>}
                    </div>
                    <div className="cpx-chips">{l.ps.map((p) => <Chip key={p.id} p={p} today={today} />)}</div>
                    <div className="cpx-loc-f">
                      <div><small>Annual premium</small><b>{money2(l.premium)}</b></div>
                      <div className="r"><small>Next renewal</small>{r && <b className={r.bad ? 'cpx-bad' : 'cpx-good'}>{r.text}</b>}</div>
                    </div>
                  </button>
                  {l.docs.map(({ d, p }) => <button key={d.id} className="cpx-dl" onClick={() => openClientDoc(d, true)}>{I.down}Download {docWord(d, p)}</button>)}
                </article>
              )
            })}
            {!shown.length && <div className="cpx-muted">No locations match.</div>}
          </div>
        </>}
        {open && <LocationView l={open} today={today} alerts={view.alerts.filter((a) => a.loc === open.name)} dismissed={dismissed} dismiss={dismiss} docsFor={view.docsFor} onBack={() => setLoc(null)} />}

        {sec === 'pols' && <>
          <PageHead kicker={name} title="Policies" sub="Every policy on file. Click one to open its location." right={live} />
          <Panel title={`All policies (${file.policies.length})`} sub={`${money0(view.total)} annual premium`}>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Location</th><th>Coverage</th><th>Carrier</th><th>Policy #</th><th>Term</th><th className="r">Premium</th><th>Status</th></tr></thead>
              <tbody>{[...file.policies].sort((a, b) => locKey(a).localeCompare(locKey(b)) || (a.product || '').localeCompare(b.product || '')).map((p) => (
                <tr key={p.id} className="clickable" onClick={() => openLoc(locKey(p))}>
                  <td><b>{locKey(p)}</b></td><td>{p.product}</td><td className="sub">{p.carrier}</td><td className="mono">{p.policy_number}</td>
                  <td className="sub">{p.effective ? mdy(p.effective) : '—'} – {p.expiration ? mdy(p.expiration) : '—'}</td>
                  <td className="r mono">{p.premium != null ? money2(p.premium) : '—'}</td>
                  <td><span className={'cpx-st cpx-st-' + tone(p, today)}><i />{statusLabel(p, today)}</span></td>
                </tr>
              ))}</tbody>
            </table></div>
          </Panel>
        </>}

        {sec === 'docs' && <>
          <PageHead kicker={name} title="Documents" sub="Declarations pages, binders, WC info pages and certificates your agent has filed." right={live} />
          <Panel title={`Documents (${file.documents.length})`} sub="Open or download any of them">
            {file.documents.length ? view.locs.filter((l) => l.docs.length).map((l) => (
              <div key={l.name} className="cpx-doc-g"><div className="cpx-h cpx-h-sm">{l.name}</div>
                {l.docs.map(({ d, p }) => <button key={d.id} className="cpx-dl cpx-dl-row" onClick={() => openClientDoc(d, true)}>{I.down}{p.product} · {docWord(d, p)}<small>{mdy(d.created_at.slice(0, 10))}</small></button>)}
              </div>
            )).concat(view.loose.length ? [<div key="_other" className="cpx-doc-g"><div className="cpx-h cpx-h-sm">Other documents</div>{view.loose.map((d) => <button key={d.id} className="cpx-dl cpx-dl-row" onClick={() => openClientDoc(d, true)}>{I.down}{d.title}</button>)}</div>] : [])
              : <div className="cpx-muted">No documents filed yet — they’ll appear here as soon as your agent adds them.</div>}
          </Panel>
        </>}
        <footer className="cpx-foot">Questions about your coverage? Contact {agency}.<small>{COPYRIGHT}</small></footer>
      </div>
    </div>
  )

  if (previewAccount) {
    return <>
      <div className="cpx-band">Preview — exactly what <b>{file.viewer.display_name || view.acct?.name}</b> sees when they sign in (inside their own Declara screen). Your internal notes never appear here.</div>
      <Tabs tabs={SECS.map((x) => ({ key: x.key, label: x.label }))} value={sec} onChange={goSec} />
      {body}
    </>
  }
  return <ClientShell name={name} who={file.viewer.display_name || ''} sec={sec} onSec={goSec} onSignOut={onSignOut} onChangePassword={onChangePassword}>{body}</ClientShell>
}

/** The client's own Declara screen: the same sidebar and top bar as the staff app, with only their sections. */
function ClientShell({ name, who, sec, onSec, onSignOut, onChangePassword, children }: { name: string; who: string; sec: Sec; onSec: (k: Sec) => void; onSignOut?: () => void; onChangePassword?: () => void; children: ReactNode }) {
  const [drawer, setDrawer] = useState(false)
  const [menu, setMenu] = useState(false)
  const [theme, setTheme] = useState(getLook().theme)
  useEffect(() => onLook((l) => setTheme(l.theme)), [])
  const initials = who.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase() || '?'
  const go = (k: Sec) => { onSec(k); setDrawer(false) }
  const img = theme === 'halloween' ? logoHalloween : logo
  return (
    <div className="shell">
      {drawer && <div className="side-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />}
      <aside className={'side' + (drawer ? ' open' : '')} id="side-nav">
        <div className="side-brand">
          <div className="brand-tile"><img className="brand-logo" src={img} alt="Declara" /></div>
          <p className="side-for">For</p>
          <p className="side-sub">{name}</p>
        </div>
        <nav className="nav">
          <div className="nav-h">Your insurance</div>
          {SECS.map((x) => <button key={x.key} className={sec === x.key ? 'active' : ''} onClick={() => go(x.key)}><Icon name={x.icon} /><span>{x.label}</span></button>)}
        </nav>
        <div className="side-foot">
          {onSignOut && <button className="logout" onClick={onSignOut} title="Sign out"><Icon name="logout" width={1.5} /><span>Sign Out</span></button>}
          <div className="copy-note side-copy">{COPYRIGHT}</div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button className="hd-burger" aria-label="Menu" aria-controls="side-nav" aria-expanded={drawer} onClick={() => setDrawer(!drawer)}><span /><span /><span /></button>
          <img className="hd-logo" src={img} alt="Declara" />
          <div className="gsearch-none" />
          <div className="hd-right">
            <div className="hd-user">
              <span className="hd-av" role="button" tabIndex={0} aria-label="Account menu" onClick={() => setMenu(!menu)} onKeyDown={(e) => e.key === 'Enter' && setMenu(!menu)}>{initials}</span>
              <span className="hd-un"><b>{who || 'Signed in'}</b><em>Client</em></span>
              <button className="hd-chev" aria-label="Account menu" onClick={() => setMenu(!menu)}><Icon name="chev" width={2} /></button>
              {menu && (
                <div className="hd-menu" onMouseLeave={() => setMenu(false)}>
                  {onChangePassword && <button onClick={() => { setMenu(false); onChangePassword() }}>Change password</button>}
                  {onSignOut && <button onClick={onSignOut}>Sign out</button>}
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="page">{children}</main>
      </div>
    </div>
  )
}

/** A labelled bar per row, longest first: one measure (annual premium), so one color; amounts and shares are text. */
function Bars({ rows, total }: { rows: { key: string; label: string; value: number; note?: string; onClick?: () => void; bad?: boolean }[]; total: number }) {
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <div className="cpx-bars">{rows.map((r) => {
      const inner = <>
        <span className="cpx-bar-l"><b>{r.label}{r.bad && <span className="cpx-warn cpx-warn-sm" title="Needs attention">{I.warn}</span>}</b>{r.note && <small>{r.note}</small>}</span>
        <span className="cpx-bar-t"><i style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></span>
        <span className="cpx-bar-v"><b>{money0(r.value)}</b><small>{total ? Math.round((r.value / total) * 100) : 0}%</small></span>
      </>
      const tip = `${r.label}: ${money2(r.value)} · ${total ? Math.round((r.value / total) * 100) : 0}% of your premium`
      return r.onClick ? <button key={r.key} className="cpx-bar cpx-bar-btn" title={tip} onClick={r.onClick}>{inner}</button> : <div key={r.key} className="cpx-bar" title={tip}>{inner}</div>
    })}</div>
  )
}

function Chip({ p, today }: { p: ClientPolicy; today: string }) {
  const wc = isWc(p), t = tone(p, today)
  return <span className={'cpx-chip' + (wc ? ' cpx-chip-wc' : '')} title={`${p.product} · ${statusLabel(p, today)}`}>{wc ? I.hat : I.shield}{chip(p)}<i className={'cpx-d cpx-d-' + t} /></span>
}

function Update({ i }: { i: ClientItem }) {
  const done = i.status === 'done'
  return (
    <div className="cpx-u">
      <span className={'cpx-pill ' + (done ? 'cpx-pill-good' : 'cpx-pill-mut')}>{done ? 'Done' : 'Update'}</span>
      <div><b>{i.title}</b>{i.detail && <small>{i.detail}</small>}</div>
      <small className="cpx-u-w">{done && i.done_at ? timeAgo(i.done_at) : timeAgo(i.created_at)}</small>
    </div>
  )
}

interface Loc { name: string; address: string; ps: ClientPolicy[]; premium: number; docs: { d: ClientDoc; p: ClientPolicy }[] }
function LocationView({ l, today, alerts, dismissed, dismiss, docsFor, onBack }: { l: Loc; today: string; alerts: Alert[]; dismissed: Set<string>; dismiss: (k: string) => void; docsFor: (p: ClientPolicy) => ClientDoc[]; onBack: () => void }) {
  const wcDocs = l.docs.filter((x) => x.d.category === 'wc')
  const combined = l.ps.some((p) => chip(p) === 'GL/Property')
  return (
    <>
      <button className="cpx-back" onClick={onBack}>{I.back}All locations</button>
      <div className="cpx-lv-h">
        <div><h1>{l.name}</h1><div className="cpx-addr">{I.pin}{l.address}</div></div>
        <div className="cpx-lv-r">
          {wcDocs.map(({ d }) => <button key={d.id} className="cpx-dl cpx-dl-inline" onClick={() => openClientDoc(d, true)}>{I.down}Download WC info page (PDF)</button>)}
          <div className="cpx-comb"><small>Combined annual premium</small><b>{money2(l.premium)}</b></div>
        </div>
      </div>
      <section className="cpx-card">
        <div className="cpx-h cpx-h-sm">What you’re paying for</div>
        {l.ps.map((p) => <div key={p.id} className="cpx-pay"><span>{paying(p)}</span><b>{p.premium != null ? money2(p.premium) : '—'}</b></div>)}
        {combined && <small className="cpx-muted">Property and GL are written on one combined policy here — the carrier hasn’t broken out the two premiums separately.</small>}
      </section>
      <Alerts list={alerts} dismissed={dismissed} dismiss={dismiss} />
      <div className="cpx-pols">{l.ps.map((p) => <PolicyCard key={p.id} p={p} today={today} docs={docsFor(p)} />)}</div>
    </>
  )
}

function PolicyCard({ p, today, docs }: { p: ClientPolicy; today: string; docs: ClientDoc[] }) {
  const wc = isWc(p)
  const [tab, setTab] = useState<'sum' | 'pay' | 'wc'>('sum')
  const t = tone(p, today), r = renewIn(p.expiration, today)
  const wcDocs = docs.filter((d) => d.category === 'wc')
  const F = ({ k, children }: { k: string; children: ReactNode }) => <div className="cpx-f"><small>{k}</small><div>{children}</div></div>
  return (
    <section className="cpx-card cpx-pc">
      <div className="cpx-pc-h">
        <span className="cpx-ic cpx-ic-dark">{wc ? I.hat : I.shield}</span>
        <div className="cpx-pc-n"><b>{p.product}</b><small className="mono">{p.policy_number}</small></div>
        {docs[0] && <button className="cpx-ib" aria-label={`Download ${docWord(docs[0], p)}`} title={`Download ${docWord(docs[0], p)}`} onClick={() => openClientDoc(docs[0], true)}>{I.down}</button>}
        <span className={'cpx-st cpx-st-' + t}><i />{statusLabel(p, today).toUpperCase()}</span>
      </div>
      <div className="cpx-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'sum'} className={tab === 'sum' ? 'on' : ''} onClick={() => setTab('sum')}>Summary</button>
        <button role="tab" aria-selected={tab === 'pay'} className={tab === 'pay' ? 'on' : ''} onClick={() => setTab('pay')}>Payment</button>
        {wc && <button role="tab" aria-selected={tab === 'wc'} className={tab === 'wc' ? 'on' : ''} onClick={() => setTab('wc')}>WC info</button>}
      </div>
      {tab === 'sum' && (
        <div className="cpx-fs">
          <F k="Carrier">{p.carrier || '—'}</F>
          <F k="Coverage type">{p.coverage || p.product || '—'}</F>
          <F k="Effective">{p.effective ? mdy(p.effective) : '—'}</F>
          <F k="Expiration">{p.expiration ? mdy(p.expiration) : '—'} {r && <b className={r.bad ? 'cpx-bad' : 'cpx-good'}>{r.text}</b>}</F>
          <F k="Annual premium">{p.premium != null ? money2(p.premium) : '—'}</F>
          <F k="Invoice #">{p.invoice_number || '—'}</F>
        </div>
      )}
      {tab === 'pay' && (
        <div className="cpx-fs">
          <F k="Payment status">{tidy(p.payment_status || p.status)}</F>
          <F k="Premium financed">{p.financed ? 'Yes — through a premium finance company' : 'No'}</F>
          <F k="Due now">{(p.amount_due_now || 0) > 0 ? <b className="cpx-bad">{money2(p.amount_due_now!)}</b> : 'Nothing due now'}</F>
          {p.payment_plan && <F k="Payment plan">{[p.payment_plan, p.payment_method].filter(Boolean).join(' · ')}</F>}
          {p.payment_due && <F k="Next payment due">{mdy(p.payment_due)}</F>}
        </div>
      )}
      {tab === 'wc' && (
        <div className="cpx-wcd">
          {wcDocs.length ? wcDocs.map((d) => <button key={d.id} className="cpx-dl cpx-dl-row" onClick={() => openClientDoc(d, true)}>{I.down}{d.title}</button>)
            : <span className="cpx-muted">The WC info page isn’t on file yet — it will appear here as soon as your agent adds it.</span>}
        </div>
      )}
    </section>
  )
}
