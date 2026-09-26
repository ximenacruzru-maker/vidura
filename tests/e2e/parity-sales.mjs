// Parity check for the rebuilt Sales KPIs (npm run test:parity, after npm run build). Opens the new screen (/sales)
// and the original (/legacy-sales) against the demo agency's data and, for every period in the Period menu, compares
// the headline, the four score cards, the producer/line/book bars, the policies table and the chart. Any difference fails.
import { chromium } from 'playwright'
import { createServer } from 'http'
import fs from 'fs'
import path from 'path'
import { install } from './supabase-stub.mjs'

const DIST = path.resolve('dist')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' }
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let f = path.join(DIST, p === '/' ? 'index.html' : p)
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html')
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res)
}).listen(0)
const base = `http://localhost:${server.address().port}/`

const read = () => { const doc = document
  const t = (s) => [...doc.querySelectorAll(s)].map((e) => e.textContent.replace(/\s+/g, ' ').trim())
  const bars = [...doc.querySelectorAll('.panel')].filter((pn) => /By producer|By line|By book/.test(pn.querySelector('.panel-t')?.textContent || ''))
    .map((pn) => pn.querySelector('.panel-t').textContent + ': ' + pn.querySelector('.panel-b').textContent.replace(/\s+/g, ' ').trim())
  return { head: t('.exhd-s')[0], cards: t('.scg .sc'), bars, rows: t('table.dect tbody tr'), chart: doc.querySelectorAll('svg.ch rect.ch-seg').length }
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage()
const errors = []; page.on('pageerror', (e) => errors.push(e.message))
await install(page)
await page.goto(base); await page.waitForSelector('input[type=email]')
await page.fill('input[type=email]', 'demo@declara.app'); await page.fill('input[type=password]', 'x'); await page.click('button.btn-primary')
await page.waitForSelector('.shell', { timeout: 20000 })
await page.evaluate(() => { location.hash = '#/sales' }); await page.waitForSelector('.xd .exhd-s', { timeout: 20000 })
const periods = await page.evaluate(() => [...document.querySelectorAll('.xd .fbar select.f option')].map((o) => o.value))
const failures = []
for (const k of periods) {
  await page.evaluate(() => { location.hash = '#/sales' }); await page.waitForSelector('.xd .exhd-s')
  await page.selectOption('.xd .fbar select.f', k); await page.waitForTimeout(300)
  const neu = await page.evaluate(read)
  await page.evaluate(() => { location.hash = '#/legacy-sales' }); await page.waitForSelector('.legacy-host iframe'); await page.waitForTimeout(1500)
  const frame = await (await page.$('.legacy-host iframe')).contentFrame()
  await frame.waitForSelector('.fbar select.f'); await frame.selectOption('.fbar select.f', k); await frame.waitForTimeout(600)
  const old = await frame.evaluate(read)
  for (const q of Object.keys(neu)) if (JSON.stringify(neu[q]) !== JSON.stringify(old[q]))
    failures.push(`${k} · ${q}\n     new: ${JSON.stringify(neu[q]).slice(0, 300)}\n     old: ${JSON.stringify(old[q]).slice(0, 300)}`)
  console.log(`checked ${k}: ${neu.head}`)
}
await browser.close(); server.close()
if (errors.length) failures.push('page errors: ' + errors.slice(0, 3).join(' | '))
if (failures.length) { console.error('\nSales KPIs parity failed:\n  ' + failures.join('\n  ')); process.exit(1) }
console.log(`\nSales KPIs match the original for all ${periods.length} periods.`)
