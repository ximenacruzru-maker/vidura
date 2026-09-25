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
  { key: 'hr', label: 'HR (timesheets & pay rates)', note: 'Everyone’s hours and hourly rates' },
]

const BASE = ['books', 'resources', 'work', 'chat', 'training', 'passwords']
export function roleDefaults(role: Role): Record<string, boolean> {
  const on = role === 'owner' || role === 'admin' ? SECTIONS.map((s) => s.key) : role === 'protege' ? [...BASE, 'proteges'] : BASE
  return Object.fromEntries(SECTIONS.map((s) => [s.key, on.includes(s.key)]))
}

/** Same rule as the database's staff_can(): admins see everything; others get role defaults plus switches. */
export function can(me: StaffAccount | null | undefined, section: string) {
  if (!me) return false
  if (me.role === 'owner' || me.role === 'admin') return true
  if (section === 'performance') return false
  const a = me.access || {}
  return section in a ? !!a[section] : !!roleDefaults(me.role)[section]
}

export const ROLE_LABEL: Record<string, string> = { owner: 'Agency Owner', admin: 'Admin', producer: 'Producer', protege: 'Protégé', sdr: 'SDR', csr: 'CSR' }
