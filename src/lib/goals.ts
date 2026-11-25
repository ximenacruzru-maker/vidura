// Goals: each person's daily goals (calls and premium written, set in their Space, changed day to day; the Daily
// Huddle shows who reached theirs) and a producer's commission goal for the folio (with the life policies they plan to
// write), which the commissions function turns into the personal lines premium, and the auto or home policies, still
// needed to reach it.
import { supabase } from './supabase'
import { bestCalls } from './ricochet'
import { tidyName } from './teamToday'

export interface DailyGoal { name: string; day: string; calls: number | null; revenue: number | null }
export interface CommissionGoal { name: string; folio: string; commission: number | null; life: number }
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
  const { data, error } = await supabase.from('daily_goals').select('name, day, calls, revenue').eq('name', name).lte('day', day).order('day', { ascending: false }).limit(1)
  if (error) throw error
  const g = (data || [])[0] as any
  return { goal: g ? { ...g, revenue: g.revenue == null ? null : Number(g.revenue) } : null, set: !!g && g.day === day }
}

export async function saveDailyGoal(name: string, day: string, calls: number | null, revenue: number | null) {
  const { error } = await supabase.from('daily_goals').upsert({ name, day, calls, revenue, updated_at: new Date().toISOString() }, { onConflict: 'agency_id,name,day' })
  if (error) throw error
}

export async function getCommissionGoals(folio: string): Promise<CommissionGoal[]> {
  const { data, error } = await supabase.from('commission_goals').select('name, folio, commission, life').eq('folio', folio)
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
