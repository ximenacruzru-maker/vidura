// The colour themes and typefaces (the originals plus Modern). Each person's choice is
// saved to their login (user_prefs), cached on the device for a flicker-free start, and applied to
// the whole app — including the original Performance screens.
import { supabase } from './supabase'

export const THEMES: Record<string, { name: string; swatch: string[]; note?: string }> = {
  bubblegum: { name: 'Bubble Gum', swatch: ['#EFAAD6', '#F6CBE7', '#112E6D', '#C8102E', '#FDEFF7'] },
  burgundy: { name: 'Burgundy', swatch: ['#7B1E3A', '#A8425F', '#2A0E16', '#C8102E', '#FBF0F2'] },
  dark: { name: 'Dark Mode', swatch: ['#0B1020', '#151C2E', '#5B7BFF', '#8FA6D8', '#E9EEFB'] },
  vidura: { name: 'Declara Blue', swatch: ['#164fec', '#4d60ff', '#4263d6', '#1a4be6', '#eefaff'] },
  modern: { name: 'Modern', note: 'Black, white and one indigo accent — flat, crisp and minimal', swatch: ['#0A0A0A', '#18181B', '#4F46E5', '#E4E4E7', '#FAFAFA'] },
}
// Each typeface pairs a distinct display face (headlines, titles, big numbers) with its own body
// face — both vary together, so switching options changes the whole app's feel, not just headings.
export const FONTS: Record<string, { name: string; note: string; serif: string; sans: string }> = {
  normal: { name: 'Normal', note: 'Clean modern sans, everywhere — the plainest, easiest to read', serif: "'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif", sans: "'Inter',ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif" },
  retro: { name: 'Retro', note: 'Bold vintage display headlines over a warm, rounded body face', serif: "'Abril Fatface',Georgia,serif", sans: "'Poppins',Helvetica,Arial,sans-serif" },
  calligraphy: { name: 'Calligraphy', note: 'Elegant flowing script headlines over a clean, readable body', serif: "'Alex Brush',cursive", sans: "'Montserrat',Helvetica,Arial,sans-serif" },
  groovy: { name: 'Groovy', note: 'Chunky seventies headlines over a soft, rounded body', serif: "'Shrikhand',Georgia,serif", sans: "'Nunito',Helvetica,Arial,sans-serif" },
  modern: { name: 'Modern', note: 'Geometric grotesque headlines over a neutral body — pairs with Modern', serif: "'Space Grotesk',ui-sans-serif,system-ui,sans-serif", sans: "'Inter',ui-sans-serif,system-ui,sans-serif" },
  classical: { name: 'Classical', note: 'Old-style Garamond headlines over a bookish serif body', serif: "'Cormorant Garamond',Garamond,Georgia,serif", sans: "'Lora',Georgia,serif" },
}
export interface Look { theme: string; font: string }
export const DEFAULT_LOOK: Look = { theme: 'vidura', font: 'normal' }
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
