// The carrier guide: the agency's own placement rules as a decision tree. Each step says what to do, names the
// carriers to quote (looked up in Agency Resources › Carrier markets for their portal and logins) and asks the agent
// the next question, like a flowchart. match() picks where to start from a question typed in plain words —
// "Farmers said no, bad driving record" starts at Bristol West. To change a rule, change it here.

export interface GuideOption { label: string; next: string }
export interface GuideNode {
  say: string
  /** carriers to quote at this step, by name as they appear in the carrier markets */
  carriers?: string[]
  /** a market list to show in order (its carriers, minus any named in skip) */
  list?: { key: string; skip?: string[] }
  link?: { to: string; label: string }
  /** a website to open (a carrier portal) */
  ext?: { href: string; label: string }
  /** what has to be true to go this way (a carrier's quick eligibility check) */
  checklist?: string[]
  ask?: string
  options?: GuideOption[]
  /** the end of a branch: bound, or handed to the owner */
  end?: boolean
}

const bind = (carrier: string): GuideNode => ({ say: `Bind it with ${carrier}. Done.`, carriers: [carrier], end: true })
export const KRAFT_LAKE = '1-800-339-3114'
/** NEXT Insurance (ERGO | NEXT), from its appetite & routing guide captured Oct 21, 2026 — California rules. Final say is
 *  NEXT underwriting at quote; confirm the class in the NEXT Appetite Checker. Quick check by email: coveragecheck@nextinsurance.com */
export const NEXT_PORTAL = { href: 'https://agents.nextinsurance.com', label: 'Open the NEXT Agents Portal' }
export const NEXT_GENERAL = ['Revenue under $5 million and W-2 payroll under $5 million', 'No more than 2 claims, totaling $20,000 or less, in the last 3 years', 'No prior cancellation for non-payment', 'One location only (NEXT doesn’t write multi-location in California)', 'New businesses and startups are welcome']
export const NEXT_GL = ['Liability up to $2M per occurrence / $4M aggregate (+$2M umbrella available)', 'Holds every license the business legally needs; background checks on employees', 'Subcontractor costs don’t exceed revenue',
  'Property (in CA NEXT writes GL + Commercial Property, not a BOP): not in a wildfire, coastal, windstorm or high-burglary area; building 5 stories or fewer; roof 30 years or newer and undamaged; plumbing, electrical and heating 15 years or newer; no aluminum wiring',
  'Not allowed on premises: auto servicing, car washes, welding, metalwork, woodworking; no alcohol served midnight–5 a.m.', 'Doesn’t sell gasoline, cannabis, weapons, antiques, animals, explosives, pharmaceuticals or other prohibited products',
  'Size: office under 75,000 sq ft, food & beverage under 7,500 sq ft, everything else under 35,000 sq ft']
export const NEXT_WC = ['Workers’ comp manual premium $50,000 or less; experience mod (EMR) 1.5 or below', 'All work between 3 ft below and 15 ft above ground — no roofing, trucking or tree services', 'No restaurant delivery drivers; no more than 5 employees in a vehicle; no migrant or seasonal farm workers',
  'At least one covered owner or employee (no ghost policies); not owned by another company; one FEIN', 'Owners: no felony in 5 years, no bankruptcy in 3 years, no business lawsuits', 'W-2 payroll under $5 million (the revenue limit doesn’t apply to comp)']
/** What to have ready for each Farmers Commercial section (shown in the guide and the flowchart). */
export const GL_READY = 'Have ready: what the business does, years in business, annual revenue, payroll, every location with square footage, and losses in the last 3–5 years.'
export const AUTO_READY = 'Have ready: every vehicle (VIN, year, make, model, what it’s used for, where it’s parked) and every driver (license number, date of birth), plus current carrier and losses.'
export const WC_READY = 'Have ready: payroll by job type, number of employees (full-time and part-time), the owners and whether they’re included, and losses. A workers’ comp discount may apply when they also have a Farmers businessowners policy.'
const OWNER: GuideNode = { say: 'That’s the end of the list. Ask the agency owner before telling the client no.', end: true }
const worked = (yes: string, no: string, extra: GuideOption[] = []): Pick<GuideNode, 'ask' | 'options'> =>
  ({ ask: 'Did it work — approved and priced right?', options: [{ label: 'Yes', next: yes }, { label: 'No / declined / too high', next: no }, ...extra] })

export const GUIDE: Record<string, GuideNode> = {
  start: { say: 'Let’s find where to quote it.', ask: 'What are you placing?', options: [
    { label: 'Personal auto', next: 'auto' }, { label: 'Homeowners', next: 'home' }, { label: 'Landlord / rental', next: 'landlord' },
    { label: 'Condo (HO-6)', next: 'condo' }, { label: 'Business / commercial', next: 'commercial' }] },

  /* ---------- personal auto ---------- */
  auto: { say: 'Personal auto. Farmers is always the first stop.', ask: 'Have you quoted Farmers yet?', options: [
    { label: 'Not yet', next: 'auto_farmers' }, { label: 'Yes — Farmers said no or it’s too high', next: 'auto_why' }] },
  auto_farmers: { say: 'Quote it with Farmers first.', carriers: ['Farmers'], ...worked('bind_farmers', 'auto_why') },
  auto_why: { say: 'Farmers didn’t work.', ask: 'Why not?', options: [
    { label: 'Bad driving record (tickets, accidents, DUI, lapse, SR-22)', next: 'auto_bw' },
    { label: 'Client only needs minimum limits / liability only', next: 'auto_aspire' },
    { label: 'Clean record — Farmers is just too expensive', next: 'auto_mercury' }] },
  auto_bw: { say: 'Bad record: quote Bristol West. It picks up records and lapses Farmers won’t rate.', carriers: ['Bristol West'],
    ...worked('bind_bw', 'auto_kemper', [{ label: 'They only need minimum limits / liability', next: 'auto_aspire' }]) },
  auto_kemper: { say: 'Bristol West is too high: quote Kemper. Kemper is the last resort on personal auto.', carriers: ['Kemper'],
    ...worked('bind_kemper', 'owner', [{ label: 'No — but they’d take minimum limits / liability only', next: 'auto_aspire' }]) },
  auto_aspire: { say: 'Minimum limits / liability only: quote Aspire. Use TurboRater to quote Aspire.', carriers: ['Aspire'], ...worked('bind_aspire', 'owner') },
  auto_mercury: { say: 'Clean record but Farmers is high: quote Mercury. It’s competitive on clean records and multi-car.', carriers: ['Mercury'],
    ...worked('bind_mercury', 'auto_bw') },

  /* ---------- homeowners ---------- */
  home: { say: 'Homeowners. Farmers is the first stop.', ask: 'What kind of home is it?', options: [
    { label: 'In a high wildfire / brush zone', next: 'home_fire' }, { label: 'High-value home', next: 'home_hv' }, { label: 'A regular home', next: 'home_std' }] },
  home_fire: { say: 'Wildfire zone.', ask: 'What did Farmers say?', options: [
    { label: 'Farmers will write it', next: 'bind_farmers' },
    { label: 'Farmers can only do a DIC (FAIR Plan for the fire + Farmers DIC)', next: 'home_fire_dic' },
    { label: 'Haven’t quoted Farmers yet', next: 'home_fire_farmers' }] },
  home_fire_farmers: { say: 'Quote Farmers first.', carriers: ['Farmers'], ask: 'What did Farmers say?', options: [
    { label: 'Farmers will write it', next: 'bind_farmers' }, { label: 'Farmers can only do a DIC', next: 'home_fire_dic' }, { label: 'Farmers said no', next: 'home_bamboo' }] },
  home_fire_dic: { say: 'Farmers can only do it as a DIC: the CA FAIR Plan writes the fire and Farmers writes a DIC for everything else.', ask: 'Is the client OK with a FAIR Plan + DIC?', options: [
    { label: 'Yes', next: 'home_fair_dic' }, { label: 'No — they don’t want a DIC', next: 'home_bamboo' }] },
  home_fair_dic: { say: 'Write the fire on the CA FAIR Plan and the DIC with Farmers for everything else.', carriers: ['CA FAIR Plan', 'Farmers'], end: true },
  home_bamboo: { say: 'Quote Bamboo.', carriers: ['Bamboo'], ...worked('bind_bamboo', 'home_aegis') },
  home_aegis: { say: 'Bamboo said no: quote Aegis.', carriers: ['Aegis'], ...worked('bind_aegis', 'home_delos') },
  home_delos: { say: 'Aegis said no: quote Delos — the final resort. It’s the brush-scored market the others decline.', carriers: ['Delos'], ...worked('bind_delos', 'home_fallback') },
  home_fallback: { say: 'Everyone said no: go back to Farmers with the CA FAIR Plan — the FAIR Plan writes the fire and Farmers writes the DIC for the rest.', carriers: ['Farmers', 'CA FAIR Plan'], end: true },
  home_hv: { say: 'High-value home that Farmers can’t take.', ask: 'Does it need a FAIR Plan (no one will write the fire)?', options: [
    { label: 'Yes', next: 'home_fair_dic' }, { label: 'No', next: 'hv_bamboo' }, { label: 'Haven’t quoted Farmers yet', next: 'hv_farmers' }] },
  hv_farmers: { say: 'Quote Farmers first.', carriers: ['Farmers'], ...worked('bind_farmers', 'home_hv') },
  hv_bamboo: { say: 'Quote Bamboo.', carriers: ['Bamboo'], ...worked('bind_bamboo', 'hv_delos') },
  hv_delos: { say: 'Bamboo said no: quote Delos.', carriers: ['Delos'], ...worked('bind_delos', 'home_fallback') },
  home_std: { say: 'A regular home.', ask: 'Have you quoted Farmers yet?', options: [
    { label: 'Not yet', next: 'home_std_farmers' }, { label: 'Yes — Farmers said no', next: 'home_list' }] },
  home_std_farmers: { say: 'Quote Farmers first.', carriers: ['Farmers'], ...worked('bind_farmers', 'home_list') },
  home_list: { say: 'Farmers said no: shop the rest of the home markets in this order. If one declines or is too high, go to the next.', list: { key: 'home', skip: ['Farmers'] }, end: true },

  /* ---------- the rest ---------- */
  landlord: { say: 'Landlord / rental.', ask: 'What kind of rental is it?', options: [
    { label: 'A condo unit rented to others', next: 'condo_rented' }, { label: 'A house, duplex or other dwelling', next: 'landlord_list' }] },
  landlord_list: { say: 'Landlord / rental: shop in this order. If one declines or is too high, go to the next.', list: { key: 'landlord' }, end: true },
  condo: { say: 'Condo (HO-6).', ask: 'Does the owner live in it, or is it rented to others?', options: [
    { label: 'The owner lives in it', next: 'condo_list' }, { label: 'It’s rented to others', next: 'condo_rented' }] },
  condo_list: { say: 'Condo (HO-6): shop in this order. If one declines or is too high, go to the next.', list: { key: 'condos' }, end: true },
  condo_rented: { say: 'Condo rented to others: start with Farmers.', carriers: ['Farmers'], ...worked('bind_farmers', 'condo_rented_list') },
  condo_rented_list: { say: 'Farmers said no: shop the rest of the condo markets in this order. If one declines or is too high, go to the next.', list: { key: 'condos', skip: ['Farmers'] }, end: true },
  /* ---------- business / commercial: Farmers (by the appetite guide) → Kraft Lake → wholesale ---------- */
  commercial: { say: 'Business / commercial (California risks only): Farmers Commercial is always the first stop, for any type of business.', ask: 'Which coverage are you quoting?', options: [
    { label: 'General liability (or BOP)', next: 'com_gl' }, { label: 'Commercial auto', next: 'com_auto' }, { label: 'Workers’ comp', next: 'com_wc' }] },
  com_gl: { say: `General liability — quote Farmers Commercial first, in Farmers Business Insurance Express (FBIE). ${GL_READY}`, carriers: ['Farmers'], ...worked('bind_farmers', 'com_next_gl') },
  com_next_gl: { say: 'Farmers said no: check NEXT Insurance. In California NEXT writes general liability, commercial property (GL + property instead of a BOP), professional liability, inland marine and workers’ comp. It has to pass all of these:',
    checklist: [...NEXT_GENERAL, ...NEXT_GL], ext: NEXT_PORTAL, ask: 'Does it pass NEXT’s check?', options: [
      { label: 'Yes — quote NEXT', next: 'com_next_quote' }, { label: 'No — it fails one', next: 'com_kraft' }, { label: 'Not sure', next: 'com_next_unsure' }] },
  com_next_quote: { say: 'Quote it with NEXT Insurance on the Agents Portal. Confirm the business type in NEXT’s Appetite Checker first — underwriting has the final say at quote.', carriers: ['NEXT Insurance'], ext: NEXT_PORTAL, ...worked('bind_next', 'com_kraft') },
  com_next_unsure: { say: 'Search the business type (or its NAICS / ISO / NCCI code) in NEXT’s Appetite Checker, or email the details to coveragecheck@nextinsurance.com for a quick answer.', ext: NEXT_PORTAL, ask: 'What did NEXT say?', options: [
    { label: 'NEXT will look at it', next: 'com_next_quote' }, { label: 'Not a fit for NEXT', next: 'com_kraft' }] },
  bind_next: { say: 'Bind it with NEXT Insurance. Done.', carriers: ['NEXT Insurance'], end: true },
  com_auto: { say: `Commercial auto — quote Farmers Commercial first, in FBIE. ${AUTO_READY}`, carriers: ['Farmers'], ...worked('bind_farmers', 'com_auto_prog') },
  com_auto_prog: { say: 'Farmers said no on the commercial auto: quote Progressive Commercial through KL Compare (Kraft Lake Compare). Turnaround is 3–5 business days, so tell the client when to expect it.',
    carriers: ['Progressive'], ...worked('bind_prog', 'com_whole') },
  bind_prog: { say: 'Bind it with Progressive Commercial through KL Compare. Done.', end: true },
  com_wc: { say: `Workers’ comp — quote Farmers Commercial first, in FBIE. ${WC_READY}`, carriers: ['Farmers'], ...worked('bind_farmers', 'com_next_wc') },
  com_next_wc: { say: 'Farmers said no on the comp: check NEXT Insurance (it writes workers’ comp in California). It has to pass all of these:', checklist: [...NEXT_GENERAL.filter((x) => !/^Revenue/.test(x)), ...NEXT_WC], ext: NEXT_PORTAL,
    ask: 'Does it pass NEXT’s check?', options: [{ label: 'Yes — quote NEXT', next: 'com_next_quote' }, { label: 'No — it fails one', next: 'com_kraft' }, { label: 'Not sure', next: 'com_next_unsure' }] },
  com_kraft: { say: `Refer it to Kraft Lake from inside FBIE — it carries the quote over so you don’t retype it. Questions: chat or call Kraft Lake at ${KRAFT_LAKE}. They place GL / BOP / package, workers’ comp, commercial auto, habitational, lessor’s risk, builders risk and vacant, bonds, flood, earthquake and farm & ranch.`,
    ...worked('bind_kraft', 'com_whole') },
  com_whole: { say: 'Kraft Lake can’t place it: submit it to the wholesale markets.', carriers: ['Burns & Wilcox', 'Access One80'], ...worked('bind_whole', 'owner') },
  bind_kraft: { say: 'Bind it through Kraft Lake. Done.', end: true },
  bind_whole: { say: 'Bind it through the wholesaler. Done.', end: true },

  owner: OWNER,
  bind_farmers: bind('Farmers'), bind_bw: bind('Bristol West'), bind_kemper: bind('Kemper'), bind_aspire: bind('Aspire'), bind_mercury: bind('Mercury'),
  bind_bamboo: bind('Bamboo'), bind_aegis: bind('Aegis'), bind_delos: bind('Delos'),
}

/** Where to start for a question typed in plain words. */
export function match(raw: string): string {
  const q = raw.toLowerCase().replace(/[’‘`]/g, "'") // phones type curly apostrophes (doesn’t)
  const farmersNo = /farmers (said no|declined|denied|won'?t|can'?t|cannot|turned|rejected)|(declined|denied|rejected) by farmers|too (high|expensive)/.test(q)
  if (/commercial|business|\bbop\b|\bgl\b|general liab|workers|work comp|\bwc\b|contractor|restaurant|\bllc\b|plumb|roofer|roofing|electrician|painter|landscap|salon|janitor|handyman|hvac|carpent|construction|bakery|\bcafe\b|\bdeli\b|gas station|liquor|retail store|trucking/.test(q)) {
    if (/kraft( lake)? (said no|declined|denied|can'?t|couldn'?t)/.test(q)) return 'com_whole'
    if (/\bnext( insurance)? (said no|declined|denied|can'?t|won'?t)/.test(q)) return 'com_kraft'
    const cauto = /commercial auto|business auto|fleet|trucks?\b|vehicles?|vans?\b/.test(q)
    if (cauto && /progressive/.test(q) && /said no|declin|denied|too (high|expensive)/.test(q)) return 'com_whole'
    if (farmersNo || /not (eligible|listed)/.test(q)) return cauto ? 'com_auto_prog' : /workers|work comp|\bwc\b/.test(q) ? 'com_next_wc' : 'com_next_gl'
    if (/workers|work comp|\bwc\b/.test(q)) return 'com_wc'
    if (cauto) return 'com_auto'
    if (/general liab|\bgl\b|liability|\bbop\b|business ?owners/.test(q)) return 'com_gl'
    return 'commercial'
  }
  if (/condo|ho-?6/.test(q)) return /rent|tenant|landlord|lease/.test(q) ? (farmersNo ? 'condo_rented_list' : 'condo_rented') : 'condo'
  if (/landlord|rental|dwelling|tenant|\bdp-?3\b/.test(q)) return 'landlord'
  if (/wildfire|brush|fire zone|high fire|fire risk|fire area|\bdic\b|fair plan/.test(q) || (/home|house/.test(q) && /fire/.test(q))) {
    if (/(not|doesn'?t|don'?t|won'?t|no) (want|like|need)( a| the)? dic|no dic|without (a )?dic/.test(q)) return 'home_bamboo'
    if (/high.?value|expensive (home|house)|luxury|million/.test(q)) return 'home_hv'
    if (/\bdic\b/.test(q)) return 'home_fire_dic'
    return 'home_fire'
  }
  if (/high.?value|expensive (home|house)|luxury home|million/.test(q)) return 'home_hv'
  if (/home|house|homeowner/.test(q)) return farmersNo ? 'home_list' : 'home'
  if (/minimum|min(\.)? limits|liability only|state min|bare minimum/.test(q)) return 'auto_aspire'
  if (/bristol/.test(q) && /too (high|expensive)|declin|said no/.test(q)) return 'auto_kemper'
  if (/clean (driving )?record/.test(q)) return farmersNo ? 'auto_mercury' : 'auto'
  if (/bad (driving )?record|record|tickets?|accidents?|\bdui\b|sr-?22|lapse|points|violations?/.test(q)) return 'auto_bw'
  if (/\bauto\b|\bcar\b|cars|driver|vehicle|truck|motorcycle/.test(q)) return farmersNo ? 'auto_why' : 'auto'
  return 'start'
}
