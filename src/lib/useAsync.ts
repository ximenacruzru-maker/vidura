import { useEffect, useState } from 'react'

/** Run an async loader whenever deps change; keeps the last good data while reloading. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    fn().then(
      (d) => { if (alive) { setData(d); setLoading(false) } },
      (e) => { if (alive) { setError(e); setLoading(false) } },
    )
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, error, loading }
}
