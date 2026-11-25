// The agency's goals for the folio, on the owner's Space: premium written against the premium goal, what Farmers pays
// the agency on it (auto 9%, home 12%, business 15%, umbrella 7%, life 50%) against the revenue goal, each against the
// share of the folio's working days gone by; and each producer's commission goal with their commission so far.
import { useState } from 'react'
import { Panel, Tile, Tiles } from './ui'
import { useFolio } from './FolioPicker'
import { folioCommissions, getCommissionGoals, samePerson, workdays } from '../lib/goals'
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
    const [goals, sold, comm, cgoals] = await Promise.all([
      supabase.from('reference_data').select('data').eq('key', 'lg:GOALS').maybeSingle().then((r) => ((r.data?.data || {}) as Record<string, any>)),
      supabase.from('policies_sold').select('producer, premium, carrier, line').gte('sale_date', folio.start_date).lte('sale_date', today).limit(5000)
        .then((r) => (r.data || []) as { producer: string | null; premium: number | string | null; carrier: string | null; line: string | null }[]),
      folioCommissions(folio.start_date).catch(() => []),
      getCommissionGoals(folio.start_date).catch(() => []),
    ])
    const premium = sold.reduce((t, s) => t + (Number(s.premium) || 0), 0)
    const revenue = sold.filter((s) => FARMERS.test(s.carrier || '')).reduce((t, s) => { const r = FARMERS_RATES.find((x) => x.key === revenueLine(s.line)); return t + (r ? (Number(s.premium) || 0) * r.rate : 0) }, 0)
    return { goals, premium, revenue, policies: sold.length, comm, cgoals }
  }, [folio?.start_date, today, tick])
  const [rev, setRev] = useState<string | null>(null), [msg, setMsg] = useState('')
  if (!folio) return null
  const d = data.data
  const all = workdays(folio.start_date, folio.end_date) || 1, gone = Math.min(all, workdays(folio.start_date, today)), due = Math.round((gone / all) * 100)
  const pctOf = (v: number, g: number) => (g ? Math.round((v / g) * 100) : 0)
  const status = (v: number, g: number) => (!g ? undefined : v >= g ? 'good' as const : pctOf(v, g) >= due ? 'good' as const : 'warn' as const)
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

  return (
    <Panel title="Agency goals" sub={`Folio ${mdy(folio.start_date).slice(0, 5)} – ${mdy(folio.end_date).slice(0, 5)} · ${due}% of its working days are gone (${all - gone} left)`}>
      {!d ? <p className="sub">Loading…</p> : <>
        <Tiles>
          <Tile label="Premium written" value={<>{money0(d.premium)}{gPrem ? <small> / {money0(gPrem)}</small> : null}</>} sub={`${d.policies} policies · ${gPrem ? pctOf(d.premium, gPrem) + '% of goal · ' : ''}${word(d.premium, gPrem)}`} tone={status(d.premium, gPrem)} />
          <Tile label="Agency revenue (Farmers commission)" value={<>{money0(d.revenue)}{gRev ? <small> / {money0(gRev)}</small> : null}</>}
            sub={<>{gRev ? `${pctOf(d.revenue, gRev)}% of goal · ` : ''}{word(d.revenue, gRev)} · <button type="button" className="linkbtn" onClick={() => setRev(gRev ? String(gRev) : '')}>{gRev ? 'change goal' : 'set a goal'}</button></>} tone={status(d.revenue, gRev)} />
          <Tile label="Producer commission goals" value={`${rows.filter((r) => r.so >= r.goal).length} of ${rows.length}`} sub={rows.length ? 'reached so far' : 'no producer has set one yet'} />
        </Tiles>
        {rev != null && <div className="goal-set goal-inline"><label>Agency revenue goal for the folio<input className="fld" inputMode="decimal" value={rev} onChange={(e) => setRev(e.target.value)} placeholder="e.g. 9000" /></label>
          <button type="button" className="btn-primary" onClick={saveRev}>Save</button><button type="button" className="btn-ghost" onClick={() => setRev(null)}>Cancel</button>{msg && <span className="sub">{msg}</span>}</div>}
        {rows.length > 0 && <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Producer</th><th className="r">Commission so far</th><th className="r">Goal</th><th>Progress</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.name}><td className="strong">{r.name}{r.life ? <div className="sub">plans {r.life} life polic{r.life === 1 ? 'y' : 'ies'}</div> : null}</td>
              <td className="r mono">{money0(r.so)}<div className="sub">{money0(r.prem)} written{r.qualifies ? '' : ' · not qualified yet'}</div></td>
              <td className="r mono">{money0(r.goal)}</td>
              <td><span className={'pill ' + (r.so >= r.goal || pctOf(r.so, r.goal) >= due ? 'pill-good' : 'pill-warn')}>{pctOf(r.so, r.goal)}% · {word(r.so, r.goal)}</span></td></tr>
          ))}</tbody>
        </table></div>}
      </>}
    </Panel>
  )
}
