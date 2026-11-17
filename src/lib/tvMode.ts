// TV mode for a board (Team Space, the Daily Huddle Report): the menu and top bar hidden and the page full screen, for
// the big screen in the office. Esc, or leaving full screen, ends it.
import { useEffect, useState } from 'react'

export function useTvMode() {
  const [tv, setTv] = useState(false)
  useEffect(() => {
    document.body.classList.toggle('tv', tv)
    if (tv && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {})
    if (!tv && document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    const off = () => { if (!document.fullscreenElement) setTv(false) }
    document.addEventListener('fullscreenchange', off)
    return () => { document.removeEventListener('fullscreenchange', off); document.body.classList.remove('tv') }
  }, [tv])
  return [tv, setTv] as const
}
