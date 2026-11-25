// A call-list-focus My Space (Ximena's) laid out like Team Space, with a Christmas look for the season: a board with
// string lights along the top, slow falling snow and holly, the numbers in board tiles (clients worked and reached this
// week and last, what's left on the call list, each renewal window's progress, days to Christmas), then the call list
// itself to work (its own window cards, 0–30 / 31–60 / 61–90 days, filter the clients). Outside the season (Nov 15 – Jan 6) it's the same board without the decorations.
import { useMemo, useState } from 'react'
import { useRetentionTotals } from './RetentionWeek'
import MyGoals from './MyGoals'
import { useAuth } from '../auth'
import { MyCallList, callStats, getCallItems, groupLists, finished } from '../pages/CallLists'
import { todayPacific } from '../lib/format'
import { useAsync } from '../lib/useAsync'

const firstOf = (n: string) => n.trim().split(/\s+/)[0] || ''
const longDate = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })

export default function FocusBoard({ name }: { name: string }) {
  const { me } = useAuth()
  const today = todayPacific()
  const md = today.slice(5)
  const festive = md >= '11-15' || md <= '01-06'
  // days to Christmas (this year's, or next year's once it's past)
  const xmasYear = Number(today.slice(0, 4)) + (md > '12-25' ? 1 : 0)
  const toXmas = Math.round((Date.parse(`${xmasYear}-12-25T12:00:00Z`) - Date.parse(today + 'T12:00:00Z')) / 864e5)
  const [tick, setTick] = useState(0)
  const totals = useRetentionTotals(name, tick)
  const { data } = useAsync(getCallItems, [tick])
  const lists = useMemo(() => groupLists((data || []).filter((r) => r.assignee.toLowerCase() === name.toLowerCase())).filter((l) => l.rows.some((r) => !finished(r))), [data, name])
  const rows = lists.flatMap((l) => l.rows)
  const s = callStats(rows)
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0
  return (
    <div className={'ts fb' + (festive ? ' fb-xmas' : '')}>
      {festive && <div className="fb-lights" aria-hidden="true" />}
      <div className="ts-head">
        <div>
          <p className="hd-kick">{festive ? '🎄 ' : ''}{firstOf(name)}’s Space</p>
          <p className="hd-title">{longDate(today)}</p>
          <p className="ts-date">Your renewal calls{lists.length ? ` · ${lists.map((l) => l.name).join(', ')}` : ''}</p>
        </div>
        {festive && <div className="fb-xmas-count" aria-label={`${toXmas} days to Christmas`}><b>{toXmas}</b><span>{toXmas === 1 ? 'day' : 'days'} to Christmas 🎁</span></div>}
      </div>

      <div className="ts-kpis">
        <div className="ts-k hero"><span>Clients worked · this week</span><b>{totals ? totals.tw.length : '…'}</b><em>{totals ? totals.parts(totals.tw) : ''}</em></div>
        <div className="ts-k"><span>Reached · this week</span><b>{totals ? totals.tw.filter((r) => r.reached).length : '…'}</b><em>{totals ? `${totals.tw.filter((r) => r.result === 'Emailed').length} emailed` : ''}</em></div>
        <div className="ts-k"><span>Clients worked · last week</span><b>{totals ? totals.lw.length : '…'}</b><em>{totals ? `${totals.lw.filter((r) => r.reached).length} reached · ${totals.parts(totals.lw)}` : ''}</em></div>
        <div className="ts-k"><span>Left to call</span><b>{s.left}</b><em>{s.done} of {s.total} done · {s.by.reached} reached</em><span className="ts-bar"><i style={{ width: pct + '%' }} /></span></div>
      </div>

      <div className="fb-work">
        <MyGoals name={name} commission={['producer', 'protege', 'sdr', 'admin'].includes(me?.role || '')} />
        {lists.length ? <MyCallList name={name} full onChange={() => setTick((n) => n + 1)} /> : <p className="ts-none">No call list assigned right now{festive ? ' — enjoy the holidays! ⛄' : '.'}</p>}
      </div>
    </div>
  )
}
