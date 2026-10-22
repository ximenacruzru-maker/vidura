import type { Role, StaffAccount } from './data'

/** Sections an admin can switch on or off per person on the Team & access page. */
export const SECTIONS: { key: string; label: string; note: string }[] = [
  { key: 'performance', label: 'Performance (admins only)', note: 'Agency-wide numbers and everyone’s pay. Staff see only their own pay under My Pay.' },
  { key: 'books', label: 'P&C book & renewals', note: 'Clients, policies and their documents' },
  { key: 'resources', label: 'Agency Resources', note: 'Forms, carrier markets, appetite guide, platforms' },
  { key: 'work', label: 'Work queue', note: 'Shared work items' },
  { key: 'chat', label: 'Team chat', note: 'Channels and direct messages' },
  { key: 'training', label: 'Training', note: 'New Agent Training classroom' },
  { key: 'proteges', label: 'Protégé program', note: 'Milestones and training checklist for protégés' },
  { key: 'passwords', label: 'Agency passwords', note: 'View and copy the saved logins — on for everyone by default; only admins can add or change them' },
  { key: 'hr', label: 'HR (timesheets, pay rates & employee files)', note: 'Owner and admins only — hours, pay, W-4s, the agency’s legal records' },
  { key: 'retention', label: 'Retention scorecard', note: 'Owns client success and retention: the daily huddle scorecard, saves, losses and cross-sell, Net Book Movement; My Space shows retention instead of the sales pipeline' },
  { key: 'producer_path', label: 'Path to producer', note: 'Someone training to become a producer: Training sits at the very top of their menu and shows Farmers University only' },
  { key: 'commissions_only', label: 'My Commissions only', note: 'For an SDR who should see nothing but their own commissions: every other page is hidden except Farmers University and their Settings. Turning it on switches the other sections off' },
  { key: 'commission_sheet', label: 'Commission sheet (payroll)', note: 'For whoever runs payroll: a Commissions tab to download each 21st payday’s sheet — every producer’s commission and every SDR’s bonus. No hours, pay rates or salaries' },
  { key: 'work_manager', label: 'Runs the work queue', note: 'Sees every work item and assigns them to anyone; everyone else sees only the work assigned to them (admins see all)' },
]

const BASE = ['books', 'resources', 'work', 'chat', 'training', 'passwords']
export function roleDefaults(role: Role): Record<string, boolean> {
  const on = role === 'owner' || role === 'admin' ? SECTIONS.map((s) => s.key).filter((k) => k !== 'commissions_only') : role === 'protege' ? [...BASE, 'proteges'] : role === 'new_hire' ? ['training'] : BASE
  return Object.fromEntries(SECTIONS.map((s) => [s.key, on.includes(s.key)]))
}

/** Same rule as the database's staff_can(): admins see everything; others get role defaults plus switches. */
export function can(me: StaffAccount | null | undefined, section: string) {
  if (!me) return false
  if (me.role === 'owner' || me.role === 'admin') return true
  // everyone's numbers, everyone's pay (Office payroll) and HR records are for the owner and admins only
  if (section === 'performance' || section === 'payroll' || section === 'hr') return false
  const a = me.access || {}
  if (a.commissions_only) return section === 'commissions_only'
  return section in a ? !!a[section] : !!roleDefaults(me.role)[section]
}

/** On the path to producer: Training first in the menu, Farmers University only. Never applies to admins. */
export function producerPath(me: StaffAccount | null | undefined) {
  return !!me && me.role !== 'owner' && me.role !== 'admin' && !!(me.access || {}).producer_path
}

/** Someone switched to "My Commissions only": the app is just their My Commissions page. Never applies to admins. */
export function commissionsOnly(me: StaffAccount | null | undefined) {
  return !!me && me.role !== 'owner' && me.role !== 'admin' && !!(me.access || {}).commissions_only
}

export const ROLE_LABEL: Record<string, string> = { owner: 'Agency Owner', admin: 'Admin', producer: 'Producer', protege: 'Protégé', sdr: 'SDR', csr: 'CSR', va: 'VA', new_hire: 'New hire (SDR)' }
