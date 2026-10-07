// New-hire onboarding: the steps a new hire works through on their Training page in their first two weeks, alongside
// Farmers University. Each step is checked off per person in onboarding_progress, with the exact time. The employee
// handbook step is special: it is done when the handbook is downloaded, and Farmers University stays locked until it
// is. Kinds of step: a task they check off, a policy they read and agree to, or a certificate they upload.
// When every step is done and two weeks have passed since their start date, promote_new_hires() (daily) moves them
// to the SDR role and the full app; REQUIRED_STEPS must match the list in that function.
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
  /** 'task' (default): checked off; 'ack': a policy to read and agree to; 'upload': a certificate to upload */
  kind?: 'task' | 'ack' | 'upload'
  /** the policy text, for 'ack' steps: paragraphs, or "• " lines as bullets */
  body?: string[]
}

/** How long onboarding lasts before a new hire can move to the full app. */
export const ONBOARDING_DAYS = 14

export const HANDBOOK_STEP = 'handbook'

/** The welcome at the top of a new hire's onboarding: who we are, and how pay works. */
export const WELCOME = {
  who: [
    'Ironwood Insurance Agency is a Farmers agency in San Jose, California. We protect households and businesses with Farmers and Foremost auto, home, business, umbrella and life coverage, and place brokered business with partner carriers when that’s the better fit.',
    'Every new hire starts as an SDR: you’re the first voice our prospects hear. You’ll set up conversations, learn our products through Farmers University, and hand qualified customers to our producers.',
  ],
  pay: [
    { when: 'The 5th', what: 'Pays your hours from the 16th through the end of the previous month (the 30th or 31st).' },
    { when: 'The 20th', what: 'Pays your hours from the 1st through the 15th.' },
    { when: 'Commissions', what: 'Paid on the 20th, for the commissions you earned in the previous month.' },
  ],
  time: [
    { when: 'Clocking in', what: 'Clock in and out every day — including breaks — in AgencyZoom HR.' },
    { when: 'Paid time off', what: 'You earn 1 week of PTO on every work anniversary.' },
    { when: 'Unpaid time off', what: 'Needs at least 30 days’ notice.' },
    { when: 'Requests', what: 'Every PTO and time-off request goes through AgencyZoom HR, where it’s tracked and approved.' },
  ],
}

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
      { label: 'Gusto (payroll)', url: 'https://app.gusto.com/login' },
    ],
    doneLabel: 'I’ve imported the bookmarks and signed in to each one',
  },
  {
    key: 'gusto',
    title: 'Set Up Your Payroll in Gusto',
    description: 'We run payroll through Gusto. Finish your Gusto profile so you’re paid on time — your first paycheck can’t go out until it’s complete.',
    steps: [
      'Open the invitation email from Gusto (check spam) and create your login — or sign in below if you already have one.',
      'Complete your personal details and an emergency contact.',
      'Fill out your federal W-4 and California DE 4 (tax withholding).',
      'Complete Section 1 of your I-9 by your first day, and bring your ID documents to your manager within 3 business days.',
      'Add your bank account for direct deposit.',
      'Review and sign any documents waiting for you in Gusto.',
    ],
    links: [{ label: 'Sign in to Gusto', url: 'https://app.gusto.com/login' }],
    doneLabel: 'I’ve finished my Gusto setup, including direct deposit',
  },
  {
    key: 'harassment',
    kind: 'upload',
    title: 'Complete California Harassment Prevention Training',
    description: 'California requires all employees to complete 1 hour of sexual harassment and abusive conduct prevention training within 6 months of hire. The state’s course is free and online — please finish it during your onboarding.',
    steps: [
      'Open the California Civil Rights Department’s training page below.',
      'Choose the 1-hour course for non-supervisory employees and complete it.',
      'Download or screenshot your certificate of completion.',
      'Upload the certificate here.',
    ],
    links: [{ label: 'CA Civil Rights Dept. — free training', url: 'https://calcivilrights.ca.gov/shpt/' }],
    doneLabel: 'Certificate uploaded',
  },
  {
    key: 'calling',
    kind: 'ack',
    title: 'Calling Rules for SDRs',
    description: 'These rules protect our customers and the agency. Breaking them can bring fines per call, so they apply to every call, every time.',
    body: [
      '• Call only between 8:00 a.m. and 9:00 p.m. in the customer’s local time.',
      '• Never call a number on the National Do Not Call Registry or our internal do-not-call list unless the person has an existing relationship with us or has asked us to call.',
      '• If anyone asks not to be called again, stop, mark the lead “Do Not Call” in AgencyZoom right away, and tell your manager.',
      '• Don’t use pre-recorded messages or auto-dialing to cell phones without the person’s written consent on file.',
      '• Start every call with your name and “Ironwood Insurance Agency, a Farmers agency.”',
      '• California requires everyone’s consent to record a call: tell the customer at the start that the call may be recorded.',
      '• Text messages follow the same rules as calls.',
      'When in doubt, don’t dial — ask your manager.',
    ],
    doneLabel: 'I’ve read the calling rules and will follow them on every call',
  },
  {
    key: 'unlicensed',
    kind: 'ack',
    title: 'What You Can and Can’t Say Without a License',
    description: 'Until you hold a California Property & Casualty license, the law limits what you can discuss with customers. This protects them and the agency’s license.',
    body: [
      'You can:',
      '• Set appointments and transfer customers to a licensed producer.',
      '• Collect basic contact information and the date their current policy renews.',
      '• Describe in general terms what the agency offers (for example, “we help with auto and home insurance”).',
      'You can’t:',
      '• Quote prices, compare rates, or say whether a customer will save money.',
      '• Explain, recommend or advise on coverages, limits or deductibles, or say whether something is covered.',
      '• Bind, change or cancel a policy, or take a payment for a policy.',
      'If a customer asks about price or coverage, say: “Great question — let me connect you with one of our licensed agents who can help with that.”',
    ],
    doneLabel: 'I understand what I can and can’t say without a license',
  },
  {
    key: 'privacy',
    kind: 'ack',
    title: 'Protecting Customer Information',
    description: 'Customers trust us with personal details like driver’s license numbers, dates of birth, addresses and claims history. Keep it safe.',
    body: [
      '• Keep customer information only in agency systems: AgencyZoom, Farmers eAgent, Declara and agency email.',
      '• Never text, screenshot, photograph or forward customer information to personal phones or personal email.',
      '• Don’t share your logins, and lock your screen whenever you step away.',
      '• Only look up customers you’re working with.',
      '• Confirm who you’re speaking with before discussing any account details.',
      '• Report a lost device, a suspicious email or a possible data leak to your manager right away.',
    ],
    doneLabel: 'I’ve read this and will protect customer information',
  },
]

/** Every step that has to be done before a new hire moves to the full app (must match promote_new_hires()). */
export const REQUIRED_STEPS = [HANDBOOK_STEP, ...ONBOARDING.map((s) => s.key)]

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

/** A new hire's certificate upload: filed (admins only) under the agency's onboarding folder, then the step is checked off. */
export async function uploadCertificate(agencyId: string, userId: string, step: string, file: File, name: string) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const id = `onb-${step}-${userId.slice(0, 8)}-${stamp}`
  const path = `${agencyId}/onboarding/${userId}/${id}-${file.name.replace(/[^A-Za-z0-9._-]+/g, '_')}`
  const up = await supabase.storage.from('documents').upload(path, file, { contentType: file.type || 'application/octet-stream' })
  if (up.error) throw up.error
  const { error } = await supabase.from('documents').insert({ id, category: 'onboarding', title: `${name} — ${step} certificate`, file_name: file.name, mime: file.type || 'application/octet-stream', storage_path: path, size_bytes: file.size, admin_only: true, uploaded: true })
  if (error) throw error
  await markStep(userId, step, true)
}
