// My goals, in a person's own Space: today's goals (calls and premium written), which they change day to day, with how
// they're doing so far today; and, for a producer, their commission goal for the folio (the commission month) with the
// life policies they plan to write: their commission so far, whether they're on pace, and what's left in personal lines
// premium, as auto or home policies at their average premium over the last year.
import { useEffect, useState } from 'react'
import { Panel, Tile, Tiles } from './ui'
import { useFolio } from './FolioPicker'
import { actuals, goalPlan, myDailyGoal, saveCommissionGoal, saveDailyGoal, workdays, getCommissionGoals } from '../lib/goals'
import { mdy, money0, todayPacific } from '../lib/format'
import { useAsync } from '../lib/useAsync'

const num = (s: string) => { const n = Number(String(s).replace(/[^0-9.]/g, '')); return s.trim() === '' || !isFinite(n) ? null : n }
const mark = (hit: boolean) => (hit ? <span className="goal-mark">✅</span> : null)

export default function MyGoals({ name, commission }: { name: string; commission: boolean }) {
  const today = todayPacific()
  const [tick, setTick] = useState(0)
  const mine = useAsync(() => myDailyGoal(name, today), [name, today, tick])
  const now = useAsync(() => actuals(name, today, today), [name, today, tick])
  const [calls, setCalls] = useState(''), [rev, setRev] = useState(''), [msg, setMsg] = useState('')
  useEffect(() => { const g = mine.data?.goal; setCalls(g?.calls != null ? String(g.calls) : ''); setRev(g?.revenue != null ? String(g.revenue) : '') }, [mine.data])
  const save = async () => {
    setMsg('Saving…')
    try { await saveDailyGoal(name, today, num(calls), num(rev)); setMsg('Saved for today.'); setTick((n) => n + 1) } catch (e: any) { setMsg('Not saved: ' + (e?.message || e)) }
  }
  const set = mine.data?.set, g = mine.data?.goal, a = now.data
  const gCalls = set ? g?.calls ?? null : null, gRev = set ? g?.revenue ?? null : null

  return (
    <Panel title="My goals" sub={`Set today's goals each morning${commission ? ', and your commission goal for the folio' : ''}. The Daily Huddle shows whether you reached them.`}>
      <div className="goal-day">
        <div className="goal-set">
          <p className="goal-h">Today · {mdy(today)}</p>
          <label>Calls<input className="fld" inputMode="numeric" placeholder="e.g. 60" value={calls} onChange={(e) => setCalls(e.target.value)} /></label>
          <label>Premium written<input className="fld" inputMode="decimal" placeholder="e.g. 3000" value={rev} onChange={(e) => setRev(e.target.value)} /></label>
          <button type="button" className="btn-primary" onClick={save}>{set ? 'Update' : 'Set today’s goals'}</button>
          {!set && g && <p className="sub">Filled in from your goals on {mdy(g.day)}. Save to set them for today.</p>}
          {msg && <p className="sub">{msg}</p>}
        </div>
        <Tiles>
          <Tile label="Calls today" value={<>{a ? a.calls : '…'}{gCalls != null && <small> / {gCalls}</small>} {a && gCalls != null ? mark(a.calls >= gCalls) : null}</>}
            sub={gCalls == null ? 'no call goal set for today' : a ? (a.calls >= gCalls ? 'goal reached' : `${gCalls - a.calls} to go`) : ''} tone={a && gCalls != null && a.calls >= gCalls ? 'good' : undefined} />
          <Tile label="Premium written today" value={<>{a ? money0(a.revenue) : '…'}{gRev != null && <small> / {money0(gRev)}</small>} {a && gRev != null ? mark(a.revenue >= gRev) : null}</>}
            sub={gRev == null ? 'no premium goal set for today' : a ? (a.revenue >= gRev ? 'goal reached' : `${money0(gRev - a.revenue)} to go`) : ''} tone={a && gRev != null && a.revenue >= gRev ? 'good' : undefined} />
        </Tiles>
      </div>
      {commission && <CommissionGoal name={name} />}
    </Panel>
  )
}

function CommissionGoal({ name }: { name: string }) {
  const { folios } = useFolio()
  const today = todayPacific()
  const folio = folios.find((f) => f.in_progress) || folios.find((f) => f.start_date <= today && f.end_date >= today)
  const [tick, setTick] = useState(0)
  const saved = useAsync(async () => (folio ? (await getCommissionGoals(folio.start_date)).find((x) => x.name === name) || null : null), [folio?.start_date, name, tick])
  const [goal, setGoal] = useState(''), [life, setLife] = useState(''), [msg, setMsg] = useState('')
  useEffect(() => { setGoal(saved.data?.commission != null ? String(saved.data.commission) : ''); setLife(saved.data ? String(saved.data.life || '') : '') }, [saved.data])
  const target = saved.data?.commission || 0, lifeN = saved.data?.life || 0
  const plan = useAsync(async () => (folio && target > 0 ? goalPlan(folio.start_date, target, lifeN) : null), [folio?.start_date, target, lifeN, tick])
  if (!folio) return null
  const save = async () => {
    setMsg('Saving…')
    try { await saveCommissionGoal(name, folio.start_date, num(goal), Math.max(0, Math.floor(num(life) || 0))); setMsg('Saved.'); setTick((n) => n + 1) } catch (e: any) { setMsg('Not saved: ' + (e?.message || e)) }
  }
  const p = plan.data
  // on pace: the share of the goal earned so far against the share of the folio's working days gone by
  const end = folio.end_date, all = workdays(folio.start_date, end) || 1, gone = Math.min(all, workdays(folio.start_date, today))
  const pct = p && p.commission ? Math.min(100, Math.round((p.current / p.commission) * 100)) : 0, due = Math.round((gone / all) * 100)
  const avgNote = (from: string) => (from === 'yours' ? 'your average' : 'the agency’s average')

  return (
    <div className="goal-comm">
      <div className="goal-set">
        <p className="goal-h">Commission goal · folio {mdy(folio.start_date).slice(0, 5)} – {mdy(end).slice(0, 5)}</p>
        <label>Commission goal<input className="fld" inputMode="decimal" placeholder="e.g. 3000" value={goal} onChange={(e) => setGoal(e.target.value)} /></label>
        <label>Life policies I plan to write<input className="fld" inputMode="numeric" placeholder="e.g. 2" value={life} onChange={(e) => setLife(e.target.value)} /></label>
        <button type="button" className="btn-primary" onClick={save}>{saved.data ? 'Update' : 'Set my goal'}</button>
        {msg && <p className="sub">{msg}</p>}
      </div>
      {!target ? <p className="sub goal-none">Set a commission goal to see what it takes to reach it.</p>
        : plan.error ? <p className="sub goal-none">Couldn’t work out your plan: {String((plan.error as Error).message || plan.error)}</p>
        : !p ? <p className="sub goal-none">Working out your plan…</p> : <div className="goal-plan">
          <Tiles>
            <Tile label="Commission so far" value={<>{money0(p.current)}<small> / {money0(p.commission)}</small></>} sub={`${pct}% of your goal · ${money0(p.premiumSoFar)} written, ${p.policiesSoFar} polic${p.policiesSoFar === 1 ? 'y' : 'ies'}`}
              tone={p.current >= p.commission ? 'good' : undefined} />
            <Tile label="On pace?" value={p.current >= p.commission ? 'Goal reached 🎉' : pct >= due ? 'On track' : 'Behind'} sub={`${due}% of the folio’s working days are gone · ${all - gone} left`}
              tone={p.current >= p.commission || pct >= due ? 'good' : 'warn'} />
            {p.life > 0 && <Tile label={`With your ${p.life} life polic${p.life === 1 ? 'y' : 'ies'}`} value={money0(p.withLife)}
              sub={`at ${p.lifeFrom === 'estimate' ? 'an estimated' : avgNote(p.lifeFrom)} ${money0(p.lifeAvg)} life premium; life also counts toward qualifying`} />}
          </Tiles>
          {p.needPremium === 0 ? <p className="goal-need hit">{p.life > 0 && p.current < p.commission ? `Write your ${p.life} life polic${p.life === 1 ? 'y' : 'ies'} and you’ve reached your goal.` : 'You’ve reached your commission goal. 🎉'}</p>
            : p.needPremium == null ? <p className="goal-need">That goal is beyond what this folio’s premium can pay under the plan. Try a lower goal.</p>
            : <p className="goal-need">You need <b>{money0(p.needPremium)}</b> more personal lines premium{p.life > 0 ? ` (on top of your ${p.life} life polic${p.life === 1 ? 'y' : 'ies'})` : ''} to reach {money0(p.commission)}.
              {(p.auto.avg > 0 || p.home.avg > 0) && <> That’s about {p.auto.avg > 0 && <><b>{p.auto.policies} auto polic{p.auto.policies === 1 ? 'y' : 'ies'}</b> ({avgNote(p.auto.from)} {money0(p.auto.avg)})</>}{p.auto.avg > 0 && p.home.avg > 0 ? ' or ' : ''}{p.home.avg > 0 && <><b>{p.home.policies} home polic{p.home.policies === 1 ? 'y' : 'ies'}</b> ({avgNote(p.home.from)} {money0(p.home.avg)})</>}, based on the last 12 months.</>}</p>}
        </div>}
    </div>
  )
}
