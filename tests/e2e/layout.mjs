// Layout check, run on every pull request (npm run test:layout, after npm run build).
// Serves the built app, signs in against a stand-in for Supabase that returns the demo agency's data, and visits
// every page at phone width (iPhone 13, 390px) and desktop width (1440px) in each regular theme. It fails if a page
// throws an error, if anything makes a page wider than the screen, or if the phone menu drawer doesn't open and close.
import { chromium, devices } from 'playwright'
import { createServer } from 'http'
import fs from 'fs'
import path from 'path'
import { install } from './supabase-stub.mjs'

const DIST = path.resolve('dist')
const ROUTES = ['/today', '/work', '/chat', '/', '/sales', '/huddle', '/reports', '/commissions', '/sdr', '/foresight', '/resources',
  '/books/farmers', '/books/commercial', '/training', '/hr', '/proteges', '/settings', '/agencies']
const THEMES = ['talavera', 'declara', 'dark']
const SIZES = [['phone', { ...devices['iPhone 13'] }], ['desktop', { viewport: { width: 1440, height: 900 } }]]
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp' }

if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('Run npm run build first.'); process.exit(2) }
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let f = path.join(DIST, p === '/' ? 'index.html' : p)
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html')
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res)
}).listen(0)
const base = `http://localhost:${server.address().port}/`

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const failures = []
for (const [size, opts] of SIZES) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext(opts)
    await ctx.addInitScript((t) => { try { localStorage.setItem('declara_look_v2', JSON.stringify({ theme: t, font: 'normal' })) } catch { /* private */ } }, theme)
    const page = await ctx.newPage(); const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await install(page)
    await page.goto(base); await page.waitForSelector('input[type=email]')
    await page.fill('input[type=email]', 'demo@declara.app'); await page.fill('input[type=password]', 'x'); await page.click('button.btn-primary')
    await page.waitForSelector('.shell', { timeout: 20000 })
    for (const r of ROUTES) {
      errors.length = 0
      await page.evaluate((r) => { location.hash = '#' + r }, r); await page.waitForTimeout(1800)
      const res = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth, wide = []
        const scan = (doc, off = 0) => doc.querySelectorAll('body *').forEach((el) => {
          const s = doc.defaultView.getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || el.closest('.dr, .side')) return
          const rc = el.getBoundingClientRect(); if (!rc.width || rc.right + off <= vw + 2) return
          // Only an intentional sideways scroller excuses it (tables inside .tbl-wrap / panel bodies). The page's own
          // scroll container clips overflow instead of widening the page, so being clipped by it still counts.
          for (let p = el.parentElement; p && p !== doc.body; p = p.parentElement) {
            if (p.matches('.tbl-wrap, .panel-b, .htw, .tabs, table, details') && /(auto|scroll)/.test(doc.defaultView.getComputedStyle(p).overflowX)) return
          }
          wide.push((typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : el.tagName.toLowerCase()) + ' → ' + Math.round(rc.right + off) + 'px')
        })
        scan(document)
        const fr = document.querySelector('.legacy-host iframe')
        if (fr && fr.offsetParent) { try { scan(fr.contentDocument, fr.getBoundingClientRect().left) } catch { /* not loaded */ } }
        return { pageW: document.documentElement.scrollWidth, vw, wide: [...new Set(wide)].slice(0, 5) }
      })
      const where = `${size} · ${theme} · ${r}`
      if (res.pageW > res.vw + 1) failures.push(`${where}: page is ${res.pageW}px wide on a ${res.vw}px screen`)
      if (res.wide.length) failures.push(`${where}: runs off the screen: ${res.wide.join(', ')}`)
      if (errors.length) failures.push(`${where}: page error: ${errors[0]}`)
    }
    if (size === 'phone') {
      await page.evaluate(() => { location.hash = '#/' }); await page.waitForTimeout(800)
      await page.click('.hd-burger'); await page.waitForTimeout(400)
      const opened = await page.evaluate(() => !!document.querySelector('.side.open'))
      await page.click('.side-scrim', { position: { x: 370, y: 400 } }); await page.waitForTimeout(400)
      const closed = await page.evaluate(() => !document.querySelector('.side.open'))
      if (!opened || !closed) failures.push(`${size} · ${theme}: the menu drawer didn't ${opened ? 'close' : 'open'}`)
    }
    await ctx.close()
    console.log(`checked ${size} · ${theme}`)
  }
}
await browser.close(); server.close()
if (failures.length) { console.error('\nLayout check failed:\n  ' + failures.join('\n  ')); process.exit(1) }
console.log(`\nLayout check passed: ${ROUTES.length} pages × ${THEMES.length} themes × ${SIZES.length} sizes.`)
