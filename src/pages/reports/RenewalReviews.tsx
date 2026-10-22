// Reports › Renewal reviews (also on the Reports dashboard): the daily renewal review — 20 renewals a workday, 10
// negative and 10 positive — day by day, so the owner (and the reviewer herself) can see the work is getting done:
// how many were worked, how many clients she spoke to, snapshots emailed, renewal options PDFs attached, and any
// workday with nothing reported. Open a day for each client's notes and options PDF, or download that day's report.
import { Fragment, useMemo, useState } from 'react'
import { mdy, todayPacific } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useAsync } from '../../lib/useAsync'
import { DAY_GOAL, GOAL, done, openOptions, reached, reportPdf, signed, type Review } from '../RenewalReview'
import type { LeadFolio } from './LeadSources'

const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const weekday = (iso: string) => new Date(iso + 'T12:00:00Z').getUTCDay()
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) + '%' : '—')

export function RenewalReviews({ folios, agency }: { folios: LeadFolio[]; agency: string }) {
  const today = todayPacific()
  const [period, setPeriod] = useState('week')
  const [person, setPerson] = useState('all')
  const [open, setOpen] = useState<string | null>(null)
  const f = folios.find((x) => x.key === period)
  const from = f ? f.start : period === 'week' ? addDays(today, -((weekday(today) + 6) % 7)) : period === '30' ? addDays(today, -29) : today.slice(0, 4) + '-01-01'
  const to = f && f.end < today ? f.end : today
  const label = f ? f.label : period === 'week' ? 'This week' : period === '30' ? 'Last 30 days' : `Year to date ${today.slice(0, 4)}`

  const all = useAsync(async () => {
    const { data, error } = await supabase.from('renewal_reviews').select('*').order('day', { ascending: false }).order('kind').order('id')
    if (error) throw error
    return (data || []) as Review[]
  }, [])
  const people = useMemo(() => [...new Set((all.data || []).map((r) => r.name))].sort(), [all.data])
  const who = person !== 'all' && people.includes(person) ? person : people.length === 1 ? people[0] : 'all'
  const mine = (all.data || []).filter((r) => who === 'all' || r.name === who)
  const rows = mine.filter((r) => r.day >= from && r.day <= to)

  // each person's workdays (Mon–Fri) from their first reported day, so a day with nothing reported shows up
  const days = useMemo(() => {
    const out: { day: string; name: string; list: Review[] }[] = []
    const names = who === 'all' ? people : [who]
    names.forEach((n) => {
      const first = mine.filter((r) => r.name === n).reduce((m, r) => (r.day < m ? r.day : m), '9999')
      for (let d = to; d >= from && d >= first; d = addDays(d, -1)) {
        const list = rows.filter((r) => r.name === n && r.day === d)
        if (list.length || (weekday(d) !== 0 && weekday(d) !== 6)) out.push({ day: d, name: n, list })
      }
    })
    return out.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.name < b.name ? -1 : 1))
  }, [mine, rows, people, who, from, to])
  const workdays = days.filter((d) => d.day < today || d.list.length).length
  const reported = days.filter((d) => d.list.length).length
  const missed = days.filter((d) => !d.list.length && d.day < today)
  const n = (p: (r: Review) => boolean) => rows.filter(p).length

  return (
    <div className="panel" data-parity="new">
      <div className="panel-h">
        <div><div className="panel-t">Renewal reviews{who === 'all' ? '' : ` · ${who}`}</div>
          <div className="panel-s">{label} · {DAY_GOAL} a workday: {GOAL.negative} negative (premium going up) and {GOAL.positive} positive with a cross-sell · call twice, email the snapshot, attach the renewal options PDF</div></div>
        <div className="fbar" style={{ margin: 0 }}>
          <div className="fb-g"><label className="fl">Period</label>
            <select className="f" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
              <option value="week">This week</option><option value="30">Last 30 days</option>{folios.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}<option value="ytd">Year to date</option>
            </select></div>
          {people.length > 1 && <div className="fb-g"><label className="fl">Person</label>
            <select className="f" value={who} onChange={(e) => setPerson(e.target.value)} aria-label="Person">
              <option value="all">Everyone</option>{people.map((p) => <option key={p} value={p}>{p}</option>)}
            </select></div>}
        </div>
      </div>
      <div className="panel-b" style={{ overflowX: 'auto' }}>
        {all.error ? <div className="empty">Couldn’t load renewal reviews: {String((all.error as Error).message || all.error)}</div> : !all.data ? <div className="empty">Loading renewal reviews…</div> : !days.length ? (
          <div className="empty">No renewal reviews in this period yet.</div>
        ) : <>
          <div className="scgrid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', marginBottom: 14 }}>
            <div className="sccard"><div className="sccard-l">Days reported</div><div className="sccard-v">{reported} / {workdays}</div>
              <div className="sccard-s">{missed.length ? `${missed.length} workday${missed.length > 1 ? 's' : ''} with nothing reported` : 'every workday reported'}</div></div>
            <div className="sccard"><div className="sccard-l">Renewals worked</div><div className="sccard-v">{rows.length} / {workdays * DAY_GOAL}</div>
              <div className="sccard-s">{n((r) => r.kind === 'negative')} negative · {n((r) => r.kind === 'positive')} positive · {pct(rows.length, workdays * DAY_GOAL)} of goal</div></div>
            <div className="sccard"><div className="sccard-l">Reached the client</div><div className="sccard-v">{n(reached)}</div><div className="sccard-s">{pct(n(reached), rows.length)} of renewals worked</div></div>
            <div className="sccard"><div className="sccard-l">No contact, emailed</div><div className="sccard-v">{n((r) => !reached(r) && r.emailed)}</div><div className="sccard-s">{n(done)} of {rows.length} renewals fully handled</div></div>
            <div className="sccard"><div className="sccard-l">Options PDFs attached</div><div className="sccard-v">{n((r) => !!r.options_path)}</div><div className="sccard-s">{pct(n((r) => !!r.options_path), rows.length)} of renewals worked</div></div>
          </div>
          <table className="dect"><thead><tr><th>Day</th>{who === 'all' && <th>Person</th>}<th className="tr">Worked</th><th className="tr">Negative</th><th className="tr">Positive</th><th className="tr">Reached</th><th className="tr">Emailed</th><th className="tr">Options PDFs</th><th></th></tr></thead>
            <tbody>{days.map((d) => {
              const k = d.day + '|' + d.name, c = (p: (r: Review) => boolean) => d.list.filter(p).length
              const neg = c((r) => r.kind === 'negative'), pos = c((r) => r.kind === 'positive')
              return (
                <Fragment key={k}>
                  <tr style={{ cursor: d.list.length ? 'pointer' : undefined }} onClick={() => d.list.length && setOpen(open === k ? null : k)}>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{d.list.length ? (open === k ? '▾ ' : '▸ ') : ''}{mdy(d.day)}</td>{who === 'all' && <td>{d.name}</td>}
                    {d.list.length ? <>
                      <td className="tr mono" style={{ fontWeight: 700, color: d.list.length >= DAY_GOAL ? '#1F7A4D' : undefined }}>{d.list.length} / {DAY_GOAL}</td>
                      <td className="tr mono">{neg} / {GOAL.negative}</td><td className="tr mono">{pos} / {GOAL.positive}</td>
                      <td className="tr mono">{c(reached)}</td><td className="tr mono">{c((r) => r.emailed)}</td><td className="tr mono">{c((r) => !!r.options_path)}</td>
                      <td className="tr"><button className="linkbtn" onClick={(e) => { e.stopPropagation(); reportPdf(d.list, d.name, d.day, agency) }}>Day’s report (PDF)</button></td>
                    </> : <td colSpan={7} style={{ color: d.day < today ? '#B3261E' : 'var(--muted)', fontWeight: 600 }}>{d.day < today ? 'Nothing reported' : 'Not started yet today'}</td>}
                  </tr>
                  {open === k && <tr><td colSpan={who === 'all' ? 9 : 8} style={{ padding: 0 }}>
                    <table className="dect" style={{ margin: '4px 0 10px', fontSize: 12.5 }}><thead><tr><th>Type</th><th>Client</th><th>Policy · renews</th><th className="tr">Change</th><th>Reached</th><th>Emailed</th><th>Options</th><th>Findings · cross-sell · result</th></tr></thead>
                      <tbody>{d.list.map((r) => {
                        const ch = r.current_premium != null && r.renewal_premium != null ? Number(r.renewal_premium) - Number(r.current_premium) : null
                        return (
                          <tr key={r.id}><td>{r.kind === 'negative' ? 'Negative' : 'Positive'}</td><td style={{ fontWeight: 600 }}>{r.client}{r.dnc ? ' · DNC' : ''}</td>
                            <td>{[r.policy, r.renewal_date && mdy(r.renewal_date)].filter(Boolean).join(' · ')}</td><td className="tr mono" style={{ color: ch != null && ch > 0 ? '#B3261E' : undefined }}>{ch == null ? '—' : signed(ch)}</td>
                            <td>{reached(r) ? 'Yes' : 'No'}</td><td>{r.emailed ? 'Yes' : 'No'}</td>
                            <td>{r.options_path ? <button className="linkbtn" onClick={() => openOptions(r)}>Open PDF</button> : '—'}</td>
                            <td style={{ whiteSpace: 'normal', minWidth: 200 }}>{[r.findings && `Findings: ${r.findings}`, r.cross_sell && `Cross-sell: ${r.cross_sell}`, r.notes && `Result: ${r.notes}`].filter(Boolean).join(' — ') || '—'}</td></tr>
                        )
                      })}</tbody></table>
                  </td></tr>}
                </Fragment>
              )
            })}</tbody>
          </table>
        </>}
      </div>
    </div>
  )
}
