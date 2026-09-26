// A stand-in for the Supabase API, so the app can be driven in a browser without a network or a real project.
import fs from 'fs'
import zlib from 'zlib'
import { createRequire } from 'module'
// The demo agency's rows (made up, never a real agency's), dumped under row-level security as the demo owner.
const DB = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('../fixtures/northwind.json.gz', import.meta.url))).toString('utf8'))
DB.platform_admins = [{ user_id: 'a62b5895-e9fa-4d54-902c-4a89cf0b3f5d' }] // so the Agencies page is checked too
for (const k of Object.keys(DB)) DB[k] = DB[k] || []
const USER = { id: 'a62b5895-e9fa-4d54-902c-4a89cf0b3f5d', aud: 'authenticated', role: 'authenticated', email: 'demo@vidura.app', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-09-25T00:00:00Z' }
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const exp = Math.floor(Date.now() / 1000) + 36000
const JWT = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: USER.id, role: 'authenticated', aud: 'authenticated', exp, email: USER.email }) + '.sig'
const SESSION = { access_token: JWT, token_type: 'bearer', expires_in: 36000, expires_at: exp, refresh_token: 'demo-refresh', user: USER }

function val(v) { if (v === 'null') return null; if (v === 'true') return true; if (v === 'false') return false; return v }
function test(row, col, expr) {
  const i = expr.indexOf('.'); let op = expr.slice(0, i), arg = expr.slice(i + 1), not = false
  if (op === 'not') { not = true; const j = arg.indexOf('.'); op = arg.slice(0, j); arg = arg.slice(j + 1) }
  const x = row[col]; let r
  const cmp = (a, b) => (typeof a === 'number' || (a !== null && !isNaN(a) && !isNaN(b) && a !== '' && b !== '')) ? Number(a) - Number(b) : String(a).localeCompare(String(b))
  switch (op) {
    case 'eq': r = String(x) === String(val(arg)) || x === val(arg); break
    case 'neq': r = String(x) !== String(val(arg)); break
    case 'gt': r = x != null && cmp(x, arg) > 0; break
    case 'gte': r = x != null && cmp(x, arg) >= 0; break
    case 'lt': r = x != null && cmp(x, arg) < 0; break
    case 'lte': r = x != null && cmp(x, arg) <= 0; break
    case 'is': r = arg === 'null' ? x == null : x === val(arg); break
    case 'in': { const list = arg.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')); r = list.includes(String(x)); break }
    case 'like': case 'ilike': { const re = new RegExp('^' + arg.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/%/g, '.*') + '$', op === 'ilike' ? 'i' : ''); r = re.test(String(x ?? '')); break }
    default: r = true
  }
  return not ? !r : r
}
export async function install(page, log = () => {}) {
  // the original screens load supabase-js from a CDN, which this sandbox can't reach: serve the installed copy
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(createRequire(import.meta.url).resolve('@supabase/supabase-js/dist/umd/supabase.js'), 'utf8') }))
  await page.route('https://sikgwlhwsezrhiylfmnx.supabase.co/**', async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, m = req.method()
    const json = (body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...headers }, body: JSON.stringify(body) })
    if (m === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    if (p.startsWith('/auth/v1/token')) return json(SESSION)
    if (p.startsWith('/auth/v1/user')) return json(USER)
    if (p.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204 })
    if (p === '/functions/v1/platform-admin') { const body = JSON.parse(req.postData() || '{}'); log('fn platform-admin ' + body.action)
      if (body.action === 'list') return json({ agencies: [...DB.agencies, { id: 'x', slug: 'ironwood', name: 'Ironwood Insurance Agency', short_name: 'Ironwood', is_demo: false, agencyzoom_sync: true, created_at: '2026-09-25T00:00:00Z' }].map((a) => ({ ...a, created_at: a.created_at || '2026-09-25T00:00:00Z', staff: a.slug === 'ironwood' ? 5 : 1, owners: [{ name: a.slug === 'ironwood' ? 'Owner' : 'Alex Morgan', email: a.slug === 'ironwood' ? 'owner@example.com' : 'demo@declara.app' }] })) })
      return json({ ok: true, agency: { id: 'new', slug: 'harbor', name: body.name } }) }
    if (p.startsWith('/functions/v1/')) { log('fn ' + p); return json({ error: 'Not available in the offline preview' }, 200) }
    if (p.startsWith('/rest/v1/rpc/')) { log('rpc ' + p); return json(null) }
    if (p.startsWith('/storage/')) return json({ error: 'offline' }, 404)
    if (p.startsWith('/rest/v1/')) {
      const table = p.slice(9)
      if (m !== 'GET' && m !== 'HEAD') { log(m + ' ' + table); return m === 'DELETE' ? route.fulfill({ status: 204 }) : json([], 201) }
      let rows = (DB[table] || []).slice(); if (!DB[table]) log('missing table ' + table)
      let order = null, limit = null, offset = 0, select = '*'
      for (const [k, v] of u.searchParams) {
        if (k === 'select') select = v; else if (k === 'order') order = v; else if (k === 'limit') limit = +v; else if (k === 'offset') offset = +v
        else if (k === 'or' || k === 'and') {} else rows = rows.filter((r) => test(r, k, v))
      }
      if (order) for (const part of order.split(',').reverse()) { const [c, dir] = part.split('.'); rows.sort((a, b) => { const x = a[c], y = b[c]; const d = x == null ? 1 : y == null ? -1 : (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))); return dir === 'desc' ? -d : d }) }
      const rng = req.headers()['range']; if (rng) { const [a, b] = rng.split('-').map(Number); offset = a; limit = b - a + 1 }
      const total = rows.length; rows = rows.slice(offset, limit != null ? offset + limit : undefined)
      if (/agency:agencies/.test(select)) { const ag = DB.agencies[0]; rows = rows.map((r) => ({ ...r, agency: { name: ag.name, short_name: ag.short_name, is_demo: ag.is_demo, agencyzoom_sync: ag.agencyzoom_sync } })) }
      const accept = req.headers()['accept'] || ''
      if (accept.includes('vnd.pgrst.object')) return rows.length === 1 ? json(rows[0]) : json({ code: 'PGRST116', message: 'no rows', details: '', hint: null }, 406)
      return json(rows, 200, { 'content-range': `${offset}-${offset + rows.length - 1}/${total}` })
    }
    log('unhandled ' + m + ' ' + p); return json({}, 404)
  })
}
