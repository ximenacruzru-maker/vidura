// The owner's opportunities: open commercial quotes in the AgencyZoom quoted pipeline, and accounts at risk of being
// lost (the same red alerts a client sees on their portal). Used by the Executive Dashboard and the report PDFs.
import type { Json, PerfData } from './perf/data'
import type { Account, BookPolicy } from './books'
import { todayPacific } from './format'

/** A commercial line on the lead or on any of its quotes (BOP, GL, property, workers' comp, commercial auto…). */
const COMMERCIAL = /commercial|\bbop\b|business ?owners|\bgl\b|general liab|workers|work ?comp|\bwc\b|garage|contractor|liquor|cyber|\bepli\b|inland marine|surety|bond/i
export const WINDOW_DAYS = 90
export const ago = (iso: string, to: string) => Math.max(0, Math.round((Date.parse(to) - Date.parse(iso)) / 86400000))
export const us = (iso: string) => iso.slice(5, 7) + '/' + iso.slice(8, 10) + '/' + iso.slice(0, 4)

export function commercialQuotes(D: PerfData, asOf = todayPacific()) {
  const byDay: Record<string, Json> = D.WB_EXTRA?.quotes?.byDay || {}
  const from = new Date(Date.parse(asOf) - WINDOW_DAYS * 86400000).toISOString().slice(0, 10)
  const seen = new Set<string>()
  const open: Json[] = []
  Object.keys(byDay).sort().reverse().forEach((day) => (byDay[day].leads || []).forEach((l: Json) => {
    const key = String(l.leadId || l.name)
    if (seen.has(key)) return
    seen.add(key)
    const quotes: Json[] = l.quotes || []
    const lines = [l.lines || '', ...quotes.map((q) => q.product || '')].join(' ')
    if (!COMMERCIAL.test(lines) || quotes.some((q) => q.sold === true) || !l.quotedPremium) return
    if ((l.quoteDay || day) < from) return
    open.push({ ...l, quoteDay: l.quoteDay || day, carriers: [...new Set(quotes.map((q) => q.carrier).filter(Boolean))].join(', ') })
  }))
  open.sort((a, b) => b.quotedPremium - a.quotedPremium)
  const total = open.reduce((t, l) => t + l.quotedPremium, 0)
  return { top: open.slice(0, 10), count: open.length, total, from }
}

/* ---------- at-risk accounts: the same red alerts a client sees on their portal, across the whole book ---------- */
export interface Risk { account: Account; policy: BookPolicy; issue: string; tier: number; premium: number }
const FINAL = /\bcancel(l)?ed\b(?!.*pending)/i
/** Policies about to be lost — the owner's service work: a pending cancellation or non-pay (commercial first),
 *  "action needed", money due now, or a term that ended without a renewal on file. Personal-lines lapses only count
 *  for 60 days (older ones are a data clean-up, not a save). */
export function atRisk(accounts: Account[], policies: BookPolicy[], today: string): Risk[] {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const out: Risk[] = []
  for (const p of policies) {
    const a = byId.get(p.account_id); if (!a) continue
    const st = p.status || '', biz = /commercial/.test(a.book), prem = Number(p.premium) || 0
    const due = Number(p.data?.amountDueNow) || 0
    const d = p.expiration ? Math.round((Date.parse(p.expiration) - Date.parse(today)) / 86400000) : null
    // a newer policy of the same kind at the same place means it renewed
    const renewed = d != null && d < 0 && policies.some((q) => q !== p && q.account_id === p.account_id && q.product === p.product && (q.location || '') === (p.location || '') && (q.expiration || '') > (p.expiration || ''))
    let issue = '', tier = 0
    if (/non.?pay|cancel|past due|notice of cancel/i.test(st) && !FINAL.test(st)) { issue = `${st}${p.data?.paymentDue ? ` · payment due ${us(String(p.data.paymentDue))}` : ''}`; tier = biz ? 100 : 90 }
    else if (/action/i.test(st)) { issue = 'Action needed'; tier = biz ? 85 : 80 }
    else if (due > 0) { issue = `$${due.toLocaleString()} due now`; tier = biz ? 75 : 70 }
    else if (d != null && d < 0 && !renewed && !FINAL.test(st) && (biz || d >= -60)) { issue = `Term ended ${us(p.expiration!)} — no renewal on file`; tier = biz ? 65 : 60 }
    if (tier) out.push({ account: a, policy: p, issue, tier, premium: prem })
  }
  return out.sort((x, y) => y.tier - x.tier || y.premium - x.premium)
}

