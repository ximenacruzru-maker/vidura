// The colour themes (Talavera, the default; Bubble Gum; Dark Mode; Declara Blue; and the seasonal Halloween) and typefaces. Each person's choice is
// saved to their login (user_prefs), cached on the device for a flicker-free start, and applied to
// the whole app — including the original Performance screens.
import { supabase } from './supabase'

/** A theme with a season is offered (and applied) only between those month-day dates, inclusive, every year. */
export interface Season { from: string; to: string }
export const THEMES: Record<string, { name: string; swatch: string[]; note?: string; dark?: boolean; season?: Season }> = {
  talavera: { name: 'Talavera', note: 'Terracotta, cobalt and cream, with hand-painted tile frames and borders', swatch: ['#C8692F', '#23359A', '#B4461E', '#E7B98E', '#F6EBD6'] },
  bubblegum: { name: 'Bubble Gum', swatch: ['#EFAAD6', '#F6CBE7', '#112E6D', '#C8102E', '#FDEFF7'] },
  dark: { name: 'Dark Mode', dark: true, swatch: ['#0B1020', '#151C2E', '#5B7BFF', '#8FA6D8', '#E9EEFB'] },
  vidura: { name: 'Declara Blue', swatch: ['#164fec', '#4d60ff', '#4263d6', '#1a4be6', '#eefaff'] },
  halloween: { name: 'Halloween', note: 'Limited time, until November 1 — jack-o’-lanterns, bats and cobwebs on midnight purple', dark: true, season: { from: '09-25', to: '11-01' }, swatch: ['#1C0B33', '#2A1245', '#F07A12', '#6BD13A', '#F3E6CF'] },
}
// Each typeface pairs a distinct display face (headlines, titles, big numbers) with its own body
// face — both vary together, so switching options changes the whole app's feel, not just headings.
export const FONTS: Record<string, { name: string; note: string; serif: string; sans: string }> = {
  normal: { name: 'Normal', note: 'Clean modern sans, everywhere — the plainest, easiest to read', serif: "'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif", sans: "'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif" },
  retro: { name: 'Retro', note: 'Bold vintage display headlines over a warm, rounded body face', serif: "'Abril Fatface',Georgia,serif", sans: "'Poppins',Helvetica,Arial,sans-serif" },
  calligraphy: { name: 'Calligraphy', note: 'Elegant flowing script headlines over a clean, readable body', serif: "'Alex Brush',cursive", sans: "'Montserrat',Helvetica,Arial,sans-serif" },
  groovy: { name: 'Groovy', note: 'Chunky seventies headlines over a soft, rounded body', serif: "'Shrikhand',Georgia,serif", sans: "'Nunito',Helvetica,Arial,sans-serif" },
  modern: { name: 'Modern', note: 'Geometric grotesque headlines over a neutral body', serif: "'Space Grotesk',ui-sans-serif,system-ui,sans-serif", sans: "'Inter',ui-sans-serif,system-ui,sans-serif" },
  classical: { name: 'Classical', note: 'Old-style Garamond headlines over a bookish serif body', serif: "'Cormorant Garamond',Garamond,Georgia,serif", sans: "'Lora',Georgia,serif" },
}
export function inSeason(t?: { season?: Season }, d = new Date()) {
  if (!t?.season) return true
  const md = String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'), { from, to } = t.season
  return from <= to ? md >= from && md <= to : md >= from || md <= to
}
/** The themes someone can pick today (seasonal ones drop out after their last day). */
export function availableThemes() { return Object.entries(THEMES).filter(([, t]) => inSeason(t)) }
export interface Look { theme: string; font: string }
export const DEFAULT_LOOK: Look = { theme: 'talavera', font: 'normal' }
const KEY = 'vidura_look_v2'
const listeners = new Set<(l: Look) => void>()
let current: Look = DEFAULT_LOOK

export function getLook() { return current }
export function onLook(fn: (l: Look) => void) { listeners.add(fn); return () => { listeners.delete(fn) } }

export function applyLook(l: Partial<Look>) {
  current = { theme: THEMES[l.theme || ''] && inSeason(THEMES[l.theme!]) ? l.theme! : DEFAULT_LOOK.theme, font: FONTS[l.font || ''] ? l.font! : DEFAULT_LOOK.font }
  const r = document.documentElement
  r.setAttribute('data-theme', current.theme)
  r.setAttribute('data-font', current.font)
  r.style.setProperty('--serif', FONTS[current.font].serif)
  r.style.setProperty('--sans', FONTS[current.font].sans)
  r.style.colorScheme = THEMES[current.theme].dark ? 'dark' : 'light'
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
