// New-hire onboarding: the steps a new hire works through on their Training page before (and alongside) Farmers
// University. Each step is checked off per person in onboarding_progress. The employee handbook step is special: it is
// done when the handbook is downloaded, and Farmers University stays locked until it is.
import { supabase } from './supabase'

export interface OnboardingStep {
  key: string
  title: string
  description: string
  /** a file the new hire downloads (served with the app) */
  attachment?: { label: string; href: string; file: string }
  steps?: string[]
  links?: { label: string; url: string }[]
  /** what checking it off says */
  doneLabel: string
}

export const HANDBOOK_STEP = 'handbook'

export const ONBOARDING: OnboardingStep[] = [
  {
    key: 'bookmarks',
    title: 'Set Up Your Agency Bookmarks in Chrome',
    description: 'Install the agency’s standard Chrome bookmarks so you have one-click access to the tools you’ll use every day. Importing them won’t change or delete any bookmarks you already have.',
    attachment: { label: 'agency_bookmarks.html', href: './onboarding/agency_bookmarks.html', file: 'agency_bookmarks.html' },
    steps: [
      'Download the attached file, agency_bookmarks.html.',
      'In Chrome, click the ⋮ menu (top right), then Bookmarks and lists, then Import bookmarks and settings.',
      'In the dropdown, choose “Bookmarks HTML File,” click Choose File, and select agency_bookmarks.html.',
      'Click Done. A folder named “Imported” or “Agency Tools” will appear on your bookmarks bar.',
      'Open each link once and sign in with the login your manager gave you.',
    ],
    links: [
      { label: 'Gmail', url: 'https://mail.google.com/' },
      { label: 'Farmers Agency Dashboard', url: 'https://eagent.farmersinsurance.com/' },
      { label: 'Ricochet', url: 'https://ricochet.me/' },
      { label: 'DocuSign', url: 'https://account.docusign.com/' },
      { label: 'AgencyZoom', url: 'https://app.agencyzoom.com/' },
    ],
    doneLabel: 'I’ve imported the bookmarks and signed in to each one',
  },
]

export interface Progress { step: string; done_at: string }
export const getProgress = (userId: string) =>
  supabase.from('onboarding_progress').select('step, done_at').eq('user_id', userId).then((r) => { if (r.error) throw r.error; return r.data as Progress[] })
export async function markStep(userId: string, step: string, done: boolean) {
  const q = done
    ? supabase.from('onboarding_progress').upsert({ user_id: userId, step, done_at: new Date().toISOString() }, { onConflict: 'agency_id,user_id,step' })
    : supabase.from('onboarding_progress').delete().eq('user_id', userId).eq('step', step)
  const { error } = await q
  if (error) throw error
}
