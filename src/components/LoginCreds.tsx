import { useState } from 'react'
import { copyText, revealLogin, type Login } from '../lib/logins'

/** Username and password for a carrier or system card, with one-click copy. */
export default function LoginCreds({ logins }: { logins: Login[] }) {
  const [shown, setShown] = useState<Record<string, string>>({})
  const [flash, setFlash] = useState('')
  if (!logins.length) return null
  const note = (t: string) => { setFlash(t); setTimeout(() => setFlash(''), 1600) }
  const copyPw = async (id: string) => {
    const v = shown[id] ?? (await revealLogin(id)); if (v == null) return
    note((await copyText(v)) ? 'Password copied' : 'Copy blocked by the browser')
  }
  const toggle = async (id: string) => {
    if (shown[id] != null) { setShown(({ [id]: _, ...r }) => r); return }
    const v = await revealLogin(id); if (v == null) return
    setShown((s) => ({ ...s, [id]: v })); setTimeout(() => setShown(({ [id]: _, ...r }) => r), 20000)
  }
  return (
    <div className="creds">
      {logins.map((l) => (
        <div key={l.id} className="creds-i">
          {logins.length > 1 && <div className="creds-n">{l.name}</div>}
          {l.username && (
            <div className="creds-r"><span className="creds-k">User</span><span className="mono creds-v">{l.username}</span>
              <button className="linkbtn" onClick={async () => note((await copyText(l.username!)) ? 'Username copied' : 'Copy blocked')}>Copy</button></div>
          )}
          {l.has_secret && (
            <div className="creds-r"><span className="creds-k">Pass</span><span className="mono creds-v">{shown[l.id] ?? '••••••••'}</span>
              <button className="linkbtn" onClick={() => toggle(l.id)}>{shown[l.id] != null ? 'Hide' : 'Show'}</button>
              <button className="linkbtn" onClick={() => copyPw(l.id)}>Copy</button></div>
          )}
          {l.notes && <div className="sub creds-note">{l.notes}</div>}
        </div>
      ))}
      {flash && <div className="creds-flash">{flash}</div>}
    </div>
  )
}
