// Shared by the screens ported from the original platform (Executive Dashboard, Sales KPIs): the original
// screens' theme colours for the person's chosen look, headline figures that shrink to fit their card, and the
// dark-mode contrast pass.
import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import type { PerfData } from '../../lib/perf/data'
import { getLook, onLook, type Look } from '../../lib/theme'
import { EXTRA_FONTS, EXTRA_THEMES } from '../../lib/perf/looks'

/* ---------- appearance ---------- */
/** The original screens' own theme colours (lg:THEMES) for the person's chosen look. */
export function useLegacyLook(D: PerfData): { style: CSSProperties; dark: boolean; theme: string } {
  const [look, setLook] = useState<Look>(getLook())
  useEffect(() => onLook(setLook), [])
  const inSeason = (t: PerfData['THEMES'][string]) => {
    if (!t || !t.season) return true
    const d = new Date(), md = String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    const a = t.season.from, b = t.season.to
    return a <= b ? md >= a && md <= b : md >= a || md <= b
  }
  const themes: PerfData['THEMES'] = { ...EXTRA_THEMES, ...D.THEMES }, fonts = { ...EXTRA_FONTS, ...D.FONTS }
  const key = themes[look.theme] && inSeason(themes[look.theme]) ? look.theme : 'talavera'
  const t = themes[key] || themes.talavera || themes.declara
  const font = fonts[look.font]
  const style = { ...(t?.vars || {}), ...(font ? { '--serif': font.serif, '--sans': font.sans } : {}) } as CSSProperties
  return { style, dark: !!t?.dark, theme: key }
}

/** Shrinks a headline figure until it fits its card (engine.js fitFigures). */
export function useFitFigures(root: React.RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const fit = () => root.current?.querySelectorAll<HTMLElement>('.sc-v').forEach((el) => {
      el.style.fontSize = ''
      const box = el.parentElement; if (!box) return
      const cs = getComputedStyle(box)
      const avail = box.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
      if (avail <= 0) return
      let fs = parseFloat(getComputedStyle(el).fontSize), guard = 12
      while (el.scrollWidth > avail + 1 && fs > 13 && guard--) { fs -= 1.5; el.style.fontSize = fs + 'px' }
    })
    fit()
    let t = 0
    const onResize = () => { clearTimeout(t); t = window.setTimeout(fit, 80) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); clearTimeout(t) }
  })
}

/** Dark-mode contrast pass (engine.js darkFix): text that lands under 3:1 against its surface is pushed
 *  to whichever end reads, since the stylesheet's light tints were picked for the light design. */
export function useDarkFix(root: React.RefObject<HTMLDivElement | null>, dark: boolean) {
  useLayoutEffect(() => {
    const el = root.current; if (!el) return
    el.querySelectorAll<HTMLElement>('[data-darkfixed]').forEach((n) => { n.style.color = ''; n.removeAttribute('data-darkfixed') })
    if (!dark) return
    const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
    const parse = (v: string) => { const m = v && v.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { c: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 } }
    const bg = (n: HTMLElement | null) => { let e = n; while (e && e !== document.documentElement) { const b = parse(getComputedStyle(e).backgroundColor); if (b && b.a > 0.5) return b.c; e = e.parentElement } return [11, 16, 32] }
    el.querySelectorAll<HTMLElement>('*:not(script):not(style):not(svg):not(path)').forEach((n) => {
      if (![...n.childNodes].some((c) => c.nodeType === 3 && c.textContent!.trim())) return
      const fg = parse(getComputedStyle(n).color); if (!fg || fg.a < 0.25) return
      const L2 = lum(bg(n)), L1 = lum(fg.c)
      if ((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05) >= 3) return
      const rat = (c: number[]) => { const l = lum(c); return (Math.max(l, L2) + 0.05) / (Math.min(l, L2) + 0.05) }
      n.style.color = rat([16, 26, 46]) >= rat([233, 238, 251]) ? '#101A2E' : '#E9EEFB'
      n.setAttribute('data-darkfixed', '1')
    })
  })
}
