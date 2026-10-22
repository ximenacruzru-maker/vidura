// Reports (owner and admins): the big "Download reports (PDF)" button — pick the period (this folio, last folio, any
// folio, a month, a quarter, the year to date, a full year or any dates) and what goes in it, or a ready-made set:
// the sales report, the accountant's pack or the year-end review.
import { useMemo, useState } from 'react'
import { useAuth } from '../../auth'
import type { PerfData } from '../../lib/perf/data'
import { wbFolioKeys } from '../../lib/perf/data'
import { wbFolioLabel } from '../../lib/perf/reports'
import { PRESETS, SECTIONS, buildReportsPdf, type PdfPeriod, type Section } from '../../lib/reportsPdf'
import { todayPacific } from '../../lib/format'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pad = (n: number) => String(n).padStart(2, '0')
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

export default function ReportsPdfButton({ D }: { D: PerfData }) {
  const { me } = useAuth()
  const [open, setOpen] = useState(false)
  if (me?.role !== 'owner' && me?.role !== 'admin') return null
  return <>
    <button className="rp-pdf-btn" onClick={() => setOpen(true)}><span aria-hidden="true">⬇</span> Download reports (PDF)</button>
    {open && <PdfDialog D={D} agency={me?.agency?.name || 'Agency'} onClose={() => setOpen(false)} />}
  </>
}

function PdfDialog({ D, agency, onClose }: { D: PerfData; agency: string; onClose: () => void }) {
  const today = todayPacific()
  const y = Number(today.slice(0, 4)), mo = Number(today.slice(5, 7))
  const periods = useMemo(() => {
    const keys = wbFolioKeys(D).filter((k) => D.WB_DATA.folio[k]?.start)
    const f = (k: string): PdfPeriod => ({ label: `Folio ${wbFolioLabel(D, k)}`, from: D.WB_DATA.folio[k].start, to: D.WB_DATA.folio[k].end, folioKey: k })
    const out: { group: string; items: { key: string; p: PdfPeriod }[] }[] = []
    out.push({ group: 'Quick picks', items: [
      ...(keys[0] ? [{ key: 'this', p: { ...f(keys[0]), label: `This folio (${wbFolioLabel(D, keys[0])})` } }] : []),
      ...(keys[1] ? [{ key: 'last', p: { ...f(keys[1]), label: `Last folio (${wbFolioLabel(D, keys[1])})` } }] : []),
      { key: 'ytd', p: { label: `Year to date ${y}`, from: `${y}-01-01`, to: today } },
      { key: 'lastyear', p: { label: `Full year ${y - 1}`, from: `${y - 1}-01-01`, to: `${y - 1}-12-31` } },
      { key: 'lastmonth', p: (() => { const m = mo === 1 ? 12 : mo - 1, yy = mo === 1 ? y - 1 : y; return { label: `${MONTHS[m - 1]} ${yy}`, from: `${yy}-${pad(m)}-01`, to: `${yy}-${pad(m)}-${lastDay(yy, m)}` } })() },
    ] })
    out.push({ group: 'A folio', items: keys.slice(0, 18).map((k) => ({ key: 'f:' + k, p: f(k) })) })
    const months: { key: string; p: PdfPeriod }[] = []
    for (let i = 0; i < 18; i++) { let m = mo - i, yy = y; while (m < 1) { m += 12; yy-- } months.push({ key: `m:${yy}-${m}`, p: { label: `${MONTHS[m - 1]} ${yy}`, from: `${yy}-${pad(m)}-01`, to: `${yy}-${pad(m)}-${lastDay(yy, m)}` } }) }
    out.push({ group: 'A month', items: months })
    const qs: { key: string; p: PdfPeriod }[] = []
    let q = Math.ceil(mo / 3), qy = y
    for (let i = 0; i < 8; i++) { const sm = (q - 1) * 3 + 1; qs.push({ key: `q:${qy}-${q}`, p: { label: `Q${q} ${qy}`, from: `${qy}-${pad(sm)}-01`, to: `${qy}-${pad(sm + 2)}-${lastDay(qy, sm + 2)}` } }); q--; if (q < 1) { q = 4; qy-- } }
    out.push({ group: 'A quarter', items: qs })
    out.push({ group: 'A year', items: [0, 1, 2, 3].map((d) => ({ key: `y:${y - d}`, p: { label: d ? `Full year ${y - d}` : `Year ${y} (to date)`, from: `${y - d}-01-01`, to: d ? `${y - d}-12-31` : today } })) })
    return out
  }, [D, today, y, mo])
  const all = periods.flatMap((g) => g.items)
  const [pick, setPick] = useState(all.find((x) => x.key === 'last')?.key || all[0]?.key || 'ytd')
  const [custom, setCustom] = useState({ from: `${y}-01-01`, to: today })
  const [sections, setSections] = useState<Set<Section>>(new Set(PRESETS[0].sections))
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const period: PdfPeriod | null = pick === 'custom' ? (custom.from && custom.to && custom.to >= custom.from ? { label: `${custom.from} to ${custom.to}`, from: custom.from, to: custom.to } : null) : all.find((x) => x.key === pick)?.p || null
  const preset = PRESETS.find((p) => p.sections.length === sections.size && p.sections.every((s) => sections.has(s)))?.key
  const go = async () => {
    if (!period) { setErr('Pick a period (the last day can’t be before the first).'); return }
    if (!sections.size) { setErr('Pick at least one report.'); return }
    setErr(''); setBusy('Starting…')
    try { await buildReportsPdf({ D, period, sections: SECTIONS.map((s) => s.key).filter((k) => sections.has(k)), agency, today, onProgress: setBusy }) } catch (e) { setErr('The PDF couldn’t be made: ' + (e instanceof Error ? e.message : String(e))) }
    setBusy(null)
  }
  return (
    <div className="rp-dlg-ov" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="rp-dlg" role="dialog" aria-modal="true" aria-label="Download reports">
        <div className="rp-dlg-h"><div><b>Download reports (PDF)</b><span>Pick the period and what goes in it.</span></div><button className="rp-dlg-x" onClick={onClose} disabled={!!busy} aria-label="Close">×</button></div>
        <div className="rp-dlg-b">
          <div className="rp-dlg-l">Period</div>
          <select className="f rp-dlg-f" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Period">
            {periods.map((g) => <optgroup key={g.group} label={g.group}>{g.items.map((x) => <option key={x.key} value={x.key}>{x.p.label}</option>)}</optgroup>)}
            <optgroup label="Other"><option value="custom">Pick dates…</option></optgroup>
          </select>
          {pick === 'custom' && <div className="rp-dlg-dates"><input className="f" type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="From" /><span>to</span><input className="f" type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="To" /></div>}
          <div className="rp-dlg-l">Ready-made sets</div>
          <div className="rp-dlg-presets">{PRESETS.map((p) => <button key={p.key} className={'rp-dlg-preset' + (preset === p.key ? ' on' : '')} onClick={() => { setSections(new Set(p.sections)); if (p.key === 'yearend' && !pick.startsWith('y:') && pick !== 'lastyear') setPick('lastyear') }}>{p.label}</button>)}</div>
          {(['Sales & production', 'For the accountant', 'People & compliance'] as const).map((g) => (
            <div key={g} className="rp-dlg-g"><div className="rp-dlg-l">{g}</div>
              {SECTIONS.filter((s) => s.group === g).map((s) => (
                <label key={s.key} className="rp-dlg-c"><input type="checkbox" checked={sections.has(s.key)} onChange={(e) => { const n = new Set(sections); if (e.target.checked) n.add(s.key); else n.delete(s.key); setSections(n) }} />
                  <span><b>{s.label}</b><small>{s.note}</small></span></label>
              ))}
            </div>
          ))}
          {err && <div className="rp-dlg-err">{err}</div>}
        </div>
        <div className="rp-dlg-foot">
          <span className="rp-dlg-note">{period ? `${period.label} · ${sections.size} report${sections.size === 1 ? '' : 's'}` : ''}</span>
          <button className="rp-pdf-btn" disabled={!!busy} onClick={go}>{busy || 'Make the PDF'}</button>
        </div>
      </div>
    </div>
  )
}
