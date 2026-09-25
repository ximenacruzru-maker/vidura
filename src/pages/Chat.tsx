import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { ErrorBox, PageHead } from '../components/ui'
import { isAdmin } from '../lib/data'
import { supabase } from '../lib/supabase'

const CHANNELS = [
  { id: 'general', label: '# general', desc: 'Agency-wide' },
  { id: 'sales', label: '# sales', desc: 'Quotes, transfers, closes' },
  { id: 'service', label: '# service', desc: 'Client requests and endorsements' },
  { id: 'commercial', label: '# commercial', desc: 'Brokered and Farmers commercial' },
  { id: 'owners', label: '# owners', desc: 'Management only', admin: true },
]
interface Msg { id: number; room: string; author_id: string; author_name: string; body: string; created_at: string }
interface Person { user_id: string; display_name: string; role: string }

const initials = (n: string) => n.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase()
const when = (ts: string) => {
  const d = new Date(ts)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
const linkify = (t: string) => t.split(/(https?:\/\/\S+)/g).map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a> : p))

export default function Chat() {
  const { me, session } = useAuth()
  const uid = session!.user.id
  const [room, setRoom] = useState('general')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [text, setText] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const log = useRef<HTMLDivElement>(null)

  useEffect(() => { supabase.from('staff_directory').select('*').then(({ data }) => setPeople(((data || []) as Person[]).filter((p) => p.user_id !== uid))) }, [uid])

  useEffect(() => {
    let alive = true
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const load = async () => {
      const { data, error } = await supabase.from('chat_messages').select('*').eq('room', room).gte('created_at', since).order('created_at').limit(500)
      if (!alive) return
      if (error) setErr(error); else setMsgs(data as Msg[])
    }
    load()
    const t = setInterval(load, 8000)
    return () => { alive = false; clearInterval(t) }
  }, [room])

  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }) }, [msgs.length, room])

  const send = async () => {
    const body = text.trim()
    if (!body) return
    setText('')
    const { data, error } = await supabase.from('chat_messages').insert({ room, body, author_name: me?.display_name || 'Staff' }).select().single()
    if (error) { setErr(error); setText(body) } else setMsgs((m) => [...m, data as Msg])
  }
  const del = async (id: number) => {
    const { error } = await supabase.from('chat_messages').delete().eq('id', id)
    if (!error) setMsgs((m) => m.filter((x) => x.id !== id))
  }

  const dmId = (other: string) => 'dm:' + [uid, other].sort().join('|')
  const ch = CHANNELS.find((c) => c.id === room)
  const dmWith = room.startsWith('dm:') ? people.find((p) => room.includes(p.user_id)) : null

  return (
    <>
      <PageHead kicker="Team" title="Team chat" sub="Shared with signed-in staff. Messages older than 30 days are hidden." />
      {err ? <ErrorBox error={err} /> : null}
      <div className="chat">
        <aside className="chat-side">
          <div className="chat-h">Channels</div>
          {CHANNELS.filter((c) => !c.admin || isAdmin(me?.role)).map((c) => (
            <button key={c.id} className={'chat-r' + (room === c.id ? ' on' : '')} onClick={() => setRoom(c.id)}>{c.label}</button>
          ))}
          <div className="chat-h" style={{ marginTop: 12 }}>Direct messages</div>
          {people.length ? people.map((p) => (
            <button key={p.user_id} className={'chat-r' + (room === dmId(p.user_id) ? ' on' : '')} onClick={() => setRoom(dmId(p.user_id))}>{p.display_name}</button>
          )) : <div className="sub" style={{ padding: '4px 10px' }}>Direct messages appear once staff logins are added.</div>}
        </aside>
        <section className="chat-main">
          <div className="chat-top"><div className="panel-t" style={{ fontSize: 16 }}>{ch?.label || dmWith?.display_name || 'Direct message'}</div><div className="panel-s">{ch?.desc || 'Only the two of you can see this.'}</div></div>
          <div className="chat-log" ref={log}>
            {msgs.length ? msgs.map((m) => (
              <div key={m.id} className={'chat-msg' + (m.author_id === uid ? ' me' : '')}>
                <em className="chat-av">{initials(m.author_name)}</em>
                <div>
                  <div className="chat-meta"><b>{m.author_name}</b> {when(m.created_at)} {m.author_id === uid && <button className="linkbtn" style={{ fontSize: 12 }} onClick={() => del(m.id)}>delete</button>}</div>
                  <div className="chat-text">{linkify(m.body)}</div>
                </div>
              </div>
            )) : <div className="empty">No messages yet. Say something.</div>}
          </div>
          <form className="chat-form" onSubmit={(e) => { e.preventDefault(); send() }}>
            <textarea rows={2} value={text} placeholder="Write a message — Enter to send, Shift+Enter for a new line" onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
            <button className="btn-primary" type="submit">Send</button>
          </form>
        </section>
      </div>
    </>
  )
}
