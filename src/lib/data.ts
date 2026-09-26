import { supabase } from './supabase'

export type Role = 'owner' | 'admin' | 'producer' | 'protege' | 'sdr' | 'csr'

export interface StaffAccount {
  user_id: string
  display_name: string
  role: Role
  producer_name: string | null
  active: boolean
  email?: string | null
  access?: Record<string, boolean>
  must_change_password?: boolean
  agency_id: string
  /** The agency this login belongs to (every row the login can reach is this agency's). */
  agency?: { name: string; short_name: string | null; is_demo: boolean; agencyzoom_sync: boolean } | null
  /** Runs Declara itself (public.platform_admins): can see the Agencies page and create agencies. */
  platform_admin?: boolean
}

export interface Folio {
  start_date: string
  end_date: string
  label: string
  in_progress: boolean
}

export interface Policy {
  ref: string
  sale_date: string
  producer: string
  client: string
  line: string | null
  carrier: string | null
  premium: number
  customer_id: string | null
  origin: 'export' | 'sync'
}

export interface QuoteLead {
  lead_id: string
  name: string
  producer: string
  lead_source: string
  quoted_premium: number
  quote_day: string
  lines: string
  sdr_tag: string
  url: string
}

export interface SdrTransfer {
  lead_id: string
  sdr: string
  date_time: string
  month: string
  client: string
  producer: string
  lead_source: string
  status: string
  az_quote_premium: number
  quote_count: number
  az_qualifies: boolean
  bound: boolean
  bound_premium: number
  url: string
}

export interface SdrPeriod {
  month: string
  pay_date: string
  period_label: string
  closed: boolean
  qualified_transfer_bonus: number
  bound_policy_bonus: number
}

/** Page through a table/view 1000 rows at a time (PostgREST's default cap). */
async function all<T>(table: string, build?: (q: any) => any): Promise<T[]> {
  let out: T[] = []
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select('*')
    if (build) q = build(q)
    const { data, error } = await q.range(from, from + 999)
    if (error) throw error
    out = out.concat((data || []) as T[])
    if (!data || data.length < 1000) break
  }
  return out
}

const num = (v: unknown) => Number(v) || 0

/** The agency's name for headings, and its short form for labels like "Ironwood Classroom". */
export const agencyName = (me: StaffAccount | null | undefined) => me?.agency?.name || 'Your agency'
export const agencyShort = (me: StaffAccount | null | undefined) => me?.agency?.short_name || me?.agency?.name || 'Agency'

export async function getMe(): Promise<StaffAccount | null> {
  const { data: u } = await supabase.auth.getUser()
  if (!u.user) return null
  const [{ data }, { data: pa }] = await Promise.all([
    supabase.from('staff_accounts').select('*, agency:agencies(name, short_name, is_demo, agencyzoom_sync)').eq('user_id', u.user.id).maybeSingle(),
    supabase.from('platform_admins').select('user_id').eq('user_id', u.user.id).maybeSingle(),
  ])
  return data ? ({ ...data, platform_admin: !!pa } as StaffAccount) : null
}

export async function getFolios(): Promise<Folio[]> {
  const rows = await all<Folio>('folios', (q) => q.order('start_date', { ascending: false }))
  return rows
}

export async function getPolicies(start: string, end: string): Promise<Policy[]> {
  const rows = await all<Policy>('policies_sold', (q) =>
    q.gte('sale_date', start).lte('sale_date', end).order('sale_date', { ascending: false }))
  return rows.map((r) => ({ ...r, premium: num(r.premium) }))
}

export async function getQuotes(start: string, end: string): Promise<QuoteLead[]> {
  const rows = await all<QuoteLead>('quote_leads', (q) => q.gte('quote_day', start).lte('quote_day', end))
  return rows.map((r) => ({ ...r, quoted_premium: num(r.quoted_premium) }))
}

export async function getSdrPeriods(): Promise<SdrPeriod[]> {
  return all<SdrPeriod>('sdr_pay_periods', (q) => q.order('month', { ascending: false }))
}

export async function getSdrTransfers(month: string): Promise<SdrTransfer[]> {
  const rows = await all<SdrTransfer>('sdr_transfers', (q) => q.eq('month', month).order('date_time', { ascending: false }))
  return rows.map((r) => ({ ...r, az_quote_premium: num(r.az_quote_premium), bound_premium: num(r.bound_premium) }))
}

export async function getLastSync(): Promise<{ finished_at: string | null; status: string; error?: string | null; last_ok?: string | null } | null> {
  const [last, ok] = await Promise.all([
    supabase.from('sync_log').select('finished_at,status,details').eq('source', 'agencyzoom').not('finished_at', 'is', null)
      .order('finished_at', { ascending: false }).limit(1),
    supabase.from('sync_log').select('finished_at').eq('source', 'agencyzoom').in('status', ['success', 'partial'])
      .order('finished_at', { ascending: false }).limit(1),
  ])
  const row = (last.data && last.data[0]) as any
  if (!row) return null
  return { finished_at: row.finished_at, status: row.status, error: row.status === 'error' ? (row.details?.fatal || 'Sync failed') : null, last_ok: (ok.data && ok.data[0] as any)?.finished_at || null }
}

export const isAdmin = (r?: Role | null) => r === 'owner' || r === 'admin'

/** Group rows into [{label, value, n}] sorted by value. */
export function groupSum<T>(rows: T[], key: (r: T) => string, val: (r: T) => number) {
  const m = new Map<string, { label: string; value: number; n: number }>()
  for (const r of rows) {
    const k = key(r) || '(none)'
    const o = m.get(k) || { label: k, value: 0, n: 0 }
    o.value += val(r)
    o.n += 1
    m.set(k, o)
  }
  return [...m.values()].sort((a, b) => b.value - a.value)
}

export const FAMILY_RX = /farmers|foremost/i
