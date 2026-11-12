// A life sale just landed: every signed-in screen pops up balloons and confetti with a fanfare, the producer's name
// and what the policy paid them (the Year-End Life Promo rate). Screens check for new life sales every 45 seconds;
// sales come in with the AgencyZoom sync (hourly, or Refresh). Only sales recorded after a screen last looked are
// celebrated, and only ones just written — a policy entered late for an old sold date doesn't set it off.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export interface LifeWin { id: number; producer: string; line: string | null; carrier: string | null; recorded_at: string; case_no: number | null; rate: number | null; earned: number | null; team: number | null; goal: number | null }

const SEEN = 'declara_life_wins_seen_v1'
const POLL = 45_000
const SHOW = 11_000
const usd = (v: number) => { const c = Number.isInteger(v) ? 0 : 2; return '$' + v.toLocaleString('en-US', { minimumFractionDigits: c, maximumFractionDigits: c }) }
const readSeen = () => { try { return localStorage.getItem(SEEN) } catch { return null } }
const writeSeen = (v: string) => { try { localStorage.setItem(SEEN, v) } catch { /* private window */ } }

// ---------- sound: a short fanfare, a party horn and a cheer, made in the browser (no file to load) ----------
let ctx: AudioContext | null = null
function audio() {
  if (!ctx) { const A = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext; if (A) ctx = new A() }
  return ctx
}
// browsers only allow sound after the person has clicked or typed on the page: wake the audio on the first one
function unlockOnGesture() {
  const go = () => { const c = audio(); if (c && c.state === 'suspended') void c.resume() }
  window.addEventListener('pointerdown', go, { once: true, capture: true })
  window.addEventListener('keydown', go, { once: true, capture: true })
}
function playCheer() {
  const c = audio(); if (!c) return
  if (c.state === 'suspended') void c.resume()
  const t0 = c.currentTime + 0.05
  const out = c.createGain(); out.gain.value = 0.55; out.connect(c.destination)
  const tone = (f: number, at: number, len: number, type: OscillatorType = 'triangle', vol = 0.35) => {
    const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f
    g.gain.setValueAtTime(0, t0 + at); g.gain.linearRampToValueAtTime(vol, t0 + at + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t0 + at + len)
    o.connect(g); g.connect(out); o.start(t0 + at); o.stop(t0 + at + len + 0.05)
  }
  // party horn: a buzzy rising blast
  const h = c.createOscillator(), hg = c.createGain(); h.type = 'sawtooth'
  h.frequency.setValueAtTime(330, t0); h.frequency.exponentialRampToValueAtTime(700, t0 + 0.35)
  hg.gain.setValueAtTime(0.0001, t0); hg.gain.linearRampToValueAtTime(0.18, t0 + 0.05); hg.gain.linearRampToValueAtTime(0.0001, t0 + 0.45)
  h.connect(hg); hg.connect(out); h.start(t0); h.stop(t0 + 0.5)
  // fanfare: da-da-da-DAAA, then the chord
  ;[[523.25, 0.5], [659.25, 0.62], [783.99, 0.74]].forEach(([f, at]) => tone(f, at, 0.14, 'square', 0.16))
  ;[1046.5, 783.99, 659.25, 523.25].forEach((f) => tone(f, 0.88, 1.3, 'triangle', 0.22))
  // a cheer: noise swelling through a band-pass, like a crowd
  const len = 2.4, buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate), d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (0.6 + 0.4 * Math.sin(i / 900))
  const n = c.createBufferSource(), bp = c.createBiquadFilter(), ng = c.createGain()
  n.buffer = buf; bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.7
  ng.gain.setValueAtTime(0.0001, t0 + 0.8); ng.gain.linearRampToValueAtTime(0.22, t0 + 1.3); ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.8 + len)
  n.connect(bp); bp.connect(ng); ng.connect(out); n.start(t0 + 0.8); n.stop(t0 + 0.8 + len)
}

export default function LifeCelebration() {
  const [queue, setQueue] = useState<LifeWin[]>([])
  const since = useRef<string>(readSeen() || new Date(Date.now() - 2 * 3600_000).toISOString())

  const check = useCallback(async () => {
    const { data, error } = await supabase.rpc('life_wins', { since: since.current })
    if (error || !Array.isArray(data) || !data.length) return
    const wins = data as LifeWin[]
    since.current = wins[wins.length - 1].recorded_at; writeSeen(since.current)
    setQueue((q) => [...q, ...wins.filter((w) => !q.some((x) => x.id === w.id))])
  }, [])

  useEffect(() => {
    unlockOnGesture()
    void check()
    const t = window.setInterval(() => void check(), POLL)
    const vis = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', vis)
    // a screen can show one on request (e.g. to try it out): window.dispatchEvent(new CustomEvent('declara:life-win', { detail: win }))
    const demo = (e: Event) => { const w = (e as CustomEvent<LifeWin>).detail; if (w) setQueue((q) => [...q, w]) }
    window.addEventListener('declara:life-win', demo)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', vis); window.removeEventListener('declara:life-win', demo) }
  }, [check])

  const win = queue[0]
  const next = useCallback(() => setQueue((q) => q.slice(1)), [])
  useEffect(() => {
    if (!win) return
    playCheer()
    const t = window.setTimeout(next, SHOW)
    return () => window.clearTimeout(t)
  }, [win, next])

  return win ? <Celebration key={win.id + ':' + win.recorded_at} win={win} onClose={next} more={queue.length - 1} /> : null
}

const COLORS = ['#ff4d6d', '#ffb703', '#4cc9f0', '#80ed99', '#c77dff', '#ff8fab', '#ffd60a', '#3a86ff']

function Celebration({ win, onClose, more }: { win: LifeWin; onClose: () => void; more: number }) {
  const [balloons] = useState(() => Array.from({ length: 16 }, (_, i) => ({
    left: 3 + ((i * 61) % 94), delay: (i % 8) * 0.28 + (i > 7 ? 0.9 : 0), dur: 5.5 + ((i * 7) % 5) * 0.6, color: COLORS[i % COLORS.length], size: 46 + ((i * 13) % 26), sway: i % 2 ? 1 : -1,
  })))
  const [confetti] = useState(() => Array.from({ length: 70 }, (_, i) => ({
    left: (i * 37) % 100, delay: (i % 14) * 0.12, dur: 2.6 + ((i * 11) % 9) * 0.22, color: COLORS[(i * 3) % COLORS.length], rot: (i * 47) % 360, w: 6 + (i % 3) * 3,
  })))
  const first = win.producer.split(/\s+/)[0]
  return (
    <div className="lc" role="alertdialog" aria-live="assertive" aria-label={`Life sale by ${win.producer}`} onClick={onClose}>
      <div className="lc-sky" aria-hidden="true">
        {confetti.map((c, i) => <i key={'c' + i} className="lc-conf" style={{ left: c.left + '%', animationDelay: c.delay + 's', animationDuration: c.dur + 's', background: c.color, width: c.w, transform: `rotate(${c.rot}deg)` }} />)}
        {balloons.map((b, i) => (
          <span key={'b' + i} className="lc-balloon" style={{ left: b.left + '%', animationDelay: b.delay + 's', animationDuration: b.dur + 's', ['--c' as string]: b.color, ['--s' as string]: b.size + 'px', ['--sway' as string]: b.sway }}>
            <span className="lc-knot" /><span className="lc-string" />
          </span>
        ))}
      </div>
      <div className="lc-card" onClick={(e) => e.stopPropagation()}>
        <p className="lc-kicker">🎉 Life sale! 🎉</p>
        <p className="lc-name">{win.producer}</p>
        <p className="lc-what">just wrote a {win.line && /life/i.test(win.line) ? win.line.toLowerCase() : 'life'} policy{win.carrier ? ` with ${win.carrier}` : ''}!</p>
        {win.earned != null && win.rate != null && (
          <div className="lc-earn">
            <small>{first} earned</small>
            <b>{usd(Number(win.earned))}</b>
            <small>at the {Math.round(Number(win.rate) * 100)}% promo rate{win.case_no ? ` · team case #${win.case_no}` : ''}</small>
          </div>
        )}
        {win.team != null && win.goal != null && <p className="lc-team">Team is at <b>{win.team}</b> of <b>{win.goal}</b> — keep it going! 🚀</p>}
        <button type="button" className="lc-close" onClick={onClose}>{more > 0 ? `Next 🎈 (${more} more)` : 'Woohoo! 🎈'}</button>
      </div>
    </div>
  )
}
