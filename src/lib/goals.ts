// Goals: each person's daily goals (calls and premium written, set in their Space, changed day to day; the Daily
// Huddle shows who reached theirs) and a producer's commission goal for the folio (with the life policies they plan to
// write), which the commissions function turns into the personal lines premium, and the auto or home policies, still
// needed to reach it.
import { supabase } from './supabase'
import { bestCalls } from './ricochet'
import { tidyName } from './teamToday'

export interface DailyGoal { name: string; day: string; calls: number | null; revenue: number | null; edits?: number; edit_day?: string | null }
export interface CommissionGoal { name: string; folio: string; commission: number | null; life: number; edits?: number; edit_day?: string | null }
/** how many times a person can still change a goal today (they get two changes a day after setting it; the owner has no limit) */
export const MAX_GOAL_EDITS = 2
export const editsLeft = (g: { edits?: number; edit_day?: string | null } | null | undefined, today: string) => MAX_GOAL_EDITS - (g && g.edit_day === today ? g.edits || 0 : 0)
export interface GoalPlan {
  producer: string; commission: number; life: number; current: number; withLife: number; premiumSoFar: number; policiesSoFar: number
  lifeAvg: number; lifeFrom: 'yours' | 'agency' | 'estimate'; needPremium: number | null
  auto: { avg: number; from: 'yours' | 'agency'; policies: number }; home: { avg: number; from: 'yours' | 'agency'; policies: number }
}

/** the same person, by full name or first name (Ricochet and AgencyZoom spell names their own way) */
export function samePerson(a: string | null | undefined, b: string | null | undefined) {
  const x = tidyName(a || ''), y = tidyName(b || '')
  if (!x || !y) return false
  return x === y || x.split(' ')[0] === y.split(' ')[0]
}

export async function getDailyGoals(from: string, to: string): Promise<DailyGoal[]> {
  const { data, error } = await supabase.from('daily_goals').select('name, day, calls, revenue').gte('day', from).lte('day', to)
  if (error) throw error
  return (data || []).map((r: any) => ({ ...r, revenue: r.revenue == null ? null : Number(r.revenue) }))
}

/** a person's goals for a day, or (when they haven't set that day's yet) their most recent ones, to start from */
export async function myDailyGoal(name: string, day: string): Promise<{ goal: DailyGoal | null; set: boolean }> {
  const { data, error } = await supabase.from('daily_goals').select('name, day, calls, revenue, edits, edit_day').eq('name', name).lte('day', day).order('day', { ascending: false }).limit(1)
  if (error) throw error
  const g = (data || [])[0] as any
  return { goal: g ? { ...g, revenue: g.revenue == null ? null : Number(g.revenue) } : null, set: !!g && g.day === day }
}

export async function saveDailyGoal(name: string, day: string, calls: number | null, revenue: number | null) {
  const { error } = await supabase.from('daily_goals').upsert({ name, day, calls, revenue, updated_at: new Date().toISOString() }, { onConflict: 'agency_id,name,day' })
  if (error) throw error
}

export async function getCommissionGoals(folio: string): Promise<CommissionGoal[]> {
  const { data, error } = await supabase.from('commission_goals').select('name, folio, commission, life, edits, edit_day').eq('folio', folio)
  if (error) throw error
  return (data || []).map((r: any) => ({ ...r, commission: r.commission == null ? null : Number(r.commission) }))
}

export async function saveCommissionGoal(name: string, folio: string, commission: number | null, life: number) {
  const { error } = await supabase.from('commission_goals').upsert({ name, folio, commission, life, updated_at: new Date().toISOString() }, { onConflict: 'agency_id,name,folio' })
  if (error) throw error
}

/** what it takes to reach a commission goal this folio (worked out on the server, under the comp plan) */
export async function goalPlan(folio: string, commission: number, life: number, producer?: string): Promise<GoalPlan | null> {
  const { data, error } = await supabase.functions.invoke('commissions', { body: { folio, goal: { commission, life, producer } } })
  if (error) {
    const msg = await (error as any).context?.json?.().then((j: any) => j.error).catch(() => null)
    throw new Error(msg || error.message)
  }
  return (data?.goal as GoalPlan) || null
}

/** each producer's commission so far this folio (owner/admins get everyone; anyone else only themselves) */
export async function folioCommissions(folio: string): Promise<{ producer: string; total: number; totalPremium: number; qualifies: boolean }[]> {
  const { data, error } = await supabase.functions.invoke('commissions', { body: { folio } })
  if (error) throw error
  return (data?.results || []) as any[]
}

/** a person's calls and premium written over some days */
export async function actuals(name: string, from: string, to: string) {
  const [calls, sold] = await Promise.all([
    supabase.from('ricochet_calls').select('agent, direction, source, started_at').gte('day', from).lte('day', to).limit(20000)
      .then((r) => (r.error ? [] : bestCalls(r.data as { agent: string | null; direction: string | null; source: string | null; started_at: string | null }[]))),
    supabase.from('policies_sold').select('producer, premium').gte('sale_date', from).lte('sale_date', to).limit(5000)
      .then((r) => (r.error ? [] : (r.data as { producer: string | null; premium: number | string | null }[]))),
  ])
  return {
    calls: calls.filter((c) => samePerson(c.agent, name)).length,
    revenue: sold.filter((s) => samePerson(s.producer, name)).reduce((t, s) => t + (Number(s.premium) || 0), 0),
  }
}

/** Monday–Friday days from a to b (inclusive) */
export function workdays(a: string, b: string) {
  let n = 0
  for (let d = new Date(a + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= b; d.setUTCDate(d.getUTCDate() + 1)) { const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) n++ }
  return n
}

/** The PTO incentive: reach every goal you set (calls and premium written), five working days in a row, and you earn a
 *  full day of PTO. Runs through December 31. Weekends and the days the office is closed don't count either way; a
 *  working day without both goals set, or with one missed, starts the count over. Each run of five earns a day and
 *  the count starts again. Today counts once it's reached, and doesn't break the run while it's still in progress. */
export const PTO_INCENTIVE = { from: '2026-11-25', to: '2026-12-31', run: 5, closed: ['2026-11-26', '2026-12-25'] }

/** is the incentive running on a day */
export const incentiveDay = (day: string) => day >= PTO_INCENTIVE.from && day <= PTO_INCENTIVE.to

export interface StreakData {
  goals: DailyGoal[]
  calls: { day: string; agent: string | null; calls: number }[]
  sales: { day: string; producer: string | null; premium: number }[]
}
export interface Streak { run: number; earned: number; days: { day: string; met: boolean | null }[] }

/** everyone's goals, calls and premium written over the incentive so far */
export async function streakData(today: string): Promise<StreakData> {
  const from = PTO_INCENTIVE.from, to = today < PTO_INCENTIVE.to ? today : PTO_INCENTIVE.to
  if (to < from) return { goals: [], calls: [], sales: [] }
  const [goals, calls, sales] = await Promise.all([
    getDailyGoals(from, to).catch(() => []),
    supabase.rpc('calls_by_day', { p_from: from, p_to: to }).then((r) => ((r.data || []) as any[]).map((x) => ({ day: x.day, agent: x.agent, calls: Number(x.calls) || 0 }))),
    supabase.from('policies_sold').select('sale_date, producer, premium').gte('sale_date', from).lte('sale_date', to).limit(10000)
      .then((r) => ((r.data || []) as any[]).map((x) => ({ day: x.sale_date, producer: x.producer, premium: Number(x.premium) || 0 }))),
  ])
  return { goals, calls, sales }
}

/** a person's run of working days with every goal reached, and the PTO days earned so far */
export function streakFor(name: string, d: StreakData, today: string): Streak {
  const to = today < PTO_INCENTIVE.to ? today : PTO_INCENTIVE.to
  const days: Streak['days'] = []
  let run = 0, earned = 0
  for (let x = new Date(PTO_INCENTIVE.from + 'T12:00:00Z'); x.toISOString().slice(0, 10) <= to; x.setUTCDate(x.getUTCDate() + 1)) {
    const day = x.toISOString().slice(0, 10), wd = x.getUTCDay()
    if (wd === 0 || wd === 6 || PTO_INCENTIVE.closed.includes(day)) continue
    const g = d.goals.find((y) => y.day === day && y.name === name)
    const calls = d.calls.filter((c) => c.day === day && samePerson(c.agent, name)).reduce((t, c) => t + c.calls, 0)
    const prem = d.sales.filter((s) => s.day === day && samePerson(s.producer, name)).reduce((t, s) => t + s.premium, 0)
    const met = !!g && g.calls != null && g.revenue != null && calls >= g.calls && prem >= g.revenue
    if (day === today && !met) { days.push({ day, met: null }); continue }
    days.push({ day, met })
    if (met) { run++; if (run === PTO_INCENTIVE.run) { earned++; run = 0 } } else run = 0
  }
  return { run, earned, days }
}
