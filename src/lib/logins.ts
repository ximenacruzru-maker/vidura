import { supabase } from './supabase'

export interface Login { id: string; grp: string; name: string; url: string | null; username: string | null; notes: string | null; has_secret: boolean; updated_by: string | null; updated_at: string }

export async function getLogins(): Promise<Login[]> {
  const { data, error } = await supabase.from('agency_logins').select('*').order('grp').order('name')
  if (error) throw error
  return (data || []) as Login[]
}

/** Decrypts one saved password on the server. Every call is logged in the activity list. */
export async function revealLogin(id: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('agency_login_reveal', { p_id: id })
  if (error) { alert(error.message); return null }
  return (data as string | null) || ''
}

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true } catch { return false }
}

const tight = (s: string | null | undefined) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const host = (u: string | null | undefined) => {
  if (!u) return ''
  try { return new URL(/^https?:/i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '').toLowerCase() } catch { return '' }
}
/** Finds the saved logins that belong to a carrier or system card: same website, or the carrier's name in the login name. */
export function loginsFor(all: Login[], card: { name?: string; match?: string; portal?: string; url?: string }) {
  const h = host(card.portal || card.url)
  const keys = [tight(card.match), tight(card.name)].filter((k) => k.length >= 4)
  return all.filter((l) => (h && host(l.url) === h) || keys.some((k) => tight(l.name).includes(k) || (k.length >= 6 && k.includes(tight(l.name)) && tight(l.name).length >= 4)))
}
