import { useEffect, useRef, useState } from 'react'
import { getLook, onLook } from '../lib/theme'

/** Routes that show the original Vidura performance screens, and where each one opens. The Executive
 *  Dashboard is now React (pages/executive); /legacy-dashboard keeps the original for side-by-side checks. */
export const LEGACY_ROUTES: Record<string, [string, string?]> = {
  '/legacy-dashboard': ['executive'],
  '/sales': ['sales', 'kpi'],
  '/huddle': ['sales', 'huddle'],
  '/reports': ['reports'],
  '/commissions': ['reports', 'commissions'],
  '/sdr': ['reports', 'sdr'],
}

/** Keeps one copy of the original screens loaded and switches it as the sidebar changes. */
export default function LegacyHost({ path }: { path: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [ready, setReady] = useState(false)
  const target = LEGACY_ROUTES[path]

  useEffect(() => {
    const onMsg = (e: MessageEvent) => { if (e.origin === location.origin && e.data?.vx === 'ready') setReady(true) }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  useEffect(() => {
    if (!ready) return
    const push = (l: { theme: string; font: string }) => { try { (frame.current?.contentWindow as any)?.__vxTheme?.(l.theme, l.font) } catch { /* not loaded */ } }
    push(getLook())
    return onLook(push)
  }, [ready])

  useEffect(() => {
    if (!ready || !target) return
    const w = frame.current?.contentWindow as any
    try { w?.__vxGo?.(target[0], target[1]) } catch (e) { console.error(e) }
  }, [ready, path, target])

  return (
    <div className="legacy-host" style={{ display: target ? 'block' : 'none' }}>
      <iframe ref={frame} title="Vidura performance" src="./perf/index.html" />
    </div>
  )
}
