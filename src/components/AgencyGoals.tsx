// Team HQ on the owner's Space, arcade style like the Hunter Goal Scoreboard. The agency's goals for the folio: premium written against the premium goal, what Farmers pays
// the agency on it (auto 9%, home 12%, business 15%, umbrella 7%, life 50%) against the revenue goal, each against the
// share of the folio's working days gone by; each producer's commission goal with their commission so far; who's earned
// PTO on the goal streak; and the team's goals for today, which the owner can set and change for anyone, any time.
import { useState } from 'react'
import { Meter } from './MyGoals'
import { useFolio } from './FolioPicker'
import { folioCommissions, getCommissionGoals, getDailyGoals, incentiveDay, PTO_INCENTIVE, samePerson, saveCommissionGoal, saveDailyGoal, streakData, streakFor, workdays } from '../lib/goals'
import { FARMERS_RATES, revenueLine } from '../lib/perf/farmersRevenue'
import { mdy, money0, todayPacific } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

const FARMERS = /farmers|foremost/i

export default function AgencyGoals() {
  const { folios } = useFolio()
  const today = todayPacific()
  const folio = folios.find((f) => f.in_progress) || folios.find((f) => f.start_date <= today && f.end_date >= today)
  const [tick, setTick] = useState(0)
  const data = useAsync(async () => {
    if (!folio) return null
    const [goals, sold, comm, cgoals, runs, team, todays] = await Promise.all([
      supabase.from('reference_data').select('data').eq('key', 'lg:GOALS').maybeSingle().then((r) => ((r.data?.data || {}) as Record<string, any>)),
      supabase.from('policies_sold').select('producer, premium, carrier, line').gte('sale_date', folio.start_date).lte('sale_date', today).limit(5000)
        .then((r) => (r.data || []) as { producer: string | null; premium: number | string | null; carrier: string | null; line: string | null }[]),
      folioCommissions(folio.start_date).catch(() => []),
      getCommissionGoals(folio.start_date).catch(() => []),
      today >= PTO_INCENTIVE.from ? streakData(today).catch(() => null) : Promise.resolve(null),
      supabase.from('staff_accounts').select('display_name, producer_name, role').eq('active', true).neq('role', 'owner').neq('role', 'new_hire')
        .then((r) => ((r.data || []) as { display_name: string | null; producer_name: string | null }[]).map((x) => x.producer_name || x.display_name || '').filter(Boolean)),
      getDailyGoals(today, today).catch(() => []),
    ])
    const premium = sold.reduce((t, s) => t + (Number(s.premium) || 0), 0)
    const revenue = sold.filter((s) => FARMERS.test(s.carrier || '')).reduce((t, s) => { const r = FARMERS_RATES.find((x) => x.key === revenueLine(s.line)); return t + (r ? (Number(s.premium) || 0) * r.rate : 0) }, 0)
    // the PTO incentive: who has earned a day (five working days in a row with every goal reached) and who's close
    const pto = runs ? [...new Set(runs.goals.map((g) => g.name))].map((n) => ({ name: n, ...streakFor(n, runs, today) })).filter((x) => x.earned || x.run) : []
    return { goals, premium, revenue, policies: sold.length, comm, cgoals, pto, team: [...new Set(team)].sort(), todays }
  }, [folio?.start_date, today, tick])
  const [rev, setRev] = useState<string | null>(null), [msg, setMsg] = useState('')
  if (!folio) return null
  const d = data.data
  const all = workdays(folio.start_date, folio.end_date) || 1, gone = Math.min(all, workdays(folio.start_date, today)), due = Math.round((gone / all) * 100)
  const pctOf = (v: number, g: number) => (g ? Math.round((v / g) * 100) : 0)
  const word = (v: number, g: number) => (!g ? 'no goal set' : v >= g ? 'goal reached 🎉' : pctOf(v, g) >= due ? 'on track' : 'behind pace')
  const saveRev = async () => {
    const n = Number(String(rev || '').replace(/[^0-9.]/g, ''))
    setMsg('Saving…')
    const next = { ...(d?.goals || {}), revenue: n > 0 ? n : null }
    const { data: ok, error } = await supabase.from('reference_data').update({ data: next, updated_at: new Date().toISOString() }).eq('key', 'lg:GOALS').select('key')
    if (error || !ok?.length) setMsg('Not saved: ' + (error?.message || 'not allowed')); else { setMsg(''); setRev(null); setTick((n) => n + 1) }
  }
  const gPrem = Number(d?.goals.premium) || 0, gRev = Number(d?.goals.revenue) || 0
  const rows = d ? d.cgoals.filter((g) => g.commission).map((g) => {
    const c = d.comm.find((x) => samePerson(x.producer, g.name))
    return { name: g.name, goal: g.commission || 0, life: g.life, so: c?.total || 0, prem: c?.totalPremium || 0, qualifies: !!c?.qualifies }
  }).sort((a, b) => b.so / (b.goal || 1) - a.so / (a.goal || 1)) : []

  const earnedPto = d ? d.pto.reduce((t, x) => t + x.earned, 0) : 0
  return (
    <section className="hgx" aria-label="Agency goals">
      <div className="hgx-head">
        <div><p className="hgx-kick">Crew HQ · folio {mdy(folio.start_date).slice(0, 5)}–{mdy(folio.end_date).slice(0, 5)}</p><h2 className="hgx-title">Agency goals</h2></div>
        <div className="hgx-head-r"><div className="hgx-score" title="Working days of the folio gone by"><span>Folio day</span><b>{gone} / {all}</b></div></div>
      </div>
      {!d ? <p className="hgx-q-s">Loading…</p> : <>
        <div className="hgx-cards">
          <Meter label="Premium written" icon="💵" value={d.premium} goal={gPrem || null} fmt={money0} foot={gPrem ? `${d.policies} policies · ${word(d.premium, gPrem)}` : 'No premium goal set'} />
          <Meter label="Agency revenue" icon="🏦" value={d.revenue} goal={gRev || null} fmt={money0}
            foot={<>{gRev ? word(d.revenue, gRev) : 'Farmers commission to the agency'} · <button type="button" className="hgx-link" onClick={() => setRev(gRev ? String(gRev) : '')}>{gRev ? 'change goal' : 'set a goal'}</button></>} />
          <div className="hgx-q">
            <div className="hgx-q-l"><span className="hgx-q-i" aria-hidden="true">🏆</span><span>Commission goals</span></div>
            <div className="hgx-q-v"><b>{rows.filter((r) => r.so >= r.goal).length}</b><span>/ {rows.length} reached</span></div>
            <div className="hgx-q-s">{rows.length ? 'producers who reached their goal' : 'No producer has set one yet'}</div>
          </div>
          {(incentiveDay(today) || earnedPto > 0) && <div className={'hgx-q' + (earnedPto ? ' done' : '')}>
            <div className="hgx-q-l"><span className="hgx-q-i" aria-hidden="true">🏖️</span><span>PTO unlocked · thru {mdy(PTO_INCENTIVE.to).slice(0, 5)}</span></div>
            <div className="hgx-q-v"><b>{earnedPto}</b><span>{earnedPto === 1 ? 'day' : 'days'}</span></div>
            <div className="hgx-q-s">{d.pto.length ? d.pto.sort((a, b) => b.earned - a.earned || b.run - a.run).map((x) => `${x.name.split(' ')[0]} ${x.earned ? `🏖️${x.earned}` : ''}${x.run ? ` 🔥${x.run}/${PTO_INCENTIVE.run}` : ''}`).join(' · ') : 'Nobody on a streak yet'}</div>
          </div>}
        </div>
        {rev != null && <div className="hgx-form" style={{ marginTop: 14 }}><div className="hg-fields"><label>Agency revenue goal for the folio<input className="fld" inputMode="decimal" value={rev} onChange={(e) => setRev(e.target.value)} placeholder="9000" /></label>
          <div className="hg-actions"><button type="button" className="hgx-btn go" onClick={saveRev}>Save</button><button type="button" className="hgx-btn" onClick={() => setRev(null)}>Cancel</button></div></div>{msg && <p className="hgx-msg">{msg}</p>}</div>}
        {rows.length > 0 && <div className="hgx-board"><p className="hgx-plan-k">Crew leaderboard · commission goals</p>
          <ol className="gr-list">{rows.map((r, i) => (
            <li key={r.name} className={r.so >= r.goal ? 'won' : ''}>
              <span className="gr-rank">{r.so >= r.goal ? '✅' : ['🥇', '🥈', '🥉'][i] || i + 1}</span>
              <span className="gr-who"><b>{r.name.split(' ')[0]}</b><small>{money0(r.prem)} written{r.qualifies ? '' : ' · not qualified'}</small></span>
              <span className="gr-bars"><span className="gr-bar"><em>{money0(r.so)}/{money0(r.goal)}</em><i><u style={{ width: Math.min(100, pctOf(r.so, r.goal)) + '%' }} className={r.so >= r.goal ? 'full' : ''} /></i></span></span>
              <b className="gr-pct">{pctOf(r.so, r.goal)}%</b>
            </li>))}</ol></div>}
        <TeamGoals team={d.team} todays={d.todays} cgoals={d.cgoals} folio={folio.start_date} today={today} onSaved={() => setTick((n) => n + 1)} />
      </>}
    </section>
  )
}

/** the owner sets or changes anyone's goals: today's calls and premium, and the folio's commission goal and life policies */
function TeamGoals({ team, todays, cgoals, folio, today, onSaved }: {
  team: string[]; todays: { name: string; calls: number | null; revenue: number | null }[]; cgoals: { name: string; commission: number | null; life: number }[]; folio: string; today: string; onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const init = () => Object.fromEntries(team.map((n) => {
    const g = todays.find((x) => x.name === n), c = cgoals.find((x) => x.name === n)
    return [n, { calls: g?.calls != null ? String(g.calls) : '', rev: g?.revenue != null ? String(g.revenue) : '', goal: c?.commission != null ? String(c.commission) : '', life: c?.life ? String(c.life) : '' }]
  }))
  const [f, setF] = useState<Record<string, { calls: string; rev: string; goal: string; life: string }>>(init)
  const [msg, setMsg] = useState('')
  const num = (s: string) => { const n = Number(String(s).replace(/[^0-9.]/g, '')); return s.trim() === '' || !isFinite(n) ? null : n }
  const set = (n: string, k: 'calls' | 'rev' | 'goal' | 'life', v: string) => setF((x) => ({ ...x, [n]: { ...(x[n] || { calls: '', rev: '', goal: '', life: '' }), [k]: v } }))
  const save = async () => {
    setMsg('Saving…')
    try {
      for (const n of team) {
        const r = f[n]; if (!r) continue
        const g = todays.find((x) => x.name === n), c = cgoals.find((x) => x.name === n)
        if (num(r.calls) !== (g?.calls ?? null) || num(r.rev) !== (g?.revenue ?? null)) { if (r.calls || r.rev || g) await saveDailyGoal(n, today, num(r.calls), num(r.rev)) }
        if (num(r.goal) !== (c?.commission ?? null) || (Math.floor(num(r.life) || 0)) !== (c?.life || 0)) { if (r.goal || r.life || c) await saveCommissionGoal(n, folio, num(r.goal), Math.floor(num(r.life) || 0)) }
      }
      setMsg('Saved.'); onSaved()
    } catch (e: any) { setMsg('Not saved: ' + (e?.message || e)) }
  }
  return (
    <div className="hgx-board">
      <div className="hgx-board-h"><p className="hgx-plan-k">Crew goals · today {mdy(today).slice(0, 5)}</p>
        <button type="button" className="hgx-btn" onClick={() => { setF(init()); setOpen(!open) }}>{open ? 'Close' : '✎ Set goals for the team'}</button></div>
      {open && <>
        <div className="tbl-wrap"><table className="hgx-tbl">
          <thead><tr><th>Who</th><th>📞 Calls today</th><th>💵 Premium today</th><th>💼 Commission this folio</th><th>❤️ Life planned</th></tr></thead>
          <tbody>{team.map((n) => (
            <tr key={n}><td className="strong">{n}</td>
              <td><input className="fld" inputMode="numeric" value={f[n]?.calls || ''} onChange={(e) => set(n, 'calls', e.target.value)} aria-label={`${n} calls goal`} /></td>
              <td><input className="fld" inputMode="decimal" value={f[n]?.rev || ''} onChange={(e) => set(n, 'rev', e.target.value)} aria-label={`${n} premium goal`} /></td>
              <td><input className="fld" inputMode="decimal" value={f[n]?.goal || ''} onChange={(e) => set(n, 'goal', e.target.value)} aria-label={`${n} commission goal`} /></td>
              <td><input className="fld" inputMode="numeric" value={f[n]?.life || ''} onChange={(e) => set(n, 'life', e.target.value)} aria-label={`${n} life policies planned`} /></td></tr>
          ))}</tbody>
        </table></div>
        <div className="hg-actions" style={{ marginTop: 10 }}><button type="button" className="hgx-btn go" onClick={save}>Save team goals</button>{msg && <span className="hgx-msg">{msg}</span>}</div>
        <p className="hgx-dim" style={{ margin: '8px 0 0', fontSize: 13 }}>Everyone else can change their own goals twice a day; you can change anyone’s any time.</p>
      </>}
    </div>
  )
}
