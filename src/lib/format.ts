export const money0 = (n: number) =>
  '$' + Math.round(n || 0).toLocaleString('en-US')

export const money2 = (n: number) =>
  '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const pct = (n: number, digits = 0) => `${((n || 0) * 100).toFixed(digits)}%`

/** "2026-09-23" -> "Sep 23" (or with year) without timezone drift. */
export function shortDate(iso: string, withYear = false) {
  if (!iso) return ''
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC',
  })
}

export function mdy(iso: string) {
  return iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : ''
}

/** Today's date in Pacific time as YYYY-MM-DD — the agency's working day. */
export function todayPacific() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export function addDays(iso: string, n: number) {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function timeAgo(ts: string | null) {
  if (!ts) return 'never'
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} hr ago`
  return `${Math.round(h / 24)} days ago`
}

/** An exact moment for the record, in Pacific time: "Wed 10/07/2026 at 2:43:12 PM PT". */
export function issuedAt(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const day = d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: '2-digit', day: '2-digit', year: 'numeric' }).replace(',', '')
  const time = d.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', second: '2-digit' })
  return `${day} at ${time} PT`
}
