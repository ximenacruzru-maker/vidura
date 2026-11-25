// The Hunter Goal Scoreboard's goals, in a person's own Space.
//  - GoalHero: the banner at the top while the PTO incentive runs (reach every goal five working days in a row and
//    earn a full day of PTO, through December 31): the run so far as five marks, what's left, and PTO days earned.
//  - MyGoals: how close they are, as progress bars: calls and premium written today against today's goals, and (for a
//    producer) commission this folio against their commission goal, with where they should be by now marked on the
//    bar and what's left to write, in auto or home policies at their average premium. One "Edit goals" form sets
//    today's goals, the commission goal and the life policies they plan to write.
import { useEffect, useState, type ReactNode } from 'react'
import { useFolio } from './FolioPicker'
import { actuals, editsLeft, getCommissionGoals, goalPlan, myDailyGoal, PTO_INCENTIVE, saveCommissionGoal, saveDailyGoal, streakData, streakFor, workdays, type Streak } from '../lib/goals'
import { mdy, money0, todayPacific } from '../lib/format'
import { useAsync } from '../lib/useAsync'

const num = (s: string) => { const n = Number(String(s).replace(/[^0-9.]/g, '')); return s.trim() === '' || !isFinite(n) ? null : n }
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

/** a goal as a mission objective: a segmented bar that fills as you go, the number against the goal, and a MISSION
 *  PASSED stamp once it's reached (the main mission is the commission goal) */
export function Meter({ label, icon, value, goal, fmt, foot, boss }: { label: string; icon: string; value: number | null; goal: number | null; fmt: (n: number) => string; foot?: ReactNode; boss?: boolean }) {
  const v = value ?? 0, pct = goal ? Math.min(100, (v / goal) * 100) : 0, done = goal != null && goal > 0 && v >= goal
  const cells = 12, lit = Math.round(pct / (100 / cells))
  return (
    <div className={'hgx-q' + (done ? ' done' : '') + (boss ? ' boss' : '')}>
      <div className="hgx-q-l"><span className="hgx-q-i" aria-hidden="true">{done ? '✅' : icon}</span><span>{label}</span></div>
      <div className="hgx-q-v"><b>{value == null ? '…' : fmt(v)}</b>{goal ? <span>/ {fmt(goal)}</span> : <span>no goal set</span>}</div>
      <div className={'hgx-cells' + (boss ? ' hp' : '')} role="img" aria-label={goal ? `${Math.round(pct)}% of the goal` : 'no goal'}>
        {Array.from({ length: cells }, (_, i) => <i key={i} className={i < lit ? 'on' : ''} />)}
      </div>
      <div className="hgx-q-s">{done ? <b className="hgx-win">MISSION PASSED</b> : foot ?? (!goal ? 'Set a goal to start this objective' : `${fmt(goal - v)} to go · ${Math.round(pct)}%`)}</div>
    </div>
  )
}

export default function MyGoals({ name, commission, streak = false }: { name: string; commission: boolean; streak?: boolean }) {
  const today = todayPacific()
  const { folios } = useFolio()
  const folio = folios.find((f) => f.in_progress) || folios.find((f) => f.start_date <= today && f.end_date >= today)
  const [tick, setTick] = useState(0)
  const mine = useAsync(() => myDailyGoal(name, today), [name, today, tick])
  const now = useAsync(() => actuals(name, today, today), [name, today, tick])
  const saved = useAsync(async () => (commission && folio ? (await getCommissionGoals(folio.start_date)).find((x) => x.name === name) || null : null), [commission, folio?.start_date, name, tick])
  const target = saved.data?.commission || 0, lifeN = saved.data?.life || 0
  const plan = useAsync(async () => (folio && target > 0 ? goalPlan(folio.start_date, target, lifeN) : null), [folio?.start_date, target, lifeN, tick])
  const runs = useAsync(async () => (streak ? streakFor(name, await streakData(today), today) : null), [streak, name, today, tick])

  const set = !!mine.data?.set, g = mine.data?.goal, a = now.data
  const [editing, setEditing] = useState(false)
  const [f, setF] = useState({ calls: '', rev: '', goal: '', life: '' }), [msg, setMsg] = useState('')
  useEffect(() => {
    setF({ calls: g?.calls != null ? String(g.calls) : '', rev: g?.revenue != null ? String(g.revenue) : '', goal: saved.data?.commission != null ? String(saved.data.commission) : '', life: saved.data?.life ? String(saved.data.life) : '' })
  }, [mine.data, saved.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const open = editing || (!!mine.data && !set)
  const save = async () => {
    setMsg('Saving…')
    try {
      await saveDailyGoal(name, today, num(f.calls), num(f.rev))
      if (commission && folio) await saveCommissionGoal(name, folio.start_date, num(f.goal), Math.max(0, Math.floor(num(f.life) || 0)))
      setMsg(''); setEditing(false); setTick((n) => n + 1)
    } catch (e: any) { setMsg('Not saved: ' + (e?.message || e)) }
  }

  const gCalls = set ? g?.calls ?? null : null, gRev = set ? g?.revenue ?? null : null
  const p = plan.data
  const fAll = folio ? workdays(folio.start_date, folio.end_date) || 1 : 1, fGone = folio ? Math.min(fAll, workdays(folio.start_date, today)) : 0
  const pace = Math.round((fGone / fAll) * 100)
  const avg = (from: string) => (from === 'yours' ? 'your avg' : 'agency avg')

  const parts = [gCalls ? Math.min(1, (a?.calls || 0) / gCalls) : null, gRev ? Math.min(1, (a?.revenue || 0) / gRev) : null].filter((x): x is number => x != null)
  const score = parts.length ? Math.round((parts.reduce((t, x) => t + x, 0) / parts.length) * 100) : null
  const first = name.split(' ')[0]
  // two changes a day after setting today's goals (the database holds everyone to it)
  const left = Math.min(set ? editsLeft(g, today) : 2, saved.data ? editsLeft(saved.data, today) : 2)

  return (
    <section className="hgx" aria-label="My goals">
      <div className="hgx-head">
        <div><p className="hgx-kick">Mission board · {first}</p><h2 className="hgx-title">Today’s objectives</h2></div>
        <div className="hgx-head-r">
          <div className="hgx-score" title={score == null ? 'Set today’s goals to get a rating' : `${score}% of the way to every goal you set today`}><span>Hustle rating</span>
            <b className="hgx-stars">{Array.from({ length: 5 }, (_, i) => <i key={i} className={score != null && score >= (i + 1) * 20 ? 'on' : ''}>★</i>)}</b></div>
          {!open && <button type="button" className="hgx-btn" disabled={left <= 0} title={left <= 0 ? 'You’ve changed your goals twice today. Ask Shannon if they need to change again.' : undefined}
            onClick={() => setEditing(true)}>✎ Edit goals <small>{left > 0 ? `${left} left today` : 'none left today'}</small></button>}
        </div>
      </div>

      {open && <div className="hgx-form">
        <p className="hgx-form-h">{set ? `Change your goals · ${left} change${left === 1 ? '' : 's'} left today` : `Choose today’s objectives · ${mdy(today)} · you can change them twice after this`}{!set && g ? <span> · filled in from {mdy(g.day)}</span> : null}</p>
        <div className="hg-fields">
          <label>📞 Calls today<input className="fld" inputMode="numeric" placeholder="60" value={f.calls} onChange={(e) => setF({ ...f, calls: e.target.value })} /></label>
          <label>💵 Premium today<input className="fld" inputMode="decimal" placeholder="3000" value={f.rev} onChange={(e) => setF({ ...f, rev: e.target.value })} /></label>
          {commission && folio && <>
            <label>💼 Commission this folio<input className="fld" inputMode="decimal" placeholder="2500" value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} /></label>
            <label>❤️ Life policies planned<input className="fld" inputMode="numeric" placeholder="2" value={f.life} onChange={(e) => setF({ ...f, life: e.target.value })} /></label>
          </>}
          <div className="hg-actions"><button type="button" className="hgx-btn go" onClick={save}>Start mission</button>{set && <button type="button" className="hgx-btn" onClick={() => setEditing(false)}>Cancel</button>}</div>
        </div>
        {msg && <p className="hgx-msg">{msg}</p>}
      </div>}

      <div className="hgx-cards">
        <Meter label="Objective · make the calls" icon="📞" value={a ? a.calls : null} goal={gCalls} fmt={(n) => String(Math.round(n))} />
        <Meter label="Objective · bind the premium" icon="📝" value={a ? a.revenue : null} goal={gRev} fmt={money0} />
        {commission && folio && <Meter boss label={`Main mission · commission ${mdy(folio.start_date).slice(0, 5)}–${mdy(folio.end_date).slice(0, 5)}`} icon="💼" value={p ? p.current : target ? null : 0} goal={target || null} fmt={money0}
          foot={!target ? 'Set a commission goal to start the main mission' : !p ? (plan.error ? 'Couldn’t work out your plan' : 'Loading mission intel…') : <>{Math.round((p.current / p.commission) * 100)}% · {(p.current / p.commission) * 100 >= pace ? 'on track' : 'behind pace'} · {plural(fAll - fGone, 'day')} left</>} />}
        {streak && runs.data && <StreakMeter s={runs.data} />}
      </div>

      {commission && p && p.current < p.commission && <p className="hgx-plan"><span className="hgx-plan-k">Mission intel</span>{' '}
        {p.needPremium === 0 ? <>Write your {plural(p.life, 'planned life policy', 'planned life policies')} and the main mission ({money0(p.commission)}) is complete.</>
          : p.needPremium == null ? <>That target is more than one folio can pay under the plan. Try a lower goal.</>
          : <>Land <b>{money0(p.needPremium)}</b> more personal lines premium{p.life > 0 ? ` plus your ${plural(p.life, 'life policy', 'life policies')}` : ''} to reach <b>{money0(p.commission)}</b>
            {p.auto.avg > 0 || p.home.avg > 0 ? <>: about {p.auto.avg > 0 && <b>{plural(p.auto.policies, 'auto policy', 'auto policies')}</b>}{p.auto.avg > 0 && p.home.avg > 0 ? ' or ' : ''}{p.home.avg > 0 && <b>{plural(p.home.policies, 'home policy', 'home policies')}</b>}
              <span className="hgx-dim"> ({[p.auto.avg > 0 && `${avg(p.auto.from)} auto ${money0(p.auto.avg)}`, p.home.avg > 0 && `${avg(p.home.from)} home ${money0(p.home.avg)}`].filter(Boolean).join(' · ')}, last 12 months)</span></> : null}</>}
      </p>}
    </section>
  )
}

/** the PTO streak as a card (where the banner isn't shown) */
function StreakMeter({ s }: { s: Streak }) {
  const run = PTO_INCENTIVE.run
  return (
    <div className="hgx-q">
      <div className="hgx-q-l"><span className="hgx-q-i" aria-hidden="true">🔥</span><span>Mission chain · PTO</span></div>
      <div className="hgx-q-v"><b>{s.run}</b><span>/ {run} days</span></div>
      <Dots s={s} small />
      <div className="hgx-q-s">{s.earned > 0 ? <b className="hgx-win">🏖️ {plural(s.earned, 'PTO day')} unlocked</b> : s.run === run - 1 ? 'One more day for a full PTO day!' : `${plural(run - s.run, 'more day')} to unlock PTO`}</div>
    </div>
  )
}

export function Dots({ s, small }: { s: Streak; small?: boolean }) {
  const run = PTO_INCENTIVE.run, todayOpen = s.days.at(-1)?.met === null
  return (
    <div className={'gh-dots' + (small ? ' sm' : '')} aria-label={`${s.run} of ${run} days in a row`}>
      {Array.from({ length: run }, (_, i) => <span key={i} className={i < s.run ? 'on' : i === s.run && todayOpen ? 'now' : ''}>{i < s.run ? '★' : '☆'}</span>)}
    </div>
  )
}

/** the banner at the top of the Scoreboard while the PTO incentive runs: how close you are to a full day of PTO */
export function GoalHero({ name }: { name: string }) {
  const today = todayPacific()
  const data = useAsync(async () => streakFor(name, await streakData(today), today), [name, today])
  const s = data.data, run = PTO_INCENTIVE.run
  const left = s ? run - s.run : run, todayOpen = s?.days.at(-1)?.met === null
  const line = !s ? 'Loading your streak…'
    : s.run === 0 ? (todayOpen ? 'Set today’s goals and hit them all to start the streak.' : 'Start a new streak: hit every goal today.')
    : left === 1 ? 'Final day! Hit every goal today and the PTO day is yours.'
    : `${plural(s.run, 'day')} down. ${plural(left, 'more day')} to the PTO reward.`
  return (
    <div className="gh" role="region" aria-label="PTO incentive">
      <div className="gh-l">
        <p className="gh-kick">New mission available · ends {mdy(PTO_INCENTIVE.to).slice(0, 5)}</p>
        <p className="gh-title">The {run}-day streak</p>
        <p className="gh-sub"><span>Objective</span> hit every goal you set, {run} working days in a row · <span>Reward</span> <b>1 full day of PTO</b></p>
        <p className="gh-line">{line}</p>
      </div>
      <div className="gh-r">
        {s && <Dots s={s} />}
        {s && <p className="gh-foot">{todayOpen ? 'Today: in progress' : s.days.at(-1)?.met ? 'Today: mission passed ✅' : ''}{s.earned > 0 ? <> · <b>🏖️ {plural(s.earned, 'PTO day')} earned</b></> : null}</p>}
      </div>
    </div>
  )
}

