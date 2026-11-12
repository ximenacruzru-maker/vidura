// The Year-End Life Promo (reference_data lg:LIFE_PROMO; see its migration): during the promo a producer is paid a
// share of each life policy's annual premium — 25% to start, 30% once the team passes 40 issued & paid, 35% past 50.
// The rate is set by the team's count when the policy is written (the count on the start date plus every life policy
// written since, in date order) and never changes afterwards. The commissions function applies the same rules.
import { supabase } from './supabase'

export interface PromoTier { after: number; rate: number; label: string }
export interface LifePromo { name: string; headline?: string; from: string; to: string; baseline: number; baselineAsOf: string; goal: number; avgPremium?: number; tiers: PromoTier[]; note?: string }

/** A life policy, by its line or carrier (Life, Individual Life, Farmers New World Life). */
export const isLife = (r: { line?: string | null; carrier?: string | null }) => /life/i.test(String(r.line || '')) || /life/i.test(String(r.carrier || ''))
/** The rate for the team's nth issued & paid case: the highest tier whose count it is past. */
export function rateForCase(p: LifePromo, n: number) {
  let rate = 0
  ;[...p.tiers].sort((a, b) => a.after - b.after).forEach((t) => { if (n > t.after) rate = t.rate })
  return rate
}
/** The tier in force once the team has `count` cases, and the next one to unlock. */
export function tierAt(p: LifePromo, count: number) {
  const ts = [...p.tiers].sort((a, b) => a.after - b.after)
  const i = ts.reduce((k, t, j) => (count >= t.after ? j : k), 0)
  return { now: ts[i], next: ts[i + 1] || null, index: i }
}

interface CaseRow { date: string; client: string; premium: number }
const caseKey = (r: CaseRow) => `${r.date}|${String(r.client || '').trim().toLowerCase()}|${Math.round(r.premium * 100)}`
/** Each life policy written during the promo → its case number and rate. Rows: every producer's life policies. */
export function promoRates(p: LifePromo, rows: CaseRow[]) {
  const inWindow = rows.filter((r) => r.date >= p.from && r.date <= p.to)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.client).localeCompare(String(b.client)) || a.premium - b.premium)
  const out = new Map<string, { n: number; rate: number }>()
  inWindow.forEach((r, i) => { const n = p.baseline + i + 1; out.set(caseKey(r), { n, rate: rateForCase(p, n) }) })
  return { get: (r: CaseRow) => out.get(caseKey(r)) || null }
}

export interface PromoStatus { promo: LifePromo; today: string; written: number }
/** The promo and the team's count, for the banner (null when there is no promo, or it has ended). */
export async function getPromoStatus(): Promise<PromoStatus | null> {
  const { data, error } = await supabase.rpc('life_promo_status')
  if (error || !data) return null
  const s = data as PromoStatus
  return s.today >= s.promo.from && s.today <= s.promo.to ? s : null
}
