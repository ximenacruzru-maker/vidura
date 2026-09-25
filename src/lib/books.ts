import { supabase } from './supabase'

export type BookKey = 'farmers' | 'commercial' | 'brokered_commercial' | 'brokered_personal'

export const BOOKS: { key: BookKey; label: string; short: string; blurb: string; includes: BookKey[] }[] = [
  { key: 'farmers', label: 'Farmers Commercial', short: 'Farmers Commercial', blurb: 'Farmers commercial and transferred households, by client.', includes: ['farmers'] },
  { key: 'brokered_commercial', label: 'Brokered Commercial', short: 'Brokered Commercial', blurb: 'Binders placed through wholesale brokers and the multi-location owner accounts.', includes: ['brokered_commercial', 'commercial'] },
  { key: 'brokered_personal', label: 'P&C Brokered', short: 'P&C Brokered', blurb: 'Bamboo, Aegis and other brokered personal lines.', includes: ['brokered_personal'] },
]
/** Which tab a stored book belongs to (the owner accounts sit under Brokered commercial). */
export const bookTab = (k: string) => (BOOKS.find((b) => b.includes.includes(k as BookKey))?.key || 'farmers') as BookKey
export const bookLabel = (k: string) => BOOKS.find((b) => b.includes.includes(k as BookKey))?.short || k

export interface Account {
  id: string
  book: BookKey
  name: string
  dba: string | null
  contact: string | null
  phone: string | null
  address: string | null
  producer: string | null
  data: Record<string, any>
}

export interface BookPolicy {
  id: string
  account_id: string
  book: BookKey
  policy_number: string | null
  insured: string | null
  carrier: string | null
  product: string | null
  effective: string | null
  expiration: string | null
  premium: number | null
  status: string | null
  location: string | null
  data: Record<string, any>
}

export interface Doc {
  id: string
  category: string
  account_id: string | null
  policy_number: string | null
  title: string
  file_name: string
  mime: string
  storage_path: string
  size_bytes: number | null
  uploaded: boolean
}

async function pageAll<T>(table: string, cols = '*', build?: (q: any) => any): Promise<T[]> {
  let out: T[] = []
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(cols)
    if (build) q = build(q)
    const { data, error } = await q.range(from, from + 999)
    if (error) throw error
    out = out.concat((data || []) as T[])
    if (!data || data.length < 1000) break
  }
  return out
}

export const getAccounts = (book?: BookKey) =>
  pageAll<Account>('book_accounts', '*', (q) => (book ? q.in('book', BOOKS.find((b) => b.key === book)?.includes || [book]) : q).order('name'))

export async function getBookPolicies(book?: BookKey) {
  const rows = await pageAll<BookPolicy>('book_policies', '*', (q) => (book ? q.in('book', BOOKS.find((b) => b.key === book)?.includes || [book]) : q).order('id'))
  return rows.map((r) => ({ ...r, premium: r.premium == null ? null : Number(r.premium) }))
}

export const getDocs = (accountId?: string) =>
  pageAll<Doc>('documents', '*', (q) => (accountId ? q.eq('account_id', accountId) : q).order('title'))

/** Open a private document through a short-lived signed link. */
export async function openDoc(doc: Doc, download = false) {
  const { data, error } = await supabase.storage.from('documents')
    .createSignedUrl(doc.storage_path, 120, download ? { download: doc.file_name } : undefined)
  if (error || !data) { alert('Could not open that file: ' + (error?.message || 'unknown error')); return }
  window.open(data.signedUrl, '_blank', 'noopener')
}

export async function getReference<T = any>(key: string): Promise<T | null> {
  const { data, error } = await supabase.from('reference_data').select('data').eq('key', key).maybeSingle()
  if (error) throw error
  return (data?.data as T) ?? null
}

/** Days from today (Pacific) until an ISO date; negative when past. */
export function daysUntil(iso: string | null, today: string) {
  if (!iso) return null
  return Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(today + 'T12:00:00Z')) / 86400000)
}

export const fmtBytes = (n: number | null) =>
  !n ? '' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1e3) + ' KB'
