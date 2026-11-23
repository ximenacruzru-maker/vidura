// Retention for a week, on the owner's Space: every client the retention team worked — the daily renewal reviews
// (renewals and reinstatements), the call lists (e.g. the 30/60/90 renewal list) and the retention log — with how the
// call went and the notes, day by day, and the week's totals. Opens on last week (Monday–Sunday); ‹ › moves a week.
import { useMemo, useState } from 'react'
import { Empty, MoreMenu, Panel, Tile, Tiles } from './ui'
import { addDays, mdy, money0, todayPacific } from '../lib/format'
import { downloadSheet } from '../lib/excelExport'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

type Row = { day: string; who: string; client: string; source: string; detail: string; result: string; reached: boolean; findings: string; notes: string }
const KIND: Record<string, string> = { negative: 'Renewal (going up)', positive: 'Renewal', commercial: 'Commercial renewal', reinstatement: 'Reinstatement' }
const CALL: Record<string, string> = { reached: 'Reached', voicemail: 'Left voicemail', no_answer: 'No answer', not_interested: 'Not interested', wrong_number: 'Wrong number' }
const LOG: Record<string, string> = { save: 'Save', loss: 'Loss', cross_sell: 'Cross-sell', new_business: 'New business', review: 'Service' }
const pacificDay = (ts: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(ts))
/** the Monday of the week holding a day */
const monday = (iso: string) => { const d = new Date(iso + 'T12:00:00Z'); return addDays(iso, -((d.getUTCDay() + 6) % 7)) }

async function loadWeek(from: string, to: string): Promise<Row[]> {
  const [rv, cl, lg] = await Promise.all([
    supabase.from('renewal_reviews').select('day, name, kind, client, policy, call1, call2, spoke, emailed, findings, notes').gte('day', from).lte('day', to),
    supabase.from('call_list_items').select('assignee, list_name, list_date, first_name, last_name, line, details, result, notes, findings, called_at').gte('list_date', addDays(from, -120)),
    supabase.from('retention_log').select('day, name, kind, client, premium, reason, note').gte('day', from).lte('day', to),
  ])
  const out: Row[] = []
  for (const r of (rv.data || []) as any[]) {
    const reached = !!r.spoke || r.call1 === 'reached' || r.call2 === 'reached'
    const tries = [r.call1, r.call2].filter(Boolean).map((c: string) => CALL[c] || c)
    out.push({ day: r.day, who: r.name, client: r.client, source: KIND[r.kind] || r.kind, detail: r.policy || '',
      result: reached ? 'Reached' : r.emailed ? 'Emailed' : tries.join(', ') || (r.notes || r.findings ? 'Worked' : 'Not worked'), reached, findings: r.findings || '', notes: r.notes || '' })
  }
  for (const r of (cl.data || []) as any[]) {
    // a call-list client counts on the day it was called; one with notes but no call yet, on the list's day
    const day = r.called_at ? pacificDay(r.called_at) : (r.notes || r.findings) ? r.list_date : null
    if (!day || day < from || day > to) continue
    const d = r.details || {}
    out.push({ day, who: r.assignee, client: [r.first_name, r.last_name].filter(Boolean).join(' '), source: r.list_name,
      detail: [r.line, d.policy && `#${d.policy}`, d.increase ? `+${money0(Number(d.increase))}` : ''].filter(Boolean).join(' · '),
      result: r.result ? CALL[r.result] || r.result : 'Notes only', reached: r.result === 'reached', findings: r.findings || '', notes: r.notes || '' })
  }
  for (const r of (lg.data || []) as any[]) {
    out.push({ day: r.day, who: r.name, client: r.client, source: 'Retention log', detail: (LOG[r.kind] || r.kind) + (r.kind !== 'review' && r.premium ? ` ${money0(Number(r.premium))}` : ''),
      result: LOG[r.kind] || r.kind, reached: false, findings: '', notes: [r.reason, r.note].filter(Boolean).join(' · ') })
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.who.localeCompare(b.who) || a.client.localeCompare(b.client))
}

export default function RetentionWeek() {
  const today = todayPacific()
  const [start, setStart] = useState(() => addDays(monday(today), -7))
  const end = addDays(start, 6)
  const { data, error } = useAsync(() => loadWeek(start, end), [start])
  const rows = useMemo(() => data || [], [data])
  const days = [...new Set(rows.map((r) => r.day))]
  const people = [...new Set(rows.map((r) => r.who))]
  const withNotes = rows.filter((r) => r.notes || r.findings).length
  const thisWeek = start === monday(today)
  const label = `${mdy(start).slice(0, 5)} – ${mdy(end).slice(0, 5)}`
  const exportXlsx = () => downloadSheet(`retention-week-${start}.xlsx`, [['Day', 'Who', 'Client', 'Type', 'Policy / detail', 'Result', 'Findings (before the call)', 'Notes'],
    ...rows.map((r) => [r.day, r.who, r.client, r.source, r.detail, r.result, r.findings, r.notes])], { sheet: 'Retention week' })
  return (
    <Panel title={`Retention · ${thisWeek ? 'this week' : start === addDays(monday(today), -7) ? 'last week' : 'week of ' + mdy(start)}`}
      sub={`${label} · every client worked, with the result and notes${people.length ? ' · ' + people.map((p) => p.split(' ')[0]).join(', ') : ''}`}
      right={<div className="filters">
        <button type="button" className="btn-ghost" onClick={() => setStart(addDays(start, -7))} aria-label="Previous week">‹ Prev</button>
        <button type="button" className="btn-ghost" disabled={thisWeek} onClick={() => setStart(addDays(start, 7))} aria-label="Next week">Next ›</button>
        <MoreMenu title="More" items={[rows.length > 0 && { label: 'Export to Excel', onClick: exportXlsx }]} />
      </div>}>
      {error ? <Empty>Couldn’t load the week.</Empty> : !data ? <Empty>Loading…</Empty> : !rows.length ? <Empty>No retention work logged {label}.</Empty> : <>
        <Tiles>
          <Tile label="Clients worked" value={rows.length} sub={`${days.length} day${days.length === 1 ? '' : 's'} · ${withNotes} with notes`} />
          <Tile label="Reached" value={rows.filter((r) => r.reached).length} sub={`${rows.filter((r) => r.result === 'Emailed').length} emailed`} tone="good" />
          <Tile label="Renewals" value={rows.filter((r) => /renewal/i.test(r.source) && r.source !== 'Retention log').length} sub={`${rows.filter((r) => r.source === 'Renewal (going up)').length} going up`} />
          <Tile label="Reinstatements · call lists" value={`${rows.filter((r) => r.source === 'Reinstatement').length} · ${rows.filter((r) => !KIND_VALUES.has(r.source) && r.source !== 'Retention log').length}`} />
        </Tiles>
        {days.map((d) => (
          <div key={d} className="rw-day">
            <div className="rw-day-h">{new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'numeric', day: 'numeric', timeZone: 'UTC' })} · {rows.filter((r) => r.day === d).length} clients</div>
            <div className="tbl-wrap"><table className="tbl rw-tbl">
              <thead><tr><th>Client</th><th>Type</th><th>Result</th><th>Notes</th></tr></thead>
              <tbody>{rows.filter((r) => r.day === d).map((r, i) => (
                <tr key={d + i}>
                  <td><div className="strong">{r.client}</div>{r.detail && <div className="sub">{r.detail}</div>}{people.length > 1 && <div className="sub">{r.who}</div>}</td>
                  <td className="sub">{r.source}</td>
                  <td><span className={'pill ' + (r.reached ? 'pill-good' : /no answer|voicemail|not worked/i.test(r.result) ? 'pill-warn' : 'pill-muted')}>{r.result}</span></td>
                  <td className="rw-notes">{r.findings && <div><b>Findings:</b> {r.findings}</div>}{r.notes ? <div>{r.notes}</div> : !r.findings && <span className="sub">—</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </div>
        ))}
      </>}
    </Panel>
  )
}
const KIND_VALUES = new Set(Object.values(KIND))
