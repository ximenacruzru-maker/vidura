import { useEffect, useMemo, useRef, useState } from 'react'
import { money0 } from '../../lib/perf/executive'
import { change, type Drill, type Group, type SoldPolicy, type Sum } from '../../lib/perf/yoy'
import { downloadYoyExcel } from '../../lib/perf/yoyExcel'

type Col = 'day' | 'customer' | 'number' | 'type' | 'carrier' | 'producer' | 'premium'
const COLS: [Col, string][] = [['day', 'Sold'], ['customer', 'Customer'], ['number', 'Policy #'], ['type', 'Line'], ['carrier', 'Carrier'], ['producer', 'Producer'], ['premium', 'Premium']]
const day = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const pctOf = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(0) + '%' : '—')

/** Everything behind one period: this year against the same dates last year — totals, new customers against
 *  policies added to existing ones, by producer, line and carrier, and every sold policy. */
export default function YoyDrill({ d, year, onClose }: { d: Drill; year: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [who, setWho] = useState<string | null>(null)
  const [side, setSide] = useState<'now' | 'prior'>(d.now ? 'now' : 'prior')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ col: Col; asc: boolean }>({ col: 'day', asc: false })
  useEffect(() => { setWho(null); setSide(d.now ? 'now' : 'prior'); setQ(''); ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [d.range, d.now])

  const N = d.now, P = d.prior
  // the policies shown for one year: the picked producer and search, in the chosen order
  const shown = useMemo(() => (src: SoldPolicy[]) => {
    const t = q.trim().toLowerCase()
    const xs = src.filter((x) => (!who || x.producer === who) && (!t || `${x.customer} ${x.number} ${x.type} ${x.carrier} ${x.producer}`.toLowerCase().includes(t)))
    const k = sort.col, dir = sort.asc ? 1 : -1
    return [...xs].sort((a, b) => (k === 'premium' ? a.premium - b.premium : String(a[k] || '').localeCompare(String(b[k] || ''))) * dir || (a.day < b.day ? 1 : -1))
  }, [who, q, sort])
  const list = useMemo(() => shown((side === 'now' ? N?.rows : P.rows) || []), [shown, side, N, P])
  const [saving, setSaving] = useState<string | null>(null)
  const listSum = list.reduce((s, x) => s + x.premium, 0)
  
  const excel = async () => {
    setSaving('Preparing…')
    try { await downloadYoyExcel(d, year, { now: N ? shown(N.rows) : null, prior: shown(P.rows) }, who); setSaving(null) }
    catch (e) { setSaving('Download failed: ' + String((e as Error)?.message || e)) }
  }

  return (
    <div className="panel yoy-drill" ref={ref}>
      <div className="panel-h">
        <div><div className="panel-t">{d.label}: what was sold</div><div className="panel-s">{d.range}{who ? ' · ' + who : ''}</div></div>
        <button className="yoy-x" onClick={onClose} aria-label="Close the breakdown">Close ✕</button>
      </div>
      <div className="panel-b">
        <div className="yoy-tiles">
          <Tile label="Premium" now={N && money0(N.sum.premium)} prior={money0(P.sum.premium)} chg={N && change(N.sum.premium, P.sum.premium)} up={!!N && N.sum.premium >= P.sum.premium} year={year} />
          <Tile label="Policies" now={N && String(N.sum.policies)} prior={String(P.sum.policies)} chg={N && change(N.sum.policies, P.sum.policies)} up={!!N && N.sum.policies >= P.sum.policies} year={year} />
          <Tile label="Average premium" now={N && money0(avg(N.sum))} prior={money0(avg(P.sum))} chg={N && change(avg(N.sum), avg(P.sum))} up={!!N && avg(N.sum) >= avg(P.sum)} year={year} />
          <Tile label="Customers" now={N && String(N.customers)} prior={String(P.customers)} chg={N && change(N.customers, P.customers)} up={!!N && N.customers >= P.customers} year={year} sub={N ? `${(N.sum.policies / Math.max(1, N.customers)).toFixed(2)} policies each` : undefined} />
          <Tile label="New customers" now={N && money0(N.fresh.premium)} prior={`${money0(P.fresh.premium)} (${P.fresh.policies})`} chg={N && change(N.fresh.premium, P.fresh.premium)} up={!!N && N.fresh.premium >= P.fresh.premium} year={year} sub={N ? `${N.fresh.policies} policies · ${pctOf(N.fresh.premium, N.sum.premium)} of premium` : undefined} />
          <Tile label="Added to existing" now={N && money0(N.added.premium)} prior={`${money0(P.added.premium)} (${P.added.policies})`} chg={N && change(N.added.premium, P.added.premium)} up={!!N && N.added.premium >= P.added.premium} year={year} sub={N ? `${N.added.policies} policies · ${pctOf(N.added.premium, N.sum.premium)} of premium` : undefined} />
          <Tile label="Cancelled since" now={N && money0(N.cancelled.premium)} prior={`${money0(P.cancelled.premium)} (${P.cancelled.policies})`} chg={null} up year={year} sub={N ? `${N.cancelled.policies} policies · ${pctOf(N.cancelled.policies, N.sum.policies)} of policies` : undefined} />
        </div>

        <div className="yoy-groups">
          <Groups title="By producer" sub="Click a producer to see only their policies" rows={d.byProducer} year={year} hasNow={!!N} pick={who} onPick={(k) => setWho(who === k ? null : k)} totalNow={N?.sum.premium || 0} totalPrior={P.sum.premium} />
          <Groups title="By line" rows={d.byType} year={year} hasNow={!!N} totalNow={N?.sum.premium || 0} totalPrior={P.sum.premium} />
          <Groups title="By carrier" rows={d.byCarrier} year={year} hasNow={!!N} totalNow={N?.sum.premium || 0} totalPrior={P.sum.premium} />
        </div>

        <div className="yoy-list-h">
          <div className="segt" role="group" aria-label="Year">
            {N && <button className={'segt-b' + (side === 'now' ? ' on' : '')} onClick={() => setSide('now')}>{year} · {N.sum.policies}</button>}
            <button className={'segt-b' + (side === 'prior' ? ' on' : '')} onClick={() => setSide('prior')}>{year - 1} · {P.sum.policies}</button>
          </div>
          {who && <button className="yoy-chip" onClick={() => setWho(null)}>{who} ✕</button>}
          <input className="f yoy-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a customer, policy #, line…" aria-label="Find a policy" />
          <span className="yoy-count">{list.length} {list.length === 1 ? 'policy' : 'policies'} · {money0(listSum)}</span>
          <button className="yoy-csv" onClick={excel} disabled={saving === 'Preparing…' || !(N?.rows.length || P.rows.length)} title="Excel workbook: a summary sheet and a sheet of policies for each year, colour-coded">{saving === 'Preparing…' ? saving : 'Download Excel'}</button>
          {saving && saving !== 'Preparing…' && <span className="yoy-count" role="alert">{saving}</span>}
        </div>
        <div className="yoy-list">
          <table className="yoy-tbl yoy-pol">
            <thead><tr>{COLS.map(([k, l]) => (
              <th key={k} className={k === 'premium' ? 'tr' : ''} aria-sort={sort.col === k ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
                <button className="yoy-sort" onClick={() => setSort({ col: k, asc: sort.col === k ? !sort.asc : k !== 'day' && k !== 'premium' })}>{l}{sort.col === k ? (sort.asc ? ' ▲' : ' ▼') : ''}</button>
              </th>))}</tr></thead>
            <tbody>{list.map((x, i) => <PolicyRow key={x.id || i} x={x} />)}</tbody>
          </table>
          {!list.length && <div className="empty">No policies {who || q ? 'match' : 'sold in this period'}.</div>}
        </div>
        <div className="mix-note">A new customer is one whose first AgencyZoom policy was sold that day; anything else is a policy added to an existing customer. Premium is each policy's current premium in AgencyZoom.</div>
      </div>
    </div>
  )
}

const avg = (s: Sum) => (s.policies ? s.premium / s.policies : 0)
const azUrl = (cid: string) => `https://app.agencyzoom.com/customer/index?id=${encodeURIComponent(cid)}`

function Tile({ label, now, prior, chg, up, year, sub }: { label: string; now: string | null; prior: string; chg: string | null; up: boolean; year: number; sub?: string }) {
  return (
    <div className="yoy-tile">
      <div className="yoy-tl">{label}</div>
      <div className="yoy-tv">{now ?? '—'}</div>
      <div className="yoy-tp">{year - 1}: {prior}{chg && chg !== '—' && <span className={up ? 'yoy-up' : 'yoy-down'}> {chg}</span>}</div>
      {sub && <div className="yoy-sub">{sub}</div>}
    </div>
  )
}

function Groups({ title, sub, rows, year, hasNow, pick, onPick, totalNow, totalPrior }: {
  title: string; sub?: string; rows: Group[]; year: number; hasNow: boolean; pick?: string | null; onPick?: (k: string) => void; totalNow: number; totalPrior: number
}) {
  const top = Math.max(1, ...rows.map((g) => Math.max(g.now.premium, g.prior.premium)))
  return (
    <div className="yoy-group">
      <div className="yoy-gh"><div className="yoy-gt">{title}</div>{sub && <div className="yoy-sub">{sub}</div>}</div>
      <table className="yoy-tbl yoy-gtbl">
        <thead><tr><th></th>{hasNow && <th className="tr">{year}</th>}<th className="tr">{year - 1}</th>{hasNow && <th className="tr">Change</th>}</tr></thead>
        <tbody>{rows.map((g) => {
          const on = pick === g.key
          return (
            <tr key={g.key} className={(onPick ? 'yoy-row' : '') + (on ? ' on' : '')} {...(onPick ? { tabIndex: 0, onClick: () => onPick(g.key), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(g.key) } } } : {})}>
              <td><div className="yoy-gk">{g.key}</div>
                <div className="yoy-gbar"><i className="yoy-b-now" style={{ width: (g.now.premium / top) * 100 + '%' }} /><i className="yoy-b-prior" style={{ width: (g.prior.premium / top) * 100 + '%' }} /></div></td>
              {hasNow && <td className="tr mono">{money0(g.now.premium)}<div className="yoy-sub">{g.now.policies} · {pctOf(g.now.premium, totalNow)}</div></td>}
              <td className="tr mono">{money0(g.prior.premium)}<div className="yoy-sub">{g.prior.policies} · {pctOf(g.prior.premium, totalPrior)}</div></td>
              {hasNow && <td className={'tr mono ' + (g.now.premium >= g.prior.premium ? 'yoy-up' : 'yoy-down')}>{change(g.now.premium, g.prior.premium)}</td>}
            </tr>
          )
        })}</tbody>
      </table>
      {!rows.length && <div className="empty">Nothing sold.</div>}
    </div>
  )
}

function PolicyRow({ x }: { x: SoldPolicy }) {
  return (
    <tr>
      <td className="mono nowrap">{day(x.day)}</td>
      <td>{x.cid ? <a href={azUrl(x.cid)} target="_blank" rel="noreferrer">{x.customer || 'Customer ' + x.cid} ↗</a> : x.customer || '—'}
        {x.isNew && <span className="yoy-badge yoy-new">New</span>}{x.cancelled && <span className="yoy-badge yoy-canc">Cancelled</span>}</td>
      <td className="mono">{x.number || '—'}</td>
      <td>{x.type || '—'}</td>
      <td>{x.carrier || '—'}</td>
      <td>{x.producer}</td>
      <td className="tr mono">{money0(x.premium)}</td>
    </tr>
  )
}
