import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getFolios, type Folio } from '../lib/data'
import { shortDate, todayPacific } from '../lib/format'

interface FolioState {
  folios: Folio[]
  folio: Folio | null
  setKey: (k: string) => void
  /** The folio's end, capped at today for the open one. */
  end: string
}

const Ctx = createContext<FolioState>({ folios: [], folio: null, setKey: () => {}, end: '' })
export const useFolio = () => useContext(Ctx)

export function folioName(f: Folio) {
  return f.in_progress
    ? `${shortDate(f.start_date)} – today (open)`
    : `${shortDate(f.start_date)} – ${shortDate(f.end_date, true)}`
}

export function FolioProvider({ children }: { children: ReactNode }) {
  const [folios, setFolios] = useState<Folio[]>([])
  const [key, setKey] = useState<string>('')
  useEffect(() => {
    getFolios().then((f) => {
      setFolios(f)
      setKey((k) => k || (f.find((x) => x.in_progress) || f[0])?.start_date || '')
    })
  }, [])
  const folio = folios.find((f) => f.start_date === key) || null
  const today = todayPacific()
  const end = folio ? (folio.in_progress && folio.end_date > today ? today : folio.end_date) : ''
  return <Ctx.Provider value={{ folios, folio, setKey, end }}>{children}</Ctx.Provider>
}

export function FolioPicker() {
  const { folios, folio, setKey } = useFolio()
  return (
    <label className="picker">
      Folio
      <select value={folio?.start_date || ''} onChange={(e) => setKey(e.target.value)}>
        {folios.map((f) => (
          <option key={f.start_date} value={f.start_date}>{folioName(f)}</option>
        ))}
      </select>
    </label>
  )
}
