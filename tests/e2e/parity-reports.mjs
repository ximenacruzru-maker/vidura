// Parity check for the rebuilt Reports screen (part of npm run test:parity, after npm run build). Opens the new
// screen (/reports) and the original (/legacy-reports) against the demo agency's data and compares every view the
// rebuild covers: the dashboard for each period and book, and in Details the Scorecard, Producer (with a drill-down),
// Folio and Written Business tabs for every folio, Written Business for every carrier / business type / metric on the
// current folio, the Daily tab for every day, the To do list, and Commissions for every folio with a carrier statement
// uploaded, overridden and removed, and SDR Transfer for every pay period. Text, bar lengths and gauges must match exactly.
import { chromium } from 'playwright'
import { createServer } from 'http'
import fs from 'fs'
import path from 'path'
import { install } from './supabase-stub.mjs'

const DIST = path.resolve('dist')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' }
if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('Run npm run build first.'); process.exit(2) }
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let f = path.join(DIST, p === '/' ? 'index.html' : p)
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html')
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res)
}).listen(0)
const base = `http://localhost:${server.address().port}/`

/** The screen's text plus the geometry that carries figures (bar lengths, chart heights, gauges). */
const read = (sel) => {
  const w = document.querySelector(sel); if (!w) return null
  // a dropdown reads as its chosen value (its option list reads with different spacing in each version)
  const swaps = [...w.querySelectorAll('select')].map((s) => {
    const t = document.createElement('span'); t.textContent = '[' + (s.selectedOptions[0]?.textContent || '') + ' of ' + s.options.length + ']'
    s.after(t); const d = s.style.display; s.style.display = 'none'; return () => { t.remove(); s.style.display = d }
  })
  const text = w.innerText.replace(/[\s\u00a0]+/g, ' ').trim()
  swaps.forEach((undo) => undo())
  const geo = [...w.querySelectorAll('.rp-f, .dbar, .dmix-b i, .dspark i, .dbarv-t i, circle[stroke-dasharray], .ddots i')]
    .map((e) => e.style.cssText || e.getAttribute('stroke-dasharray') || e.className.baseVal || e.className).join('|')
  return { text, geo }
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage()
const errors = []; page.on('pageerror', (e) => errors.push(e.message))
await install(page)
await page.goto(base); await page.waitForSelector('input[type=email]')
await page.fill('input[type=email]', 'demo@declara.app'); await page.fill('input[type=password]', 'x'); await page.click('button.btn-primary')
await page.waitForSelector('.shell', { timeout: 20000 })

// the original, loaded once in its frame and driven through its own functions
await page.evaluate(() => { location.hash = '#/legacy-reports' })
await page.waitForFunction(() => { const f = document.querySelector('.legacy-host iframe'); return f && f.contentWindow && f.contentWindow.reportSetFolio && f.contentDocument.querySelector('#main .wrap') }, null, { timeout: 30000 })
const frame = page.frames().find((f) => f.url().includes('/perf/'))
// the frame is hidden while the new screen shows; show it while reading so its text lays out as a person sees it
const oldRead = async () => {
  await page.evaluate(() => { document.querySelector('.legacy-host').style.display = 'block' })
  try { return await frame.evaluate(read, '#main .wrap') } finally { await page.evaluate(() => { document.querySelector('.legacy-host').style.display = 'none' }) }
}
const old = (fn, arg) => frame.evaluate(({ fn, arg }) => { new Function('arg', fn)(arg) }, { fn, arg })

await page.evaluate(() => { location.hash = '#/reports' }); await page.waitForSelector('.xd .ptabs', { timeout: 20000 })
const newRead = () => page.evaluate(read, '.xd > .wrap')
const pick = async (scope, i, value) => { await page.locator(scope + ' select').nth(i).selectOption(value); await page.waitForTimeout(40) }

const D = await frame.evaluate(() => ({ wins: EXEC_PROD_WINDOWS.map((w) => w[0]), books: REP_BOOKS.map((b) => b[0]), folios: wbFolioKeys().filter((k) => AZ_REPORTS[k]) }))
const failures = []; let checked = 0
const same = async (what) => {
  const [a, b] = [await newRead(), await oldRead()]
  checked++
  if (!a || !b) { failures.push(`${what}: screen missing (${!a ? 'new' : 'original'})`); return }
  if (a.text !== b.text) {
    let i = 0; while (i < a.text.length && a.text[i] === b.text[i]) i++
    failures.push(`${what}: text differs at "…${a.text.slice(Math.max(0, i - 40), i + 60)}…" vs "…${b.text.slice(Math.max(0, i - 40), i + 60)}…"`)
  } else if (a.geo !== b.geo) {
    const A = a.geo.split('|'), B = b.geo.split('|'), i = A.findIndex((x, n) => x !== B[n])
    failures.push(`${what}: bars/gauges differ at #${i}: ${A[i]} vs ${B[i]} (${A.length} vs ${B.length})`)
  }
}

// dashboard
await page.click('.ptab:has-text("Dashboard")'); await old('S.view.reports="dash";render()')
for (const w of D.wins) for (const bk of D.books) {
  await pick('.dash-top', 0, w); await pick('.dash-top', 1, bk)
  await old('S.repWin=arg.w;S.repBook=arg.bk;render()', { w, bk })
  await same(`Dashboard · ${w} · ${bk}`)
}
// a custom range
await pick('.dash-top', 0, 'custom'); await pick('.dash-top', 1, 'all')
await page.locator('.dash-top input[type=date]').first().fill('2026-03-02'); await page.locator('.dash-top input[type=date]').nth(1).fill('2026-06-14')
await old('S.repWin="custom";S.repBook="all";S.cusFrom="2026-03-02";S.cusTo="2026-06-14";render()')
await same('Dashboard · custom 2026-03-02 to 2026-06-14')
await pick('.dash-top', 0, 'folio'); await pick('.dash-top', 1, 'all'); await old('S.repWin="folio";S.repBook="all";render()')

// details
await page.click('.ptab:has-text("Details")'); await old('S.view.reports="details";render()')
const tab = async (key, label) => { await page.click(`.schead-tab:has-text("${label}")`); await old('reportTab(arg)', key) }
for (const [key, label] of [['scorecard', 'Scorecard'], ['producer', 'Producer'], ['folio', 'Folio'], ['written', 'Written Business']]) {
  await tab(key, label)
  for (const k of D.folios) {
    await pick('.scbar', 0, k); await old('reportSetFolio(arg)', k)
    await same(`${label} · folio ${k}`)
  }
}
// a producer and a carrier drill-down on the current folio
const cur = D.folios[0]
await pick('.scbar', 0, cur); await old('reportSetFolio(arg)', cur)
for (const [key, label, kind] of [['producer', 'Producer', 'producer'], ['folio', 'Folio', 'carrier']]) {
  await tab(key, label)
  const who = await page.locator('.rp-go .rp-l').first().evaluate((e) => e.firstChild.textContent)
  await page.locator('.rp-go').first().click(); await old('repDrill(arg.kind,arg.who)', { kind, who })
  await same(`${label} · drill-down ${who}`)
  await page.click('.drill-x'); await old('repDrill(null,null)')
}
// written business: every filter on the current folio
await tab('written', 'Written Business')
const carriers = await page.locator('.fbar select').nth(1).evaluate((s) => [...s.options].map((o) => o.value))
for (const c of carriers) for (const biz of ['all', 'personal', 'commercial']) for (const m of ['premium', 'policies']) {
  await pick('.fbar', 1, c); await pick('.fbar', 2, biz); await pick('.fbar', 3, m)
  await old('reportSetCarrier(arg.c);reportSetBizType(arg.biz);reportSetMetric(arg.m)', { c, biz, m })
  await same(`Written · ${c} · ${biz} · ${m}`)
}
await pick('.fbar', 1, 'all'); await pick('.fbar', 2, 'all'); await pick('.fbar', 3, 'premium'); await old('reportSetCarrier("all");reportSetBizType("all");reportSetMetric("premium")')
// daily: every day
await tab('daily', 'Daily')
await same('Daily · opening day')
const days = await page.locator('.fbar select').first().evaluate((s) => [...s.options].map((o) => o.value))
for (const d of days) { await pick('.fbar', 0, d); await old('reportSetDay(arg)', d); await same(`Daily · ${d}`) }
await tab('todo', 'To do list'); await same('To do list')

// commissions: every folio, then a carrier statement (a cancellation, a sale missing from it, an extra row) and an override
await tab('commissions', 'Commissions')
for (const k of await page.locator('.fbar select').first().evaluate((s) => [...s.options].map((o) => o.value))) {
  await pick('.fbar', 0, k); await old('reportSetFolio(arg)', k)
  await same(`Commissions · folio ${k}`)
}
// a folio from before the live sync, where statement exclusions change what is paid
const ck = D.folios.find((k) => k < '2026-08-20')
await pick('.fbar', 0, ck); await old('reportSetFolio(arg)', ck)
const before = (await newRead()).text
const sales = await frame.evaluate((k) => commFolioRows(k).map((r) => ({ client: r.client, premium: r.premium })), ck)
const lines = ['Policy Number,Insured Name,Written Premium,Commission,Transaction Type']
sales.forEach((r, i) => {
  if (i === 1) return // not on the statement
  const cancel = i === 0
  lines.push([String(4100000 + i), '"' + r.client + '"', cancel ? -r.premium : r.premium, ((cancel ? -1 : 1) * r.premium * 0.1).toFixed(2), cancel ? 'Cancellation' : 'New Business'].join(','))
})
lines.push('4199999,"Somebody Else",812.00,81.20,Renewal')
const csv = path.join(fs.mkdtempSync(path.join((await import('os')).tmpdir(), 'stmt-')), 'efolio-statement.csv')
fs.writeFileSync(csv, lines.join('\n'))
page.on('dialog', (d) => d.accept())
await page.locator('input[type=file][accept*=".csv"]').setInputFiles(csv)
await page.waitForFunction(() => /Done —/.test(document.querySelector('#rcStatus')?.textContent || ''), null, { timeout: 15000 })
const rc = await page.evaluate(() => document.querySelector('#rcStatus').textContent)
await old('S.rcMsg=arg;commRecalc();render()', rc)
await same('Commissions · carrier statement uploaded')
{ const after = (await newRead()).text
  if (after === before || !/excluded after carrier reconciliation/.test(after)) failures.push('Commissions · the statement upload did not exclude anything') }
await page.locator('select.wk-st').nth(1).selectOption('include'); await old('commRecalc();render()')
await same('Commissions · a flagged sale paid anyway')
await page.click('.brief-s:has-text("Remove")'); await old('S.rcMsg=arg;commRecalc();render()', rc)
await same('Commissions · statement removed')

// SDR transfer: every pay period
await tab('sdr', 'SDR Transfer')
await same('SDR · opening period')
const sdrMonths = await page.locator('.fbar select').first().evaluate((s) => [...s.options].map((o) => o.value))
if (!sdrMonths.length) failures.push('SDR · no pay periods in the demo data')
for (const mo of sdrMonths) { await pick('.fbar', 0, mo); await old('reportSetSdrMonth(arg)', mo); await same(`SDR · ${mo}`) }

await browser.close(); server.close()
if (errors.length) failures.push('page error: ' + errors[0])
if (failures.length) { console.error(`\nReports parity failed (${failures.length} of ${checked} views):\n  ` + failures.slice(0, 15).join('\n  ')); process.exit(1) }
console.log(`Reports match the original in all ${checked} views.`)
