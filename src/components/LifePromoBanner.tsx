// The Year-End Life Promo memo at the top of the dashboards: an animated card that cycles through how producers get
// paid (huddle p.8), where the team stands against the goal (p.6) and what that means per policy. Shown only while
// the promo runs; the numbers come from reference_data lg:LIFE_PROMO and the team's count (life_promo_status).
import { useEffect, useState } from 'react'
import { getPromoStatus, tierAt, type PromoStatus } from '../lib/lifePromo'
import { useAsync } from '../lib/useAsync'

const usd = (v: number) => '$' + Math.round(v).toLocaleString('en-US')
// a payout per policy, halves rounded down the way the huddle sheet shows them ($835 × 30% = $250)
const payout = (v: number) => '$' + Math.ceil(v - 0.5).toLocaleString('en-US')
const pct = (r: number) => Math.round(r * 100) + '%'
const monthDay = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export default function LifePromoBanner() {
  const { data } = useAsync(() => getPromoStatus(), [])
  return data ? <Memo s={data} /> : null
}

function Memo({ s }: { s: PromoStatus }) {
  const p = s.promo
  const tiers = [...p.tiers].sort((a, b) => a.after - b.after)
  const team = p.baseline + (Number(s.written) || 0)
  const { now, next } = tierAt(p, team)
  const avg = Number(p.avgPremium) || 0
  const top = tiers[tiers.length - 1]
  const left = Math.max(0, p.goal - team)
  const max = Math.max(p.goal, team)

  const slides = [
    <div key="pay" className="lp-slide">
      <p className="lp-big">Get paid <b>{tiers.map((t) => pct(t.rate)).join(' → ')}</b> of every life policy's annual premium</p>
      <div className="lp-chips">
        {tiers.map((t) => (
          <span key={t.after} className={'lp-chip' + (t === now ? ' on' : team >= t.after ? ' done' : '')}>
            <b>{pct(t.rate)}</b><small>{t.after ? `after ${t.after} team I&P` : 'starting rate'}</small>
            {avg > 0 && <em>{payout(avg * t.rate)}<small> on avg {usd(avg)}</small></em>}
          </span>
        ))}
      </div>
    </div>,
    <div key="team" className="lp-slide">
      <p className="lp-big">Team is at <b>{team}</b> of <b>{p.goal}</b> issued &amp; paid{next ? <> · <b className="lp-hot">{next.after - team} more</b> unlocks {pct(next.rate)}</> : <> · <b className="lp-hot">top rate unlocked</b></>}</p>
      <div className="lp-track" role="img" aria-label={`${team} of ${p.goal} team issued and paid`}>
        <div className="lp-fill" style={{ width: Math.min(100, (team / max) * 100) + '%' }} />
        {tiers.filter((t) => t.after > 0).map((t) => (
          <span key={t.after} className={'lp-mark' + (team >= t.after ? ' hit' : '')} style={{ left: (t.after / max) * 100 + '%' }}>
            <i />{t.after}<small>{pct(t.rate)}</small>
          </span>
        ))}
        <span className="lp-mark goal" style={{ left: '100%' }}><i />{p.goal}<small>goal</small></span>
      </div>
      <p className="lp-small">{p.baseline} on {monthDay(p.baselineAsOf)} + {s.written} life polic{s.written === 1 ? 'y' : 'ies'} written since · {left ? `${left} to go by ${monthDay(p.to)}` : 'goal reached!'} · pace: 5–6 I&amp;P and 12–14 apps a week</p>
    </div>,
    <div key="you" className="lp-slide">
      <p className="lp-big">Write <b>5 policies</b> at {pct(top.rate)} ≈ <b className="lp-hot">{usd(Math.round((5 * avg * top.rate) / 10) * 10)}</b> in your pocket</p>
      <p className="lp-small">A $1,000 term policy at {pct(tiers[0].rate)} = {usd(1000 * tiers[0].rate)} · the rate is set by the team's count when the policy is written · every app moves the whole team up</p>
    </div>,
  ]

  const [i, setI] = useState(0)
  const [hold, setHold] = useState(false)
  useEffect(() => {
    if (hold) return
    const t = window.setInterval(() => setI((k) => (k + 1) % slides.length), 5500)
    return () => window.clearInterval(t)
  }, [hold, slides.length])

  return (
    <section className="lp" aria-label={p.name} onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}>
      <span className="lp-shine" aria-hidden="true" />
      <span className="lp-spark s1" aria-hidden="true">✦</span><span className="lp-spark s2" aria-hidden="true">✦</span><span className="lp-spark s3" aria-hidden="true">✦</span>
      <div className="lp-head">
        <span className="lp-badge">🔥 {p.name}</span>
        <p className="lp-title">{p.headline || 'One policy. Bigger payouts.'}</p>
        <p className="lp-when">Now through {monthDay(p.to)} · applies to every producer</p>
      </div>
      <div className="lp-body">
        <div className="lp-stage" key={i}>{slides[i]}</div>
        <div className="lp-dots" role="tablist">
          {slides.map((_, k) => <button key={k} type="button" role="tab" aria-selected={k === i} aria-label={`Slide ${k + 1}`} className={k === i ? 'on' : ''} onClick={() => setI(k)} />)}
        </div>
      </div>
      {p.note && <p className="lp-note">{p.note}</p>}
    </section>
  )
}
