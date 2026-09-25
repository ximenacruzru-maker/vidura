// The three colour themes and five typefaces from the original platform. Each person's choice is
// saved to their login (user_prefs), cached on the device for a flicker-free start, and applied to
// the whole app — including the original Performance screens.
import { supabase } from './supabase'

export const THEMES: Record<string, { name: string; swatch: string[] }> = {
  bubblegum: { name: 'Bubble Gum', swatch: ['#EFAAD6', '#F6CBE7', '#112E6D', '#C8102E', '#FDEFF7'] },
  dark: { name: 'Dark Mode', swatch: ['#0B1020', '#151C2E', '#5B7BFF', '#8FA6D8', '#E9EEFB'] },
  vidura: { name: 'Vidura Blue', swatch: ['#164fec', '#4d60ff', '#4263d6', '#1a4be6', '#eefaff'] },
}
export const FONTS: Record<string, { name: string; note: string; serif: string; sans: string }> = {
  cormorant: { name: 'Cormorant Garamond', note: 'High-contrast serif — the current look', serif: "'Cormorant Garamond',Georgia,serif", sans: "'Montserrat',Helvetica,Arial,sans-serif" },
  playfair: { name: 'Playfair Display', note: 'Heavier serif, more editorial', serif: "'Playfair Display',Georgia,serif", sans: "'Montserrat',Helvetica,Arial,sans-serif" },
  libre: { name: 'Libre Baskerville', note: 'Traditional, bookish, very legible', serif: "'Libre Baskerville',Georgia,serif", sans: "'Montserrat',Helvetica,Arial,sans-serif" },
  inter: { name: 'Inter', note: 'Bold geometric sans — the Vidura platform look', serif: "'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif", sans: "'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif" },
  system: { name: 'System sans only', note: 'No serif display — plainest, fastest', serif: "'Montserrat',Helvetica,Arial,sans-serif", sans: "'Montserrat',Helvetica,Arial,sans-serif" },
}
export interface Look { theme: string; font: string }
export const DEFAULT_LOOK: Look = { theme: 'vidura', font: 'system' }
const KEY = 'vidura_look_v2'
const listeners = new Set<(l: Look) => void>()
let current: Look = DEFAULT_LOOK

export function getLook() { return current }
export function onLook(fn: (l: Look) => void) { listeners.add(fn); return () => { listeners.delete(fn) } }

export function applyLook(l: Partial<Look>) {
  current = { theme: THEMES[l.theme || ''] ? l.theme! : 'vidura', font: FONTS[l.font || ''] ? l.font! : DEFAULT_LOOK.font }
  const r = document.documentElement
  r.setAttribute('data-theme', current.theme)
  r.style.setProperty('--serif', FONTS[current.font].serif)
  r.style.setProperty('--sans', FONTS[current.font].sans)
  r.style.colorScheme = current.theme === 'dark' ? 'dark' : 'light'
  listeners.forEach((fn) => fn(current))
}

export function cachedLook(): Look {
  try { return { ...DEFAULT_LOOK, ...(JSON.parse(localStorage.getItem(KEY) || '{}') || {}) } } catch { return DEFAULT_LOOK }
}

export async function loadLook(userId: string) {
  const { data } = await supabase.from('user_prefs').select('theme,font').eq('user_id', userId).maybeSingle()
  if (data) { try { localStorage.setItem(KEY, JSON.stringify(data)) } catch { /* private mode */ } applyLook(data) }
}

export async function saveLook(userId: string, l: Look) {
  applyLook(l)
  try { localStorage.setItem(KEY, JSON.stringify(l)) } catch { /* private mode */ }
  const { error } = await supabase.from('user_prefs').upsert({ user_id: userId, ...l, updated_at: new Date().toISOString() })
  if (error) throw error
}
