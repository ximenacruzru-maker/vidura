// HR › Vendors & subscriptions (owner and admins): every lead vendor, software subscription and service the agency pays
// for — monthly and yearly totals, what renews soon, and each contract on file. VendorSummary is the owner's view of it
// on the Executive Dashboard.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth'
import { Empty, ErrorBox, Loading, Panel, Tile, Tiles } from '../../components/ui'
import { BILLING_LABEL, KIND_LABEL, getVendors, perMonth, removeVendor, saveVendor, type Billing, type Kind, type Vendor } from '../../lib/vendors'
import { getFiles, openFile, uploadFile } from '../../lib/compliance'
import { mdy, money0, money2, todayPacific } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'

const days = (iso: string, today: string) => Math.round((Date.parse(iso) - Date.parse(today)) / 86400000)
const PER: Record<Billing, string> = { monthly: '/ month', quarterly: '/ quarter', yearly: '/ year', one_time: 'one-time' }
const BLANK: Partial<Vendor> = { name: '', kind: 'software', billing: 'monthly', active: true }

export default function Vendors() {
  const { me } = useAuth()
  const [reload, setReload] = useState(0)
  const { data, error } = useAsync(async () => { const [vendors, files] = await Promise.all([getVendors(), getFiles()]); return { vendors, files: files.filter((f) => f.vendor_id) } }, [reload])
  const [edit, setEdit] = useState<Partial<Vendor> | null>(null)
  const [busy, setBusy] = useState(false)
  if (error) return <ErrorBox error={error} />
  if (!data) return <Loading what="Loading vendors" />
  const today = todayPacific()
  const live = data.vendors.filter((v) => v.active)
  const month = live.reduce((t, v) => t + perMonth(v), 0)
  const soon = live.filter((v) => v.renews_on && days(v.renews_on, today) <= 30)
  const byKind = (k: Kind) => live.filter((v) => v.kind === k).reduce((t, v) => t + perMonth(v), 0)
  const refresh = () => setReload((n) => n + 1)
  const save = async () => {
    if (!edit?.name?.trim()) { alert('Give the vendor a name.'); return }
    setBusy(true)
    try { await saveVendor(edit as Vendor); setEdit(null); refresh() } catch (e) { alert(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const attach = async (v: Vendor, list: FileList | null) => {
    if (!list?.length || !me?.agency_id) return
    for (const f of Array.from(list)) {
      try {
        await uploadFile(me.agency_id, f, { scope: 'agency', doc_type: 'vendor', note: v.name, vendor_id: v.id })
      } catch (e) { alert(`${f.name}: ${e instanceof Error ? e.message : String(e)}`) }
    }
    refresh()
  }
  return (
    <>
      <Tiles>
        <Tile label="Paid per month" value={money0(month)} sub={`${live.length} active vendors · ${money0(month * 12)} a year`} />
        <Tile label="Lead vendors" value={money0(byKind('lead'))} sub="per month" />
        <Tile label="Software" value={money0(byKind('software'))} sub="per month" />
        <Tile label="Renewing in 30 days" value={soon.length} sub={soon.map((v) => v.name).join(', ') || 'none'} tone={soon.length ? 'warn' : 'good'} />
      </Tiles>
      <Panel title="Vendors & subscriptions" sub="Every lead vendor, software subscription and service the agency pays for. Owner and admins only." right={<button className="btn-primary" onClick={() => setEdit({ ...BLANK })}>+ Add vendor</button>}>
        {edit && (
          <div className="plan">
            <div className="form-grid">
              <label>Vendor<input className="fld" value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Media Alpha, AgencyZoom" /></label>
              <label>Type<select className="fld" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as Kind })}>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label>What it’s for<input className="fld" value={edit.purpose || ''} onChange={(e) => setEdit({ ...edit, purpose: e.target.value })} placeholder="e.g. auto leads, CRM, rater" /></label>
              <label>Cost<input className="fld" type="number" min="0" step="0.01" value={edit.cost ?? ''} onChange={(e) => setEdit({ ...edit, cost: e.target.value === '' ? null : Number(e.target.value) })} /></label>
              <label>Billed<select className="fld" value={edit.billing} onChange={(e) => setEdit({ ...edit, billing: e.target.value as Billing })}>{Object.entries(BILLING_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label>Renews on<input className="fld" type="date" value={edit.renews_on || ''} onChange={(e) => setEdit({ ...edit, renews_on: e.target.value || null })} /></label>
              <label>Started<input className="fld" type="date" value={edit.started_on || ''} onChange={(e) => setEdit({ ...edit, started_on: e.target.value || null })} /></label>
              <label>Website / login page<input className="fld" value={edit.url || ''} onChange={(e) => setEdit({ ...edit, url: e.target.value })} placeholder="https://" /></label>
              <label>Note<input className="fld" value={edit.note || ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} placeholder="e.g. per-lead price, cancel notice" /></label>
              <label className="cf-check"><input type="checkbox" checked={edit.active ?? true} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Still paying for it</label>
            </div>
            <div className="row-actions" style={{ marginTop: 10 }}><button className="btn-primary" disabled={busy} onClick={save}>{edit.id ? 'Save' : 'Add vendor'}</button><button className="btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
              {edit.id && (me?.role === 'owner' || me?.role === 'admin') && <button className="linkbtn cf-del" onClick={async () => { if (confirm(`Remove ${edit.name}? Its contracts stay in Agency legal & tax.`)) { await removeVendor(edit.id!); setEdit(null); refresh() } }}>Remove</button>}</div>
          </div>
        )}
        {data.vendors.length ? (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Vendor</th><th>Type</th><th className="r">Cost</th><th className="r">Per month</th><th>Renews</th><th>Contract</th><th></th></tr></thead>
            <tbody>{data.vendors.map((v) => {
              const docs = data.files.filter((f) => f.vendor_id === v.id)
              const d = v.renews_on ? days(v.renews_on, today) : null
              return (
                <tr key={v.id} className={v.active ? '' : 'cf-off'}>
                  <td><div className="strong">{v.url ? <a href={v.url} target="_blank" rel="noreferrer">{v.name}</a> : v.name}</div><div className="sub">{[v.purpose, v.note, v.active ? '' : 'no longer paying'].filter(Boolean).join(' · ')}</div></td>
                  <td>{KIND_LABEL[v.kind]}</td>
                  <td className="r mono">{v.cost != null ? `${money2(v.cost)} ${PER[v.billing]}` : '—'}</td>
                  <td className="r mono">{v.active ? money0(perMonth(v)) : '—'}</td>
                  <td>{v.renews_on ? <>{mdy(v.renews_on)} {d != null && d <= 30 && v.active && <span className={'pill ' + (d < 0 ? 'pill-bad' : 'pill-warn')}>{d < 0 ? 'past due' : `in ${d}d`}</span>}</> : '—'}</td>
                  <td>{docs.length ? docs.map((f) => <button key={f.id} className="linkbtn" onClick={() => openFile(f)}>{f.file_name}</button>) : <span className="sub">none</span>}
                    <label className="linkbtn" style={{ cursor: 'pointer', marginLeft: 6 }}>+ Attach<input type="file" hidden multiple accept=".pdf,image/*,.doc,.docx" onChange={(e) => { attach(v, e.target.files); e.target.value = '' }} /></label></td>
                  <td className="r"><button className="linkbtn" onClick={() => setEdit({ ...v })}>Edit</button></td>
                </tr>
              )
            })}</tbody>
          </table></div>
        ) : <Empty>No vendors yet. Add each lead vendor and software subscription with what it costs and when it renews.</Empty>}
      </Panel>
    </>
  )
}

/** The owner's Executive Dashboard: what the agency pays its vendors each month, and what renews soon. */
export function VendorSummary() {
  const nav = useNavigate()
  const { data } = useAsync(() => getVendors().catch(() => [] as Vendor[]), [])
  if (!data) return null
  const today = todayPacific()
  const live = data.filter((v) => v.active)
  const month = live.reduce((t, v) => t + perMonth(v), 0)
  const soon = live.filter((v) => v.renews_on && days(v.renews_on, today) <= 30).sort((a, b) => (a.renews_on! < b.renews_on! ? -1 : 1))
  const top = [...live].sort((a, b) => perMonth(b) - perMonth(a)).slice(0, 6)
  return (
    <div className="panel">
      <div className="panel-h"><div><div className="panel-t">Vendors & subscriptions</div><div className="panel-s">{live.length ? `${money0(month)} a month · ${money0(month * 12)} a year across ${live.length} lead vendors, software and services` : 'Nothing entered yet'}</div></div>
        <button className="hd-kai" style={{ height: 36, fontSize: 13 }} onClick={() => nav('/hr?tab=vendors')}>Manage ›</button></div>
      <div className="panel-b">
        {!live.length ? <div className="empty">Add the lead vendors and software you pay for under HR › Vendors & subscriptions.</div> : <>
          <table className="dect"><thead><tr><th>Vendor</th><th>Type</th><th className="tr">Per month</th><th>Renews</th></tr></thead>
            <tbody>{top.map((v) => <tr key={v.id}><td style={{ fontWeight: 700 }}>{v.name}</td><td>{KIND_LABEL[v.kind]}</td><td className="tr mono">{money0(perMonth(v))}</td><td>{v.renews_on ? mdy(v.renews_on) : '—'}</td></tr>)}</tbody></table>
          {soon.length > 0 && <div className="lic-alert" style={{ marginTop: 10 }}><b>Renewing in 30 days:</b> {soon.map((v) => `${v.name} (${mdy(v.renews_on!)})`).join(', ')}</div>}
        </>}
      </div>
    </div>
  )
}
