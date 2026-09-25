// Outline icons from the original Vidura sidebar.
const P: Record<string, string> = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  tickets: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h8M8 13h5M3 8h18"/>',
  chat: '<path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.2-4.2A8 8 0 1 1 21 12z"/>',
  executive: '<path d="M3 20h18M6 20V10M11 20V4M16 20v-8M21 20v-5"/>',
  sales: '<path d="M3 17l6-6 4 4 8-8M21 7h-5M21 7v5"/>',
  foresight: '<path d="M12 3l1.8 4.6L18.5 9.4l-4.7 1.8L12 16l-1.8-4.8L5.5 9.4l4.7-1.8zM18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  reports: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4"/>',
  service: '<path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2zM20 14a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2zM17 18v1a3 3 0 0 1-3 3h-2"/>',
  book: '<rect x="3" y="7" width="18" height="13" rx="1"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/>',
  renew: '<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6M20.5 3.5v5h-5"/>',
  training: '<path d="M12 3 2 8l10 5 10-5-10-5zM4 11v5c0 1.5 3.6 3 8 3s8-1.5 8-3v-5"/>',
  licensing: '<path d="M5 3h14v11a3 3 0 0 1-1.6 2.7L12 20l-5.4-3.3A3 3 0 0 1 5 14zM9 9h6M9 12h4"/>',
  proteges: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M17 11a2.6 2.6 0 1 0 0-5.2M18 20a5 5 0 0 0-2-4"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  logout: '<path d="M15 17v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v2M10 12h11M18 9l3 3-3 3"/>',
  search: '<circle cx="10.6" cy="10.6" r="6.6"/><path d="M15.4 15.4 20.5 20.5"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  compare: '<path d="M4 20V10M9 20V4M15 20v-7M20 20V8"/><path d="M3 20h18"/>',
  lock: '<rect x="4" y="10.5" width="16" height="10.5" rx="2.2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5M12 14.5v2.5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>',
}
export function Icon({ name, width = 1.4 }: { name: string; width?: number }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: P[name] || P.reports }} />
}
