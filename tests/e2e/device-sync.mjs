// Browser-data check (npm run test:sync, after npm run build). What the screens keep in localStorage must be saved to
// the database (app_store) and cleared from the browser at sign-out, and a Claude API key must never stay in the browser.
// Signs in against the Supabase stand-in, which keeps app_store writes in memory, and checks each step.
import { chromium } from 'playwright'
import { createServer } from 'http'
import fs from 'fs'
import path from 'path'
import { install, store, demoAgency } from './supabase-stub.mjs'

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

const failures = [], calls = []
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failures.push(what) }
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage(); const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await install(page, (l) => calls.push(l))
const local = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('declara_')).map((k) => [k, localStorage.getItem(k)])))
const saved = (k) => store().find((r) => r.key === k)?.value
const signIn = async () => {
  await page.waitForSelector('input[type=email]')
  await page.fill('input[type=email]', 'demo@declara.app'); await page.fill('input[type=password]', 'x'); await page.click('button.btn-primary')
  await page.waitForSelector('.shell', { timeout: 20000 })
}

// 1. A browser that already holds this agency's items from before (including a Claude key in the commission plans).
await page.goto(base); await page.waitForSelector('input[type=email]')
await page.evaluate((ag) => {
  localStorage.setItem('declara_agency', ag)
  localStorage.setItem('declara_look_v2', JSON.stringify({ theme: 'talavera', font: 'normal' }))
  localStorage.setItem('declara_comm_recon_v1', '{"folio":"old"}')
  localStorage.setItem('declara_comm_plans_v1', JSON.stringify({ versions: [], activeId: 'plan-seed', ai: { key: 'sk-ant-test-123', model: 'claude-sonnet-5' } }))
}, demoAgency().id)
await signIn()
check(saved('declara_comm_recon_v1') === '{"folio":"old"}', 'items already on the browser are uploaded at sign-in')
check(!!saved('declara_comm_plans_v1') && !saved('declara_comm_plans_v1').includes('sk-ant'), 'the Claude key is not uploaded with the commission plans')
check(!JSON.stringify(await local()).includes('sk-ant'), 'the Claude key is removed from the browser')
check(calls.some((c) => c.includes('rpc/ai_key_save')), 'the Claude key is handed to the server once')

// 2. Changes made by the app and by the original screens' frame are saved.
await page.evaluate(() => localStorage.setItem('declara_foresight_commission_rate', '12'))
await page.evaluate(() => { location.hash = '#/reports' }); await page.waitForTimeout(2500)
await page.evaluate(() => document.querySelector('.legacy-host iframe').contentWindow.localStorage.setItem('declara_work_v1', '[{"id":1}]'))
await page.evaluate(() => localStorage.removeItem('declara_comm_recon_v1'))
await page.waitForTimeout(1500)
check(saved('declara_foresight_commission_rate') === '12', 'a change made by the app is saved to the database')
check(saved('declara_work_v1') === '[{"id":1}]', 'a change made by the original screens is saved to the database')
check(saved('declara_comm_recon_v1') === undefined, 'a removed item is removed from the database')
await page.evaluate(() => localStorage.setItem('declara_today_x', '"late"')) // saved by sign-out, before the debounce

// 3. Sign-out clears the browser but keeps the theme; the data stays in the database.
await page.evaluate(() => { location.hash = '#/' }); await page.waitForTimeout(500)
await page.click('button.logout'); await page.waitForSelector('input[type=email]')
const after = await local()
check(Object.keys(after).every((k) => k === 'declara_look_v2' || k === 'declara_agency'), 'sign-out leaves only the theme on the browser (' + Object.keys(after).join(', ') + ')')
check(saved('declara_today_x') === '"late"', 'a change made just before sign-out is saved')

// 4. Signing in again brings everything back.
await signIn()
const back = await local()
check(back.declara_work_v1 === '[{"id":1}]' && back.declara_foresight_commission_rate === '12', 'signing in again restores the saved items')

// 5. Opening the app with no one signed in (session gone) clears anything left behind.
await page.evaluate(() => { localStorage.setItem('declara_stray_v1', 'x'); Object.keys(localStorage).filter((k) => k.startsWith('sb-')).forEach((k) => localStorage.removeItem(k)) })
await page.reload(); await page.waitForSelector('input[type=email]'); await page.waitForTimeout(300)
check(!(await local()).declara_stray_v1, 'opening the app signed out clears leftover items')
check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors[0] : ''))

await browser.close(); server.close()
if (failures.length) { console.error('\nBrowser-data check failed:\n  ' + failures.join('\n  ')); process.exit(1) }
console.log('\nBrowser-data check passed.')
