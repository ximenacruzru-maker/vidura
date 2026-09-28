import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ErrorBox, Loading, Panel } from '../components/ui'
import { useAuth } from '../auth'
import { useAsync } from '../lib/useAsync'
import { todayPacific } from '../lib/format'
import {
  CERT_CSS, EMPTY_PRODUCER, LETTERS, LINES, certificateHTML, coiProblems, getCoiProfile, lineName, mergeInsurers, newCert,
  plusYear, printCertificate, saveCoiProfile, standardOps, type Cert, type Insurer, type LineKey, type Producer,
} from '../lib/coi'

// The certificate being worked on is kept (and saved with the login's other items) so it survives a reload, and a
// second certificate for another holder only needs the holder changed.
const DRAFT = 'declara_coi_draft'
const loadDraft = (today: string): Cert => {
  try { const d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); if (d && d.gl) { const n = newCert(today); return { ...n, ...d, gl: { ...n.gl, ...d.gl }, auto: { ...n.auto, ...d.auto }, umb: { ...n.umb, ...d.umb }, wc: { ...n.wc, ...d.wc }, date: today } } } catch { /* a fresh one */ }
  return newCert(today)
}

const Field = ({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) => <label style={wide ? { gridColumn: '1 / -1' } : undefined}>{label}{children}</label>
const Tick = ({ on, set, children }: { on: boolean; set: (v: boolean) => void; children: ReactNode }) =>
  <label className="coi-tick"><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />{children}</label>

export default function Coi() {
  const { me } = useAuth()
  const today = todayPacific()
  const { data, error } = useAsync(getCoiProfile, [])
  const [producer, setProducer] = useState<Producer | null>(null)
  const [known, setKnown] = useState<Insurer[]>([])
  const [editAgency, setEditAgency] = useState(false)
  const [saving, setSaving] = useState('')
  const [c, setC] = useState<Cert>(() => loadDraft(today))

  useEffect(() => {
    if (!data) return
    const p = data.producer.name ? data.producer : { ...EMPTY_PRODUCER, ...data.producer, name: me?.agency?.name || '' }
    setProducer(p); setKnown(data.insurers); setEditAgency(!data.producer.name)
  }, [data, me])
  useEffect(() => { try { localStorage.setItem(DRAFT, JSON.stringify(c)) } catch { /* not kept */ } }, [c])

  const ops = c.opsEdited ? c.ops : standardOps(c)
  const cert = useMemo(() => ({ ...c, ops }), [c, ops])
  const html = useMemo(() => (producer ? `<!doctype html><html><head><meta charset="utf-8"><style>${CERT_CSS}</style></head><body>${certificateHTML(producer, cert)}</body></html>` : ''), [producer, cert])

  if (error) return <ErrorBox error={error} />
  if (!data || !producer || !me) return <Loading />

  const set = (patch: Partial<Cert>) => setC((x) => ({ ...x, ...patch }))
  const setLine = <K extends LineKey>(k: K, patch: Partial<Cert[K]>) => setC((x) => {
    const next = { ...x[k], ...patch } as Cert[K]
    // a policy usually runs a year: fill the expiration from the effective date until one is typed
    if ('eff' in patch && (!x[k].exp || x[k].exp === plusYear(x[k].eff))) next.exp = plusYear(patch.eff as string)
    return { ...x, [k]: next }
  })
  const setInsurer = (i: number, patch: Partial<Insurer>) => setC((x) => {
    const insurers = x.insurers.map((r, n) => (n === i ? { ...r, ...patch } : r))
    // a company used before brings its NAIC number with it
    if (patch.name != null && !insurers[i].naic) { const k = known.find((r) => r.name.toLowerCase() === patch.name!.trim().toLowerCase()); if (k) insurers[i].naic = k.naic }
    return { ...x, insurers }
  })
  const removeInsurer = (i: number) => setC((x) => {
    const fix = <T extends { ins: number }>(l: T) => ({ ...l, ins: l.ins === i ? 0 : l.ins > i ? l.ins - 1 : l.ins })
    return { ...x, insurers: x.insurers.filter((_, n) => n !== i), gl: fix(x.gl), auto: fix(x.auto), umb: fix(x.umb), wc: fix(x.wc) }
  })

  const saveAgency = async () => {
    setSaving('agency')
    try { await saveCoiProfile(me.agency_id, { producer }); setEditAgency(false) } catch (e) { alert('Could not save the agency details: ' + (e as Error).message) } finally { setSaving('') }
  }
  const problems = coiProblems(producer, cert)
  const issue = async () => {
    if (problems.length) return
    printCertificate(producer, cert)
    const merged = mergeInsurers(known, c.insurers)
    if (JSON.stringify(merged) !== JSON.stringify(known)) { setKnown(merged); saveCoiProfile(me.agency_id, { insurers: merged }).catch(() => { /* kept for next time */ }) }
  }
  const P = (k: keyof Producer) => ({ value: producer[k], onChange: (e: { target: { value: string } }) => setProducer({ ...producer, [k]: e.target.value }) })
  const on = LINES.filter((l) => c[l.key].on)
  const letterPick = (k: LineKey) => (
    <Field label="Insurance company">
      <select className="fld" value={c[k].ins} onChange={(e) => setLine(k, { ins: +e.target.value } as never)}>
        {c.insurers.map((r, i) => <option key={i} value={i}>{LETTERS[i]} · {r.name || '(not typed yet)'}</option>)}
      </select>
    </Field>
  )
  const common = (k: LineKey, addl = true) => <>
    {letterPick(k)}
    <Field label="Policy number"><input className="fld" value={c[k].policy} onChange={(e) => setLine(k, { policy: e.target.value } as never)} /></Field>
    <Field label="Effective"><input className="fld" type="date" value={c[k].eff} onChange={(e) => setLine(k, { eff: e.target.value } as never)} /></Field>
    <Field label="Expiration"><input className="fld" type="date" value={c[k].exp} onChange={(e) => setLine(k, { exp: e.target.value } as never)} /></Field>
    <div className="coi-ticks" style={{ gridColumn: '1 / -1' }}>
      {addl && <Tick on={c[k].addl} set={(v) => setLine(k, { addl: v } as never)}>Holder is an additional insured</Tick>}
      <Tick on={c[k].subr} set={(v) => setLine(k, { subr: v } as never)}>Waiver of subrogation</Tick>
    </div>
  </>
  const amt = <K extends LineKey>(k: K, f: keyof Cert[K] & string, label: string) =>
    <Field label={label}><input className="fld" inputMode="numeric" value={String(c[k][f] ?? '')} onChange={(e) => setLine(k, { [f]: e.target.value } as never)} /></Field>

  return (
    <>
      <div className="note-box coi-warn"><b>This is a tool.</b> Please verify the additional insureds are on the policy before creating a COI.</div>

      <Panel title="Your agency" sub="Typed in once — every certificate carries it as the producer."
        right={!editAgency && <button className="btn-ghost" onClick={() => setEditAgency(true)}>Edit</button>}>
        {editAgency ? <>
          <div className="form-grid">
            <Field label="Agency name"><input className="fld" {...P('name')} /></Field>
            <Field label="Contact name"><input className="fld" {...P('contact')} /></Field>
            <Field label="Phone"><input className="fld" {...P('phone')} /></Field>
            <Field label="Fax"><input className="fld" {...P('fax')} /></Field>
            <Field label="Email"><input className="fld" type="email" {...P('email')} /></Field>
            <Field label="Authorized representative"><input className="fld" {...P('rep')} placeholder="Signs the certificate" /></Field>
            <Field label="Address" wide><textarea className="fld" rows={3} {...P('address')} placeholder={'Street\nCity, State ZIP'} /></Field>
          </div>
          <div className="row-actions" style={{ marginTop: 12 }}>
            <button className="btn-primary" disabled={!producer.name.trim() || saving === 'agency'} onClick={saveAgency}>{saving === 'agency' ? 'Saving…' : 'Save agency details'}</button>
            {data.producer.name && <button className="btn-ghost" onClick={() => { setProducer({ ...EMPTY_PRODUCER, ...data.producer }); setEditAgency(false) }}>Cancel</button>}
          </div>
        </> : (
          <div className="coi-agency">
            <div><div className="strong">{producer.name}</div><div className="sub" style={{ whiteSpace: 'pre-line' }}>{producer.address}</div></div>
            <div className="sub">{[producer.contact, producer.phone, producer.email].filter(Boolean).join(' · ')}{producer.rep ? <><br />Signed by {producer.rep}</> : null}</div>
          </div>
        )}
      </Panel>

      <Panel title="Insured" right={<input className="fld" type="date" value={c.date} onChange={(e) => set({ date: e.target.value })} title="Certificate date" style={{ width: 'auto' }} />}>
        <div className="form-grid">
          <Field label="Insured name"><input className="fld" value={c.insuredName} onChange={(e) => set({ insuredName: e.target.value })} /></Field>
          <Field label="Insured address"><textarea className="fld" rows={2} value={c.insuredAddress} onChange={(e) => set({ insuredAddress: e.target.value })} placeholder={'Street\nCity, State ZIP'} /></Field>
        </div>
      </Panel>

      <Panel title="Insurance companies" sub="Each company gets a letter (A, B, C…) on the certificate; companies used before are remembered."
        right={c.insurers.length < LETTERS.length && <button className="btn-ghost" onClick={() => set({ insurers: [...c.insurers, { name: '', naic: '' }] })}>+ Another company</button>}>
        <datalist id="coi-insurers">{known.map((r) => <option key={r.name} value={r.name} />)}</datalist>
        {c.insurers.map((r, i) => (
          <div key={i} className="coi-ins">
            <span className="coi-l">{LETTERS[i]}</span>
            <input className="fld coi-name" list="coi-insurers" placeholder="Insurance company" value={r.name} onChange={(e) => setInsurer(i, { name: e.target.value })} />
            <input className="fld coi-naic" placeholder="NAIC #" value={r.naic} onChange={(e) => setInsurer(i, { naic: e.target.value })} />
            {c.insurers.length > 1 && <button className="linkbtn" onClick={() => removeInsurer(i)}>Remove</button>}
          </div>
        ))}
      </Panel>

      <Panel title="Policies" sub="Tick the ones the insured has — one is fine.">
        <div className="coi-ticks">
          {LINES.map((l) => <Tick key={l.key} on={c[l.key].on} set={(v) => setLine(l.key, { on: v } as never)}><b>{l.label}</b></Tick>)}
        </div>
        {c.gl.on && <div className="coi-line"><div className="coi-lt">General Liability</div><div className="form-grid">
          {common('gl')}
          <Field label="Coverage"><select className="fld" value={c.gl.form} onChange={(e) => setLine('gl', { form: e.target.value as 'occur' })}><option value="occur">Occurrence</option><option value="claims">Claims-made</option></select></Field>
          <Field label="Aggregate applies per"><select className="fld" value={c.gl.aggPer} onChange={(e) => setLine('gl', { aggPer: e.target.value as 'policy' })}><option value="policy">Policy</option><option value="project">Project</option><option value="loc">Location</option></select></Field>
          {amt('gl', 'each', 'Each occurrence')}{amt('gl', 'rented', 'Damage to rented premises')}{amt('gl', 'med', 'Med exp (any one person)')}
          {amt('gl', 'personal', 'Personal & adv injury')}{amt('gl', 'agg', 'General aggregate')}{amt('gl', 'products', 'Products - comp/op agg')}
        </div></div>}
        {c.auto.on && <div className="coi-line"><div className="coi-lt">Commercial Auto</div><div className="form-grid">
          {common('auto')}
          <div className="coi-ticks" style={{ gridColumn: '1 / -1' }}>
            <Tick on={c.auto.any} set={(v) => setLine('auto', { any: v })}>Any auto</Tick>
            <Tick on={c.auto.owned} set={(v) => setLine('auto', { owned: v })}>Owned autos only</Tick>
            <Tick on={c.auto.scheduled} set={(v) => setLine('auto', { scheduled: v })}>Scheduled autos</Tick>
            <Tick on={c.auto.hired} set={(v) => setLine('auto', { hired: v })}>Hired autos only</Tick>
            <Tick on={c.auto.nonowned} set={(v) => setLine('auto', { nonowned: v })}>Non-owned autos only</Tick>
          </div>
          {amt('auto', 'csl', 'Combined single limit')}{amt('auto', 'biPerson', 'Bodily injury (per person)')}{amt('auto', 'biAccident', 'Bodily injury (per accident)')}{amt('auto', 'pd', 'Property damage')}
        </div></div>}
        {c.umb.on && <div className="coi-line"><div className="coi-lt">{lineName(c, 'umb')}</div><div className="form-grid">
          {common('umb')}
          <Field label="Type"><select className="fld" value={c.umb.kind} onChange={(e) => setLine('umb', { kind: e.target.value as 'umbrella' })}><option value="umbrella">Umbrella</option><option value="excess">Excess</option></select></Field>
          <Field label="Coverage"><select className="fld" value={c.umb.form} onChange={(e) => setLine('umb', { form: e.target.value as 'occur' })}><option value="occur">Occurrence</option><option value="claims">Claims-made</option></select></Field>
          {amt('umb', 'each', 'Each occurrence')}{amt('umb', 'agg', 'Aggregate')}{amt('umb', 'retention', 'Retention (if any)')}
        </div></div>}
        {c.wc.on && <div className="coi-line"><div className="coi-lt">Workers Compensation</div><div className="form-grid">
          {common('wc', false)}
          <div className="coi-ticks" style={{ gridColumn: '1 / -1' }}>
            <Tick on={c.wc.addl} set={(v) => setLine('wc', { addl: v })}>Name the holder in the description for this policy too</Tick>
          </div>
          <Field label="Owner / officer excluded?"><select className="fld" value={c.wc.excluded} onChange={(e) => setLine('wc', { excluded: e.target.value as 'N' })}><option value="N">N</option><option value="Y">Y</option><option value="">(blank)</option></select></Field>
          <Field label="Limits"><select className="fld" value={c.wc.statute ? 's' : 'o'} onChange={(e) => setLine('wc', { statute: e.target.value === 's' })}><option value="s">Per statute</option><option value="o">Other</option></select></Field>
          {amt('wc', 'accident', 'E.L. each accident')}{amt('wc', 'employee', 'E.L. disease - ea employee')}{amt('wc', 'disease', 'E.L. disease - policy limit')}
        </div></div>}
      </Panel>

      <Panel title="Certificate holder">
        <div className="form-grid">
          <Field label="Holder name"><input className="fld" value={c.holderName} onChange={(e) => set({ holderName: e.target.value })} /></Field>
          <Field label="Holder address"><textarea className="fld" rows={2} value={c.holderAddress} onChange={(e) => set({ holderAddress: e.target.value })} placeholder={'Street\nCity, State ZIP'} /></Field>
        </div>
      </Panel>

      <Panel title="Description of operations" sub={c.opsEdited ? 'Your own wording.' : 'The standard wording — the holder is an additional insured on the policies selected. Type over it to change it.'}
        right={c.opsEdited && <button className="btn-ghost" onClick={() => set({ ops: '', opsEdited: false })}>Use the standard wording</button>}>
        <textarea className="fld" rows={4} value={ops} onChange={(e) => set({ ops: e.target.value, opsEdited: true })} placeholder={on.length ? '' : 'Tick a policy above and the standard wording fills in here.'} />
      </Panel>

      <Panel title="Certificate" sub="ACORD 25 · Certificate of Liability Insurance"
        right={<div className="row-actions coi-acts">
          <button className="btn-ghost" onClick={() => set({ holderName: '', holderAddress: '' })}>Same policies, new holder</button>
          <button className="btn-ghost" onClick={() => { if (confirm('Clear this certificate and start a new one?')) setC(newCert(today)) }}>Start over</button>
          <button className="btn-primary" disabled={!!problems.length} onClick={issue}>Print / save as PDF</button>
        </div>}>
        {problems.length > 0 && <div className="note-box">Still needed: {problems.join(', ')}.</div>}
        <iframe className="coi-preview" title="Certificate preview" srcDoc={html} />
      </Panel>
    </>
  )
}
