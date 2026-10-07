// The employee handbook: an admin uploads it (a PDF, filed in documents as category 'handbook'); its text is read once
// at upload and kept in employee_handbook so anyone can ask questions about it in the app. A new hire downloads it as
// the first onboarding step, which unlocks Farmers University.
import { supabase } from './supabase'
import { openDoc, type Doc } from './books'
import { pdfRows } from './coi'
import { HANDBOOK_STEP, markStep } from './onboarding'

export interface Handbook { doc: Doc; text: string; title: string; updated_at: string }

export async function getHandbook(): Promise<Handbook | null> {
  const { data, error } = await supabase.from('employee_handbook').select('document_id, title, text, updated_at').maybeSingle()
  if (error) throw error
  if (!data) return null
  const d = await supabase.from('documents').select('*').eq('id', data.document_id).maybeSingle()
  if (d.error) throw d.error
  return d.data ? { doc: d.data as Doc, text: data.text || '', title: data.title, updated_at: data.updated_at } : null
}

/** Uploads a new handbook (replacing the one shown), reads its text, and files it. */
export async function uploadHandbook(file: File, agencyId: string) {
  const buf = await file.arrayBuffer()
  const text = /pdf/i.test(file.type) || /\.pdf$/i.test(file.name) ? (await pdfRows(buf)).join('\n') : new TextDecoder().decode(buf)
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const id = `handbook-${stamp}`, path = `${agencyId}/handbook/${id}-${file.name.replace(/[^A-Za-z0-9._-]+/g, '_')}`
  const up = await supabase.storage.from('documents').upload(path, file, { contentType: file.type || 'application/pdf' })
  if (up.error) throw up.error
  const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')
  const { error } = await supabase.from('documents').insert({ id, category: 'handbook', title, file_name: file.name, mime: file.type || 'application/pdf', storage_path: path, size_bytes: file.size, admin_only: false, uploaded: true })
  if (error) throw error
  const h = await supabase.from('employee_handbook').upsert({ document_id: id, title, text, updated_at: new Date().toISOString() }, { onConflict: 'agency_id' })
  if (h.error) throw h.error
  return { pages: text.split('\n').length }
}

/** Downloads the handbook and records it (the new hire's first onboarding step). */
export async function downloadHandbook(h: Handbook, userId: string) {
  await openDoc(h.doc, true)
  await markStep(userId, HANDBOOK_STEP, true)
}

export interface Qa { q: string; a: string }
/** Answers a question from the handbook only, with the conversation so far for follow-ups. */
export async function askHandbook(h: Handbook, question: string, history: Qa[], agency: string) {
  const system = `You answer questions from employees of ${agency} about the agency's employee handbook. Use only the handbook text below. ` +
    'Answer in plain, friendly language, briefly, and name the handbook section you are drawing on when it has one. ' +
    'If the handbook does not cover the question, say so plainly and suggest asking a manager; never guess at policy, pay, benefits or legal questions.\n\n' +
    `<handbook title="${h.title.replace(/"/g, '')}">\n${h.text.slice(0, 400000)}\n</handbook>`
  const messages = [...history.slice(-6).flatMap((x) => [{ role: 'user', content: x.q }, { role: 'assistant', content: x.a }]), { role: 'user', content: question }]
  const { data, error } = await supabase.functions.invoke('ai-proxy', { body: { system, messages, max_tokens: 4000 } })
  if (error) {
    const msg = await (error as any).context?.json?.().then((j: any) => j.error).catch(() => null)
    throw new Error(msg || error.message)
  }
  if (data?.error) throw new Error(data.error)
  return ((data?.content || []) as { type: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() || 'I couldn’t find an answer to that in the handbook.'
}
