import { supabase } from './supabase'

/** The client portal's view of a file: client-safe fields only (the database never sends the agency's internal notes). */
export interface ClientPolicy {
  id: string; account_id: string; policy_number: string | null; insured: string | null; carrier: string | null; product: string | null
  effective: string | null; expiration: string | null; premium: number | null; status: string | null; location: string | null
  location_id: string | null; location_name: string | null; location_address: string | null; coverage: string | null
  amount_due_now: number | null; financed: boolean; payment_due: string | null; payment_plan: string | null; payment_method: string | null; updated_at: string
  invoice_number?: string | null; payment_status?: string | null
}
export interface ClientDoc { id: string; category: string; account_id: string; policy_number: string | null; title: string; file_name: string; mime: string; storage_path: string; size_bytes: number | null; created_at: string }
export interface ClientItem { id: number; account_id: string; kind: 'pending' | 'update'; title: string; detail: string | null; due_on: string | null; status: 'open' | 'done'; created_at: string; updated_at: string; done_at: string | null; created_by?: string | null }
/** Optional, set by the agency for the portal: how carrier totals are grouped and who the producer is for each group. */
export interface PortalGroup { label: string; carriers: string[]; producer?: string | null }
export interface ClientAccount { id: string; name: string; dba: string | null; contact: string | null; phone: string | null; address: string | null; locations: { id: string; name: string; address: string }[]; portal?: { groups?: PortalGroup[] } | null }
export interface ClientFile {
  viewer: { preview: boolean; display_name: string | null; email?: string; must_change_password: boolean }
  agency: { name: string; short_name: string | null } | null
  accounts: ClientAccount[]; policies: ClientPolicy[]; documents: ClientDoc[]; items: ClientItem[]; updated_at: string | null
}

/** The signed-in client's own file, or (staff with Books access) a preview of one account exactly as its client sees it. */
export async function getClientFile(previewAccount?: string): Promise<ClientFile | null> {
  const { data, error } = await supabase.rpc('client_portal', previewAccount ? { p_account: previewAccount } : {})
  if (error) throw error
  if (!data) return null
  const f = data as ClientFile
  f.policies = f.policies.map((p) => ({ ...p, premium: p.premium == null ? null : Number(p.premium), amount_due_now: p.amount_due_now == null ? null : Number(p.amount_due_now) }))
  return f
}

export async function openClientDoc(d: ClientDoc, download = false) {
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(d.storage_path, 120, download ? { download: d.file_name } : undefined)
  if (error || !data) { alert('Could not open that file: ' + (error?.message || 'unknown error')); return }
  window.open(data.signedUrl, '_blank', 'noopener')
}

/* ---------- staff side: what the agency posts to a client's portal, and the client's login ---------- */
export async function getClientItems(accountId: string): Promise<ClientItem[]> {
  const { data, error } = await supabase.from('client_items').select('*').eq('account_id', accountId).order('status').order('created_at', { ascending: false })
  if (error) throw error
  return (data || []) as ClientItem[]
}
export async function addClientItem(item: { account_id: string; kind: 'pending' | 'update'; title: string; detail?: string; due_on?: string | null }) {
  const { error } = await supabase.from('client_items').insert({ ...item, detail: item.detail || null, due_on: item.due_on || null })
  if (error) throw error
}
export async function setClientItemStatus(id: number, status: 'open' | 'done') {
  const { error } = await supabase.from('client_items').update({ status }).eq('id', id)
  if (error) throw error
}

export interface ClientLogin { user_id: string; account_ids: string[]; display_name: string; email: string; active: boolean; must_change_password: boolean; created_at: string; created_by: string | null; last_sign_in_at: string | null }
async function staffAdmin(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('staff-admin', { body })
  if (error) {
    let msg = error.message
    try { msg = (await (error as any).context?.json())?.error || msg } catch { /* not JSON */ }
    throw new Error(msg)
  }
  return data
}
export const listClientLogins = async (accountId: string): Promise<ClientLogin[]> => (await staffAdmin({ action: 'client_list', account_id: accountId })).clients || []
export const createClientLogin = (b: { account_ids: string[]; email: string; display_name: string; password: string }) => staffAdmin({ action: 'client_create', ...b })
export const setClientLoginActive = (user_id: string, active: boolean) => staffAdmin({ action: 'client_update', user_id, active })
export const resetClientPassword = (user_id: string, password: string) => staffAdmin({ action: 'client_reset_password', user_id, password })
