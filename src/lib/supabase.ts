import { createClient } from '@supabase/supabase-js'

// Publishable (public) key: safe to ship in the browser. Every table is
// protected by row-level security, so it can only read what a signed-in
// staff member of that agency is allowed to see.
export const SUPABASE_URL = 'https://sikgwlhwsezrhiylfmnx.supabase.co'
const SUPABASE_KEY = 'sb_publishable_OlAqQqzr4PRb8sTOCf5JVg__j2VYqR6'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
})
