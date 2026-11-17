// Ricochet calls as Declara reads them (ricochet_calls: the call webhook, and the every-minute API sync).

/** Ricochet's call webhook reports every call (with talk time); reading calls over the API misses some. A day the
 *  webhook sent calls for uses those; otherwise the API's. */
export const bestCalls = <T extends { source?: string | null }>(rows: T[]) => {
  const hook = rows.some((r) => r.source === 'webhook')
  return rows.filter((r) => (r.source === 'webhook') === hook)
}
/** a call no one picked up (an inbound IVR call with no agent) is shown as such, not as a person */
export const UNANSWERED = 'Unanswered (IVR)'
export const callAgent = (agent: string | null | undefined) => { const a = (agent || '').trim().replace(/\s+/g, ' '); return !a || a === 'Unassigned' ? UNANSWERED : a }
