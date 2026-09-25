import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Login } from '../lib/logins'
import { Drawer } from './ui'

type Cell = string | number | boolean | Date | null
interface SheetT { sheet: string; data: Cell[][] }
type Field = 'name' | 'url' | 'username' | 'password' | 'notes'
const FIELDS: { key: Field; label: string; guess: RegExp }[] = [
  { key: 'name', label: 'Name (carrier / site)', guess: /name|carrier|company|site|system|vendor|account/i },
  { key: 'url', label: 'Website', guess: /url|web|link|portal|site/i },
  { key: 'username', label: 'Username', guess: /user|login|email|id/i },
  { key: 'password', label: 'Password', guess: /pass|pw|pwd/i },
  { key: 'notes', label: 'Notes', guess: /note|comment|code|agent|info/i },
]
const col = (i: number) => String.fromCharCode(65 + (i % 26)).repeat(Math.floor(i / 26) + 1)
const str = (v: Cell) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim()
const looksUrl = (s: string) => !s.includes('@') && !/\s/.test(s.trim()) && /^(https?:\/\/|www\.)|\.(com|net|org|io|us|gov)(\/|$)/i.test(s.trim())

/** Reads an Excel file in the browser and saves the chosen rows into the encrypted vault.
 *  The file never leaves the computer; each password goes straight to the database's encrypt function. */
export default function PasswordImport({ existing, onDone }: { existing: Login[]; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [sheets, setSheets] = useState<SheetT[]>([])
  const [si, setSi] = useState(0)
  const [hasHead, setHasHead] = useState(true)
  const [map, setMap] = useState<Record<Field, number>>({ name: -1, url: -1, username: -1, password: -1, notes: -1 })
  const [grp, setGrp] = useState('Carriers & wholesalers')
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState('')

  const rows = sheets[si]?.data || []
  const width = Math.max(0, ...rows.slice(0, 50).map((r) => r.length))
  const head = hasHead ? rows[0] || [] : []
  const body = (hasHead ? rows.slice(1) : rows).filter((r) => r.some((c) => str(c)))

  const guess = (data: Cell[][], headers: boolean) => {
    const h = headers ? (data[0] || []).map(str) : []
    const rowsB = (headers ? data.slice(1) : data).filter((r) => r.some((c) => str(c)))
    const w = Math.max(0, ...data.slice(0, 200).map((r) => r.length))
    const filled = (k: number) => rowsB.filter((r) => str(r[k])).length
    const urlShare = (k: number) => { const n = filled(k); return n ? rowsB.filter((r) => looksUrl(str(r[k]))).length / n : 0 }
    const m: Record<Field, number> = { name: -1, url: -1, username: -1, password: -1, notes: -1 }
    const used = new Set<number>()
    for (const f of ['password', 'username', 'url', 'notes', 'name'] as Field[]) {
      const i = h.findIndex((x, k) => !used.has(k) && filled(k) > 0 && FIELDS.find((z) => z.key === f)!.guess.test(x) && !(f === 'name' && /user/i.test(x)))
      if (i >= 0) { m[f] = i; used.add(i) }
    }
    if (m.url < 0) { // a column that is mostly web addresses
      let best = -1, share = 0.3
      for (let k = 0; k < w; k++) if (!used.has(k) && urlShare(k) >= share) { best = k; share = urlShare(k) }
      if (best >= 0) { m.url = best; used.add(best) }
    }
    if (m.name < 0) { // the fullest remaining column that isn't web addresses, favouring the left
      let best = -1, n = 0
      for (let k = 0; k < w; k++) if (!used.has(k) && urlShare(k) < 0.5 && filled(k) > n * 1.15) { best = k; n = filled(k) }
      if (best >= 0) { m.name = best; used.add(best) }
    }
    return m
  }
  const pickFile = async (f: File | undefined) => {
    if (!f) return
    setBusy('Reading the file…'); setResult('')
    try {
      const { default: readExcel } = await import('read-excel-file/browser')
      const all = (await readExcel(f)) as unknown as SheetT[]
      setSheets(all); setSi(0); setHasHead(true); setMap(guess(all[0]?.data || [], true)); setGrp(all[0]?.sheet && /pass/i.test(all[0].sheet) ? 'Carriers & wholesalers' : all[0]?.sheet || 'Carriers')
    } catch (e: any) { alert('Couldn’t read that file: ' + (e?.message || e)) }
    setBusy('')
  }
  const chooseSheet = (i: number) => { setSi(i); setMap(guess(sheets[i]?.data || [], hasHead)); setGrp(/pass/i.test(sheets[i]?.sheet || '') ? 'Carriers & wholesalers' : sheets[i]?.sheet || 'Other') }

  const items = useMemo(() => body.map((r) => ({
    name: map.name >= 0 ? str(r[map.name]) : '',
    url: map.url >= 0 ? str(r[map.url]) : '',
    username: map.username >= 0 ? str(r[map.username]) : '',
    password: map.password >= 0 ? str(r[map.password]) : '',
    notes: map.notes >= 0 ? str(r[map.notes]) : '',
  })).map((x) => ({ ...x, name: x.name || (x.url ? x.url.replace(/^https?:\/\//, '').split('/')[0] : '') }))
    .filter((x) => x.name && (x.username || x.password || x.url)), [body, map])

  const run = async () => {
    if (!items.length) return
    if (!confirm(`Import ${items.length} logins into “${grp}”? Logins that already exist with the same name and username are updated.`)) return
    let ok = 0, bad = 0
    const key = (n: string, u: string | null) => n.trim().toLowerCase() + '|' + (u || '').trim().toLowerCase()
    const have = new Map(existing.map((l) => [key(l.name, l.username), l.id]))
    for (const [i, x] of items.entries()) {
      setBusy(`Saving ${i + 1} of ${items.length}…`)
      const { error } = await supabase.rpc('agency_login_save', {
        p_id: have.get(key(x.name, x.username)) || null, p_grp: grp, p_name: x.name.slice(0, 200),
        p_url: x.url || null, p_username: x.username || null, p_notes: x.notes || null, p_password: x.password || null,
      })
      if (error) bad++; else ok++
    }
    setBusy(''); setResult(`${ok} saved${bad ? `, ${bad} failed` : ''}.`); setSheets([]); onDone()
  }

  return (
    <>
      <button className="btn-ghost" onClick={() => { setOpen(true); setResult('') }}>Import from Excel</button>
      <Drawer open={open} onClose={() => { if (!busy) { setOpen(false); setSheets([]) } }} title="Import logins from Excel"
        sub="The file is read on this computer. Each password is encrypted by the database as it is saved.">
        {result && <div className="note-box">{result}</div>}
        {!sheets.length ? (
          <label className="pw-drop">
            <b>{busy || 'Choose an Excel file (.xlsx)'}</b>
            <span className="sub">Pick the sheet and columns on the next step. Nothing is saved until you click Import.</span>
            <input type="file" accept=".xlsx" hidden disabled={!!busy} onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = '' }} />
          </label>
        ) : (
          <div className="pw-form">
            <label>Sheet<select className="fld" value={si} onChange={(e) => chooseSheet(Number(e.target.value))}>
              {sheets.map((s, i) => <option key={s.sheet} value={i}>{s.sheet} ({s.data.filter((r) => r.some((c) => str(c))).length} rows)</option>)}</select></label>
            <label className="check" style={{ flexDirection: 'row' }}><input type="checkbox" checked={hasHead} onChange={(e) => { setHasHead(e.target.checked); setMap(guess(rows, e.target.checked)) }} /> First row is column titles</label>
            <div className="pw-map">
              {FIELDS.map((f) => (
                <label key={f.key}>{f.label}
                  <select className="fld" value={map[f.key]} onChange={(e) => setMap({ ...map, [f.key]: Number(e.target.value) })}>
                    <option value={-1}>— none —</option>
                    {Array.from({ length: width }, (_, i) => <option key={i} value={i}>Column {col(i)}{hasHead && FIELDS.some((z) => z.guess.test(str(head[i]))) && str(head[i]).length <= 24 && !/\s{0}[!@#$%^&*]/.test(str(head[i])) ? ` · ${str(head[i])}` : ''}</option>)}
                  </select></label>
              ))}
            </div>
            <label>Save into group<input className="fld" value={grp} onChange={(e) => setGrp(e.target.value)} /></label>
            <div className={items.length ? 'sub' : 'error-box'}>{items.length ? `${items.length} logins will be imported · passwords are hidden in this preview` : 'No rows to import yet — pick the column that holds the carrier or site name under “Name”, and the username and password columns.'}</div>
            <div className="tbl-wrap" style={{ maxHeight: 300 }}>
              <table className="tbl"><thead><tr><th>Name</th><th>Website</th><th>Username</th><th>Password</th></tr></thead>
                <tbody>{items.slice(0, 40).map((x, i) => (
                  <tr key={i}><td className="strong">{x.name}</td><td className="sub">{x.url}</td><td className="mono">{x.username}</td><td>{x.password ? '••••••' : <span className="sub">—</span>}</td></tr>
                ))}</tbody></table>
            </div>
            <div className="row-actions" style={{ justifyContent: 'space-between' }}>
              <button className="btn-ghost" disabled={!!busy} onClick={() => setSheets([])}>Choose another file</button>
              <button className="btn-primary" disabled={!!busy || !items.length} onClick={run}>{busy || `Import ${items.length} logins`}</button>
            </div>
          </div>
        )}
      </Drawer>
    </>
  )
}
