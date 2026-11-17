// Team today, at the top of the owner's My Space: each person's focus (sales, retention & renewals, training…), who's
// out, and what they've done today from Declara — sales (life sales flagged), quotes, renewal reviews, calls, work
// completed. The owner marks someone out or changes a focus right on the card. Everyone else sees the life promo here.
import { useState } from 'react'
import { money0, todayPacific } from '../lib/format'
import { FOCUS, loadTeamToday, personBits, setTeamFocus, setTeamOut, teamPeople } from '../lib/teamToday'
import { useAsync } from '../lib/useAsync'

/** the focus picker and the in/out button, shared with Team Space */
export function FocusPick({ name, focus, onChange, className = 'tt-focus' }: { name: string; focus: string; onChange: () => void; className?: string }) {
  const set = async (v: string) => {
    let f = v
    if (v === '__other') { const t = prompt(`What is ${name.split(' ')[0]} focused on?`); if (!t?.trim()) return; f = t.trim() }
    try { await setTeamFocus(name, f); onChange() } catch (e) { alert((e as Error).message) }
  }
  return (
    <select className={className} value={focus} onChange={(e) => set(e.target.value)} aria-label={`${name}'s focus`}>
      {!FOCUS.includes(focus) && <option value={focus}>{focus}</option>}
      {FOCUS.map((x) => <option key={x} value={x}>{x}</option>)}<option value="__other">Other…</option>
    </select>
  )
}
export function OutToggle({ day, name, out, onChange, className = 'tt-out' }: { day: string; name: string; out: boolean; onChange: () => void; className?: string }) {
  const toggle = async () => { try { await setTeamOut(day, name, !out); onChange() } catch (e) { alert((e as Error).message) } }
  return <button type="button" className={className + (out ? ' on' : '')} onClick={toggle} title={out ? 'Mark back in today' : 'Mark out today'}>{out ? 'Out today' : 'In'}</button>
}

export default function TeamToday() {
  const today = todayPacific()
  const [tick, setTick] = useState(0)
  const { data, error } = useAsync(() => loadTeamToday(today), [today, tick])
  // nothing to show if the day couldn't be read (not the owner, or offline)
  const people = !error && data ? teamPeople(data) : null
  if (!people) return null
  const out = people.filter((p) => p.out)
  const sold = people.reduce((a, p) => a + p.sales, 0), prem = people.reduce((a, p) => a + p.prem, 0), life = people.reduce((a, p) => a + p.life, 0)
  const again = () => setTick((n) => n + 1)
  const long = new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })

  return (
    <section className="tt" aria-label="Team today">
      <span className="tt-shine" aria-hidden="true" />
      <div className="tt-head">
        <p className="tt-title">👋 Team today <span>· {long}</span></p>
        <p className="tt-sum">
          {people.length - out.length} in{out.length ? <> · <b>{out.map((p) => p.name.split(' ')[0]).join(' & ')} out</b></> : ''} · {sold} sale{sold === 1 ? '' : 's'} today{sold ? ` (${money0(prem)})` : ''}{life ? <> · <b className="tt-life">🎉 {life} life</b></> : ''}
        </p>
      </div>
      <div className="tt-grid">
        {people.map((p, i) => {
          const bits = personBits(p, money0)
          return (
            <div key={p.name} className={'tt-p' + (p.out ? ' out' : '')} style={{ animationDelay: i * 0.06 + 's' }}>
              <div className="tt-top">
                <span className="tt-av" style={{ background: p.color }}>{p.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
                <div className="tt-who"><b>{p.name}</b><FocusPick name={p.name} focus={p.focus} onChange={again} /></div>
                <OutToggle day={today} name={p.name} out={p.out} onChange={again} />
              </div>
              {p.out ? <div className="tt-line muted">Out today{p.note ? ` · ${p.note}` : ''}</div>
                : <div className="tt-line">{p.life ? <span className="tt-life">🎉 {p.life} life sold</span> : null}{bits.length ? bits.join(' · ') : <span className="muted">Nothing in Declara yet today</span>}</div>}
            </div>
          )
        })}
      </div>
    </section>
  )
}
