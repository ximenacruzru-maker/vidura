import { useState } from 'react'
import { getBookPolicies, type BookPolicy } from '../lib/books'
import { supabase } from '../lib/supabase'

const tight = (s: string | null | undefined) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const CATS: { re: RegExp; cat: string; label: string }[] = [
  { re: /binder/i, cat: 'binder', label: 'Binder' },
  { re: /\bwc\b|work(ers)?.?comp|info.?page/i, cat: 'wc', label: 'WC info page' },
  { re: /\bcoi\b|certificate/i, cat: 'coi', label: 'Certificate' },
  { re: /.*/, cat: 'dec', label: 'Declarations' },
]

/** Admins drop dec sheets, binders or WC pages; each file is filed on the policy whose number is in its file name. */
export default function DocUpload({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<{ file: string; ok: boolean; note: string }[]>([])

  const run = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true); setLog([])
    const pols = (await getBookPolicies()).filter((p) => tight(p.policy_number).length >= 5)
    const out: typeof log = []
    for (const f of Array.from(files)) {
      const t = tight(f.name.replace(/\.[a-z0-9]+$/i, ''))
      const hit: BookPolicy | undefined = pols.filter((p) => t.includes(tight(p.policy_number))).sort((a, b) => tight(b.policy_number).length - tight(a.policy_number).length)[0]
      if (!hit) { out.push({ file: f.name, ok: false, note: 'no policy number in the name matches the book — rename it to include the policy number' }); setLog([...out]); continue }
      const c = CATS.find((x) => x.re.test(f.name))!
      const id = `${c.cat}-${hit.id}-${tight(f.name).slice(0, 40)}`
      const ext = (f.name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || 'pdf'
      const path = `${c.cat}/${id}.${ext}`
      const up = await supabase.storage.from('documents').upload(path, f, { upsert: true, contentType: f.type || 'application/pdf' })
      if (up.error) { out.push({ file: f.name, ok: false, note: up.error.message }); setLog([...out]); continue }
      const { error } = await supabase.from('documents').upsert({
        id, category: c.cat, account_id: hit.account_id, policy_number: hit.policy_number, title: `${c.label} — ${hit.insured || hit.policy_number}`,
        file_name: f.name, mime: f.type || 'application/pdf', storage_path: path, size_bytes: f.size, admin_only: false, uploaded: true,
      })
      out.push({ file: f.name, ok: !error, note: error ? error.message : `${c.label} → ${hit.insured} · ${hit.policy_number}` }); setLog([...out])
    }
    setBusy(false); onDone()
  }

  return (
    <div className="doc-up">
      <label className={'btn-ghost' + (busy ? ' disabled' : '')} style={{ cursor: busy ? 'default' : 'pointer' }}>
        {busy ? 'Uploading…' : 'Upload documents'}
        <input type="file" multiple accept=".pdf,image/*" hidden disabled={busy} onChange={(e) => { run(e.target.files); e.target.value = '' }} />
      </label>
      {log.length > 0 && (
        <div className="doc-up-log">
          {log.map((l, i) => <div key={i} className={l.ok ? 'ok' : 'bad'}><b>{l.ok ? '✓' : '✕'} {l.file}</b> — {l.note}</div>)}
          {!busy && <button className="linkbtn" onClick={() => setLog([])}>Dismiss</button>}
        </div>
      )}
    </div>
  )
}
