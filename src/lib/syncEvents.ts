// When an AgencyZoom sync finishes (a Refresh, or the hourly run), the sync control announces it so the screens
// showing sales and quotes load again — without it they keep the numbers they opened with until the page is left.
import { useEffect, useState } from 'react'

const SYNCED = 'declara:synced'

export const announceSynced = () => window.dispatchEvent(new Event(SYNCED))

/** A number that goes up each time a sync finishes; add it to a loader's deps to reload then. */
export function useSyncStamp() {
  const [n, setN] = useState(0)
  useEffect(() => {
    const on = () => setN((x) => x + 1)
    window.addEventListener(SYNCED, on)
    return () => window.removeEventListener(SYNCED, on)
  }, [])
  return n
}
