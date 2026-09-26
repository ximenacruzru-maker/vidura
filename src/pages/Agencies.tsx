import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Empty, ErrorBox, Loading, PageHead, Panel } from '../components/ui'

/** Declara platform administration: every agency on the platform, and a form to set up a new one with its owner login.
 *  Only people in public.platform_admins see this page; the platform-admin edge function checks again on every call. */
interface Agency { id: string; slug: string; name: string; short_name: string | null; is_demo: boolean; agencyzoom_sync: boolean; created_at: string; staff: number; owners: { name: string; email: string | null }[] }

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('platform-admin', { body })
  if (error) {
    let msg = error.message
    try { msg = (await (error as any).context?.json())?.error || msg } catch { /* not JSON */ }
    throw new Error(msg)
  }
  return data
}

export default function Agencies() {
  const [list, setList] = useState<Agency[] | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const load = () => call({ action: 'list' }).then((d) => setList(d.agencies)).catch(setErr)
  useEffect(() => { load() }, [])

  return (
    <>
      <PageHead kicker="Declara platform" title="Agencies" sub="Every agency on Declara. Each one sees only its own data." />
      <NewAgency onMade={load} />
      <Panel title="All agencies" sub={list ? `${list.length} on the platform` : undefined}>
        {err ? <ErrorBox error={err} /> : !list ? <Loading what="Loading agencies" /> : !list.length ? <Empty>No agencies yet.</Empty> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Agency</th><th>Owner</th><th className="r">Active staff</th><th>AgencyZoom</th><th>Created</th></tr></thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id}>
                    <td><div className="strong">{a.name}{a.is_demo && <span className="pill pill-warn" style={{ marginLeft: 8 }}>Demo</span>}</div><div className="sub">{a.slug}</div></td>
                    <td>{a.owners.length ? a.owners.map((o) => <div key={o.email || o.name}>{o.name}<div className="sub">{o.email}</div></div>) : <span className="sub">No owner login</span>}</td>
                    <td className="r">{a.staff}</td>
                    <td>{a.agencyzoom_sync ? <span className="pill pill-good">Syncing</span> : <span className="sub">Not connected</span>}</td>
                    <td className="sub">{new Date(a.created_at).toLocaleDateString('en-US')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}

function NewAgency({ onMade }: { onMade: () => void }) {
  const blank = { name: '', short_name: '', owner_name: '', owner_email: '', password: '' }
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null)
    try {
      const r = await call({ action: 'create', ...f })
      setMsg({ ok: true, text: `${r.agency.name} is set up. Send ${f.owner_email} the temporary password privately — they'll choose their own the first time they sign in.` })
      setF(blank); onMade()
    } catch (x: any) { setMsg({ ok: false, text: x?.message || String(x) }) }
    setBusy(false)
  }
  return (
    <Panel title="Set up a new agency" sub="Creates the agency with Declara's standard screens and settings, and its owner's login. The owner then adds their own team in Settings.">
      <form className="ag-form" onSubmit={submit}>
        <label>Agency name<input className="fld" value={f.name} onChange={set('name')} placeholder="Harbor Insurance Group" required /></label>
        <label>Short name <span className="sub">(optional)</span><input className="fld" value={f.short_name} onChange={set('short_name')} placeholder="Harbor" /></label>
        <label>Owner's name<input className="fld" value={f.owner_name} onChange={set('owner_name')} placeholder="Jordan Lee" required /></label>
        <label>Owner's email<input className="fld" type="email" value={f.owner_email} onChange={set('owner_email')} placeholder="jordan@harborins.com" required /></label>
        <label>Temporary password<input className="fld" value={f.password} onChange={set('password')} minLength={8} placeholder="At least 8 characters" required /></label>
        <div className="ag-go"><button className="btn-primary" disabled={busy}>{busy ? 'Setting up…' : 'Create agency'}</button></div>
      </form>
      {msg && <div className={msg.ok ? 'note' : 'error-box'} style={{ marginTop: 12 }}>{msg.text}</div>}
    </Panel>
  )
}
