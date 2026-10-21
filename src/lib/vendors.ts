// Vendors & subscriptions the agency pays for — lead vendors, software, services: what each costs, how it bills, when
// it renews. Owner and admins only (vendor_subscriptions). Contracts are filed with the compliance files (vendor_id).
import { supabase } from './supabase'

export type Kind = 'lead' | 'software' | 'service' | 'other'
export type Billing = 'monthly' | 'quarterly' | 'yearly' | 'one_time'
export interface Vendor { id: string; name: string; kind: Kind; purpose: string | null; cost: number | null; billing: Billing; renews_on: string | null; started_on: string | null; active: boolean; url: string | null; note: string | null; updated_by: string | null; updated_at: string }
export const KIND_LABEL: Record<Kind, string> = { lead: 'Lead vendor', software: 'Software', service: 'Service', other: 'Other' }
export const BILLING_LABEL: Record<Billing, string> = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly', one_time: 'One-time' }

/** What a vendor costs a month on average (one-time costs aren't recurring, so they count as nothing a month). */
export const perMonth = (v: Pick<Vendor, 'cost' | 'billing'>) => { const c = Number(v.cost) || 0; return v.billing === 'monthly' ? c : v.billing === 'quarterly' ? c / 3 : v.billing === 'yearly' ? c / 12 : 0 }

export async function getVendors(): Promise<Vendor[]> {
  const { data, error } = await supabase.from('vendor_subscriptions').select('*').order('active', { ascending: false }).order('name')
  if (error) throw error
  return ((data || []) as Vendor[]).map((v) => ({ ...v, cost: v.cost == null ? null : Number(v.cost) }))
}
export async function saveVendor(v: Partial<Vendor> & { name: string }) {
  const row = { name: v.name.trim(), kind: v.kind || 'software', purpose: v.purpose?.trim() || null, cost: v.cost ?? null, billing: v.billing || 'monthly', renews_on: v.renews_on || null,
    started_on: v.started_on || null, active: v.active ?? true, url: v.url?.trim() || null, note: v.note?.trim() || null }
  const { error } = v.id ? await supabase.from('vendor_subscriptions').update(row).eq('id', v.id) : await supabase.from('vendor_subscriptions').insert(row)
  if (error) throw error
}
export async function removeVendor(id: string) {
  const { error } = await supabase.from('vendor_subscriptions').delete().eq('id', id)
  if (error) throw error
}
