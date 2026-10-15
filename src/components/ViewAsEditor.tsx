import { useState } from 'react'
import { Drawer } from './ui'
import { ROLE_LABEL } from '../lib/access'
import type { Role, StaffAccount } from '../lib/data'
import { call, Switches } from '../pages/Settings'

const ROLES: Role[] = ['admin', 'producer', 'protege', 'sdr', 'csr', 'va', 'new_hire']

/** Change a team member's role and the sections they can see, right from "view as" (same rules as Team & access). */
export default function ViewAsEditor({ person, onClose, onSaved }: { person: StaffAccount; onClose: () => void; onSaved: () => void }) {
  const [role, setRole] = useState<Role>(person.role)
  const [access, setAccess] = useState<Record<string, boolean>>(person.access || {})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const save = async () => {
    setBusy(true); setErr('')
    try { await call({ action: 'update', user_id: person.user_id, access, ...(role !== person.role ? { role } : {}) }); onSaved() }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <Drawer open onClose={onClose} title={`What ${person.display_name} can see`} sub="Saved straight to their account — they see the change the next time a page loads.">
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <label>Role<select className="fld" value={role} onChange={(e) => { setRole(e.target.value as Role); setAccess({}) }} disabled={person.role === 'owner'}>
          {(person.role === 'owner' ? ['owner' as Role] : ROLES).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select></label>
      </div>
      <Switches role={role} access={access} onChange={setAccess} />
      {err && <div className="cp-err" style={{ marginTop: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </Drawer>
  )
}
