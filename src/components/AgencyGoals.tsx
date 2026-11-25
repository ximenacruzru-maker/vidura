// Team HQ, arcade style like the Hunter Goal Scoreboard, on everyone's Space: premium written against the agency's goal
// for the folio, the commission-goal leaderboard (everyone sees the ranking and percentages; the owner and admins also
// see the dollars), and who's earned PTO on the goal streak. Agency revenue (what Farmers pays the agency: auto 9%,
// home 12%, business 15%, umbrella 7%, life 50%) is for the owner only. The owner and admins can set and change anyone's
// goals here (Team goals); everyone else changes only their own, on their Scoreboard.
import { useState } from 'react'
import { useAuth } from '../auth'
import { Meter } from './MyGoals'
import { useFolio } from './FolioPicker'
import { agencyGoals, commissionBoard, samePerson, type BoardRow, type StreakData, getCommissionGoals, getDailyGoals, incentiveDay, PTO_INCENTIVE, saveCommissionGoal, saveDailyGoal, streakData, streakFor, workdays } from '../lib/goals'
import { FARMERS_RATES, revenueLine } from '../lib/perf/farmersRevenue'
import { mdy, money0, todayPacific } from '../lib/format'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

const FARMERS = /farmers|foremost/i

export default function AgencyGoals() {
  const { folios } = useFolio()
  const today = todayPacific()
  const { me } = useAuth()
  const owner = me?.role === 'owner', admin = owner || me?.role === 'admin'
  const folio = folios.find((f) => f.in_progress) || folios.find((f) => f.start_date <= today && f.end_date >= today)
  const [tick, setTick] = useState(0)
  const data = useAsync(async () => {
    if (!folio) return null
    const [goals, sold, board, cgoals, runs, team, todays] = await Promise.all([
      agencyGoals(admin).catch(() => ({} as Record<string, any>)),
      supabase.from('policies_sold').select('producer, premium, carrier, line').gte('sale_date', folio.start_date).lte('sale_date', today).limit(5000)
        .then((r) => (r.data || []) as { producer: string | null; premium: number | string | null; carrier: string | null; line: string | null }[]),
      commissionBoard(folio.start_date).catch(() => []),
      admin ? getCommissionGoals(folio.start_date).catch(() => []) : Promise.resolve([]),
      today >= PTO_INCENTIVE.from ? streakData(today).catch(() => null) : Promise.resolve(null),
      admin ? supabase.from('staff_accounts').select('display_name, producer_name, role').eq('active', true).neq('role', 'owner').neq('role', 'new_hire')
        .then((r) => ((r.data || []) as { display_name: string | null; producer_name: string | null }[]).map((x) => x.producer_name || x.display_name || '').filter(Boolean)) : Promise.resolve([] as string[]),
      getDailyGoals(today, today).catch(() => []),
    ])
    const premium = sold.reduce((t, s) => t + (Number(s.premium) || 0), 0)
    const revenue = !owner ? 0 : sold.filter((s) => FARMERS.test(s.carrier || '')).reduce((t, s) => { const r = FARMERS_RATES.find((x) => x.key === revenueLine(s.line)); return t + (r ? (Number(s.premium) || 0) * r.rate : 0) }, 0)
    // the PTO incentive: who has earned a day (five working days in a row with every goal reached) and who's close
    const pto = runs ? [...new Set(runs.goals.map((g) => g.name))].map((n) => ({ name: n, ...streakFor(n, runs, today) })).filter((x) => x.earned || x.run) : []
    return { goals, premium, revenue, policies: sold.length, board, cgoals, pto, runs, team: [...new Set(team)].sort(), todays }
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
  const rows = d ? d.board : []

  const earnedPto = d ? d.pto.reduce((t, x) => t + x.earned, 0) : 0
  return (
    <section className="hgx" aria-label="Agency goals">
      <div className="hgx-head">
        <div><p className="hgx-kick">TEAM HQ · FOLIO {mdy(folio.start_date).slice(0, 5)}–{mdy(folio.end_date).slice(0, 5)}</p><h2 className="hgx-title">AGENCY GOALS</h2></div>
        <div className="hgx-head-r"><div className="hgx-score" title="Working days of the folio gone by"><span>DAY</span><b>{gone}/{all}</b></div></div>
      </div>
      {!d ? <p className="hgx-q-s">Loading…</p> : <>
        <div className="hgx-cards">
          <Meter label="Premium written" icon="💵" value={d.premium} goal={gPrem || null} fmt={money0} foot={gPrem ? `${d.policies} policies · ${word(d.premium, gPrem)}` : 'No premium goal set'} />
          {owner && <Meter label="Agency revenue · only you see this" icon="🏦" value={d.revenue} goal={gRev || null} fmt={money0}
            foot={<>{gRev ? word(d.revenue, gRev) : 'Farmers commission to the agency'} · <button type="button" className="hgx-link" onClick={() => setRev(gRev ? String(gRev) : '')}>{gRev ? 'change goal' : 'set a goal'}</button></>} />}
          <div className="hgx-q">
            <div className="hgx-q-l"><span className="hgx-q-i" aria-hidden="true">🏆</span><span>Commission goals</span></div>
            <div className="hgx-q-v"><b>{rows.filter((r) => r.reached).length}</b><span>/ {rows.length} reached</span></div>
            <div className="hgx-q-s">{rows.length ? 'producers who reached their goal' : 'No producer has set one yet'}</div>
          </div>
          {(incentiveDay(today) || earnedPto > 0) && <div className={'hgx-q' + (earnedPto ? ' done' : '')}>
            <div className="hgx-q-l"><span className="hgx-q-i" aria-hidden="true">🏖️</span><span>PTO unlocked · thru {mdy(PTO_INCENTIVE.to).slice(0, 5)}</span></div>
            <div className="hgx-q-v"><b>{earnedPto}</b><span>{earnedPto === 1 ? 'day' : 'days'}</span></div>
            <div className="hgx-q-s">{d.pto.length ? d.pto.sort((a, b) => b.earned - a.earned || b.run - a.run).map((x) => `${x.name.split(' ')[0]} ${x.earned ? `🏖️${x.earned}` : ''}${x.run ? ` 🔥${x.run}/${PTO_INCENTIVE.run}` : ''}`).join(' · ') : 'Nobody on a streak yet'}</div>
          </div>}
        </div>
        {owner && rev != null && <div className="hgx-form" style={{ marginTop: 14 }}><div className="hg-fields"><label>Agency revenue goal for the folio<input className="fld" inputMode="decimal" value={rev} onChange={(e) => setRev(e.target.value)} placeholder="9000" /></label>
          <div className="hg-actions"><button type="button" className="hgx-btn go" onClick={saveRev}>Save</button><button type="button" className="hgx-btn" onClick={() => setRev(null)}>Cancel</button></div></div>{msg && <p className="hgx-msg">{msg}</p>}</div>}
        {rows.length > 0 && <div className="hgx-board"><p className="hgx-plan-k">COMMISSION LEADERBOARD</p>
          <ol className="gr-list">{rows.map((r, i) => (
            <li key={r.producer} className={r.reached ? 'won' : ''}>
              <span className="gr-rank">{r.reached ? '✅' : ['🥇', '🥈', '🥉'][i] || i + 1}</span>
              <span className="gr-who"><b>{r.producer.split(' ')[0]}</b><small>{r.premium != null ? `${money0(r.premium)} written` : r.reached ? 'goal reached' : r.pct >= due ? 'on track' : 'chasing'}{r.qualifies ? '' : ' · not qualified yet'}</small></span>
              <span className="gr-bars"><span className="gr-bar"><em>{r.total != null && r.goal != null ? `${money0(r.total)}/${money0(r.goal)}` : `${r.pct}% of goal`}</em><i><u style={{ width: Math.min(100, r.pct) + '%' }} className={r.reached ? 'full' : ''} /></i></span></span>
              <b className="gr-pct">{r.pct}%</b>
            </li>))}</ol></div>}
        {/* everyone sees the breakdown; for anyone but the owner and admins the team is whoever set goals or a commission goal */}
        <TeamBreakdown team={admin ? d.team : [...new Set([...d.todays.map((x) => x.name), ...d.board.map((x) => x.producer)])].sort()} todays={d.todays} board={d.board} runs={d.runs} today={today} appts={admin} />
        {admin && <TeamGoals team={d.team} todays={d.todays} cgoals={d.cgoals} folio={folio.start_date} today={today} onSaved={() => setTick((n) => n + 1)} />}
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
      <div className="hgx-board-h"><p className="hgx-plan-k">TEAM GOALS · TODAY {mdy(today).slice(0, 5)}</p>
        <button type="button" className="hgx-btn" onClick={() => { setF(init()); setOpen(!open) }}>{open ? 'Close' : '✎ Set goals for the team'}</button></div>
      {open && <>
        <div className="tbl-wrap"><table className="hgx-tbl">
          <thead><tr><th>Who</th><th>📞 Calls today</th><th>💵 Premium today</th><th>👾 Commission this folio</th><th>❤️ Life planned</th></tr></thead>
          <tbody>{team.map((n) => (
            <tr key={n}><td className="strong">{n}</td>
              <td><input className="fld" inputMode="numeric" value={f[n]?.calls || ''} onChange={(e) => set(n, 'calls', e.target.value)} aria-label={`${n} calls goal`} /></td>
              <td><input className="fld" inputMode="decimal" value={f[n]?.rev || ''} onChange={(e) => set(n, 'rev', e.target.value)} aria-label={`${n} premium goal`} /></td>
              <td><input className="fld" inputMode="decimal" value={f[n]?.goal || ''} onChange={(e) => set(n, 'goal', e.target.value)} aria-label={`${n} commission goal`} /></td>
              <td><input className="fld" inputMode="numeric" value={f[n]?.life || ''} onChange={(e) => set(n, 'life', e.target.value)} aria-label={`${n} life policies planned`} /></td></tr>
          ))}</tbody>
        </table></div>
        <div className="hg-actions" style={{ marginTop: 10 }}><button type="button" className="hgx-btn go" onClick={save}>Save team goals</button>{msg && <span className="hgx-msg">{msg}</span>}</div>
        <p className="hgx-dim" style={{ margin: '8px 0 0', fontSize: 13 }}>Admins and Shannon can change anyone’s goals any time; everyone else changes their own, twice a day.</p>
      </>}
    </div>
  )
}

/** Shannon's (and the admins') breakdown of everyone's day: appointments set by the SDRs and received by the producers
 *  (SDR transfers), each person's goals for today against what they've done (calls and premium), quotes, how far along
 *  their commission goal is, and their PTO streak */
function TeamBreakdown({ team, todays, board, runs, today, appts }: {
  appts: boolean; team: string[]; todays: { name: string; calls: number | null; revenue: number | null }[]; board: BoardRow[]; runs: StreakData | null; today: string
}) {
  const data = useAsync(async () => {
    const [calls, sold, quotes, transfers] = await Promise.all([
      supabase.rpc('calls_by_day', { p_from: today, p_to: today }).then((r) => ((r.data || []) as any[]).map((x) => ({ agent: x.agent as string | null, n: Number(x.calls) || 0 }))),
      supabase.from('policies_sold').select('producer, premium').eq('sale_date', today).limit(2000).then((r) => (r.data || []) as { producer: string | null; premium: number | string | null }[]),
      supabase.from('quote_leads').select('producer, quoted_premium').eq('quote_day', today).limit(2000).then((r) => (r.data || []) as { producer: string | null; quoted_premium: number | string | null }[]),
      appts ? supabase.from('sdr_transfers').select('sdr, producer, client, az_qualifies, bound').eq('date_time', today).limit(500).then((r) => (r.data || []) as { sdr: string | null; producer: string | null; az_qualifies: boolean; bound: boolean }[]) : Promise.resolve([] as { sdr: string | null; producer: string | null; az_qualifies: boolean; bound: boolean }[]),
    ])
    return { calls, sold, quotes, transfers }
  }, [today])
  const d = data.data
  const rows = team.map((n) => {
    const g = todays.find((x) => x.name === n)
    const c = d ? d.calls.filter((x) => samePerson(x.agent, n)).reduce((t, x) => t + x.n, 0) : 0
    const r = d ? d.sold.filter((x) => samePerson(x.producer, n)).reduce((t, x) => t + (Number(x.premium) || 0), 0) : 0
    const q = d ? d.quotes.filter((x) => samePerson(x.producer, n)) : []
    const set = d ? d.transfers.filter((x) => samePerson(x.sdr, n)) : [], got = d ? d.transfers.filter((x) => samePerson(x.producer, n)) : []
    const b = board.find((x) => samePerson(x.producer, n)), s = runs ? streakFor(n, runs, today) : null
    return { n, g, c, r, q, set, got, b, s }
  }).filter((x) => x.g || x.c || x.r || x.q.length || x.set.length || x.got.length || x.b)
  const by = (list: { sdr?: string | null; producer?: string | null }[], k: 'sdr' | 'producer') => {
    const m: Record<string, number> = {}; list.forEach((x) => { const v = (x[k] || '?').split(' ')[0]; m[v] = (m[v] || 0) + 1 }); return Object.entries(m).map(([a, b2]) => `${a} ${b2}`).join(' · ')
  }
  const cell = (v: number, goal: number | null | undefined, fmt: (n: number) => string) => goal == null ? <span>{fmt(v)} <small className="hgx-dim">no goal</small></span>
    : <span className={'hgx-cell ' + (v >= goal ? 'hit' : '')}>{v >= goal ? '⭐ ' : ''}{fmt(v)} <small>/ {fmt(goal)}</small></span>
  return (
    <div className="hgx-board">
      <p className="hgx-plan-k">TEAM BREAKDOWN · TODAY {mdy(today).slice(0, 5)}</p>
      {!d ? <p className="hgx-q-s">Loading…</p> : !rows.length ? <p className="hgx-q-s">Nothing yet today.</p> : <div className="tbl-wrap"><table className="hgx-tbl hgx-break">
        <thead><tr><th>Who</th>{appts && <th>📅 Appointments</th>}<th>📞 Calls / goal</th><th>💵 Premium / goal</th><th>📝 Quotes</th><th>👾 Commission</th><th>🔥 Streak</th></tr></thead>
        <tbody>{rows.map((x) => (
          <tr key={x.n}>
            <td className="strong">{x.n}</td>
            {appts && <td>{x.set.length ? <span title={by(x.set, 'producer')}>set {x.set.length} <small className="hgx-dim">→ {by(x.set, 'producer')}</small></span> : null}
              {x.got.length ? <span title={by(x.got, 'sdr')}>{x.set.length ? <br /> : null}got {x.got.length} <small className="hgx-dim">from {by(x.got, 'sdr')}</small></span> : null}
              {!x.set.length && !x.got.length ? <small className="hgx-dim">—</small> : null}</td>}
            <td>{cell(x.c, x.g?.calls, (n) => String(n))}</td>
            <td>{cell(x.r, x.g?.revenue, money0)}</td>
            <td>{x.q.length ? <>{x.q.length} <small className="hgx-dim">{money0(x.q.reduce((t, y) => t + (Number(y.quoted_premium) || 0), 0))}</small></> : <small className="hgx-dim">—</small>}</td>
            <td>{x.b ? <span className={'hgx-cell ' + (x.b.reached ? 'hit' : '')}>{x.b.pct}%{x.b.total != null ? <small> {money0(x.b.total)} / {money0(x.b.goal || 0)}</small> : null}</span> : <small className="hgx-dim">no goal</small>}</td>
            <td>{x.s && (x.s.run || x.s.earned) ? <>{x.s.run}/{PTO_INCENTIVE.run}{x.s.earned ? ` · 🏖️ ${x.s.earned}` : ''}</> : <small className="hgx-dim">—</small>}</td>
          </tr>))}</tbody>
      </table></div>}
    </div>
  )
}
