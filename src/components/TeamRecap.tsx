// "Email the team recap": one email to the owner with what everyone did on a day, from Declara. The recap shows here
// first (pick the day, edit the text if needed), then opens in Gmail or the computer's email app addressed to the
// owner, ready to send. For the owner, admins and whoever runs the work queue.
import { useState } from 'react'
import { useAuth } from '../auth'
import { agencyName } from '../lib/data'
import { todayPacific } from '../lib/format'
import { getTeamDay, recapText } from '../lib/teamDay'
import { useAsync } from '../lib/useAsync'
import { Drawer, ErrorBox, Loading } from './ui'

// Gmail and mail apps cut off very long links: past this, the full recap is copied and pasted in instead
const MAX_LINK = 6000

export default function TeamRecap({ className = 'btn-ghost', label }: { className?: string; label?: string }) {
  const { me } = useAuth()
  const [open, setOpen] = useState(false)
  label ??= me?.role === 'owner' ? '📧 Email me the team recap' : '📧 Email the team recap'
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{label}</button>
      {open && <RecapDrawer onClose={() => setOpen(false)} />}
    </>
  )
}

function RecapDrawer({ onClose }: { onClose: () => void }) {
  const { me } = useAuth()
  const [day, setDay] = useState(todayPacific())
  const { data, error } = useAsync(() => getTeamDay(day), [day])
  const [edited, setEdited] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState('')
  const base = data ? recapText(data, agencyName(me)) : ''
  const text = edited[day] ?? base
  const subject = data ? `Team recap · ${new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}` : ''
  const to = data?.to || ''
  const copy = async (why = 'Copied') => { try { await navigator.clipboard.writeText(text); setCopied(why) } catch { setCopied('Select the text and copy it') } }
  const send = async (where: 'gmail' | 'app') => {
    const tooLong = text.length > MAX_LINK
    if (tooLong) await copy('The recap is long, so it was copied: paste it into the email')
    const body = tooLong ? '(Paste the recap here; it was copied from Declara.)' : text
    const url = where === 'gmail'
      ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      : `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    if (where === 'gmail') window.open(url, '_blank', 'noopener'); else window.location.href = url
  }
  return (
    <Drawer open onClose={onClose} title="📧 Team recap" sub={`One email to ${to || 'the owner'} with what everyone did, from Declara.`}>
      <div className="tr-bar">
        <label className="tr-day">Day <input type="date" className="fld" value={day} max={todayPacific()} onChange={(e) => e.target.value && setDay(e.target.value)} /></label>
        {data && <span className="tr-meta">{data.people.length} {data.people.length === 1 ? 'person' : 'people'} with activity{data.quiet.length ? ` · ${data.quiet.length} with none` : ''}</span>}
      </div>
      {error ? <ErrorBox error={error} /> : !data ? <Loading what="Putting the recap together" /> : <>
        <div className="tr-people">
          {data.people.map((p) => <span key={p.name} className="tr-chip"><b>{p.name.split(' ')[0]}</b> {p.count}</span>)}
        </div>
        <textarea className="fld tr-text" value={text} onChange={(e) => setEdited({ ...edited, [day]: e.target.value })} aria-label="The recap email" />
        <div className="tr-acts">
          <button type="button" className="btn-primary" onClick={() => send('gmail')} disabled={!to}>Open in Gmail</button>
          <button type="button" className="btn-ghost" onClick={() => send('app')} disabled={!to}>Open in email app</button>
          <button type="button" className="btn-ghost" onClick={() => copy()}>Copy</button>
          {edited[day] != null && <button type="button" className="linkbtn" onClick={() => { const e = { ...edited }; delete e[day]; setEdited(e) }}>Start over</button>}
        </div>
        {!to && <p className="tr-note">No email is on file for the owner: add it under Settings › Team.</p>}
        {copied && <p className="tr-note">{copied}</p>}
      </>}
    </Drawer>
  )
}
