// Team Space's news and boost: the day's headlines (outages and major events, the top US stories, San Jose — Google
// News through the board-news function; titles and links only), and something fun (a quote of the day with an
// animated mark, or a GIF the owner picks — paste any GIF link).
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

type Item = { title: string; source: string; link: string; at: string | null }
type News = { day: string; local: Item[]; outages: Item[]; top: Item[]; breaking?: Item[] }

const QUOTES: [string, string][] = [
  ['Success is the sum of small efforts, repeated day in and day out.', 'Robert Collier'],
  ['The secret of getting ahead is getting started.', 'Mark Twain'],
  ['It always seems impossible until it’s done.', 'Nelson Mandela'],
  ['Don’t watch the clock; do what it does. Keep going.', 'Sam Levenson'],
  ['Quality is not an act, it is a habit.', 'Aristotle'],
  ['The harder I work, the luckier I get.', 'Samuel Goldwyn'],
  ['Act as if what you do makes a difference. It does.', 'William James'],
  ['Great things are done by a series of small things brought together.', 'Vincent van Gogh'],
  ['Opportunities don’t happen. You create them.', 'Chris Grosser'],
  ['You miss 100% of the shots you don’t take.', 'Wayne Gretzky'],
  ['Well done is better than well said.', 'Benjamin Franklin'],
  ['Talent wins games, but teamwork wins championships.', 'Michael Jordan'],
  ['The best way to predict the future is to create it.', 'Peter Drucker'],
  ['Every call is a chance to help someone protect what matters most.', 'Your team'],
  ['Start where you are. Use what you have. Do what you can.', 'Arthur Ashe'],
  ['Hard work beats talent when talent doesn’t work hard.', 'Tim Notke'],
  ['Little by little, a little becomes a lot.', 'Tanzanian proverb'],
  ['Coming together is a beginning; keeping together is progress; working together is success.', 'Henry Ford'],
]
const MARKS = ['🚀', '🔥', '💪', '🏆', '⭐', '🎯', '📞', '🙌']
const ago = (iso: string | null) => { if (!iso) return ''; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 60 ? `${Math.max(1, m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : new Date(iso).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) }
const goodGif = (u: string) => /^https:\/\/\S+$/i.test(u)

/** the day's headlines, read every hour (shared by the news panel and the breaking-news banner) */
export function useBoardNews(day: string, tick: number) {
  const slot = Math.floor(tick / 60)
  return useAsync(async () => {
    const { data, error } = await supabase.functions.invoke('board-news', { body: { day } })
    if (error) throw error
    return data as News
  }, [day, slot])
}
export type BoardNewsData = ReturnType<typeof useBoardNews>

/** a headline the agency pins for the day (reference_data board:HEADLINE = { text, day }), shown first in the red strip */
function usePinned(on: boolean) {
  return useAsync(async () => {
    if (!on) return null
    const { data } = await supabase.from('reference_data').select('data').eq('key', 'board:HEADLINE').maybeSingle()
    const h = data?.data as { text?: string; day?: string } | undefined
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
    return h?.text && (!h.day || h.day === today) ? h.text : null
  }, [on])
}

/** the red banner at the top of the board: the agency's pinned headline for the day, then any outage or breaking story
 *  from the last three hours */
export function BreakingNews({ news, pinned }: { news: BoardNewsData; pinned?: boolean }) {
  const pin = usePinned(!!pinned).data
  const b = news.data?.breaking || []
  if (!b.length && !pin) return null
  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }) : '')
  return (
    <div className="bt-breaking" role="alert">
      <b className="bt-breaking-tag">🚨 Breaking</b>
      <div className="bt-breaking-list">{pin && <span className="bt-pin"><span>{pin}</span><small>Today’s major news</small></span>}{b.map((i) => (
        <a key={i.link} href={i.link} target="_blank" rel="noreferrer"><span>{i.title}</span><small>{i.source}{i.at ? ` · ${time(i.at)}` : ''}</small></a>
      ))}</div>
    </div>
  )
}

/** the day's headlines in one panel: outages and major events first, then the top US stories, then San Jose */
export function BoardNews({ news, isToday }: { news: BoardNewsData; isToday: boolean }) {
  const part = (title: string, items: Item[] | undefined, n: number) => items?.length ? (
    <div className="bt-part"><span className="bt-part-h">{title}</span>
      <ul>{items.slice(0, n).map((i) => <li key={i.link}><a href={i.link} target="_blank" rel="noreferrer">{i.title}</a><small>{i.source}{i.at ? ` · ${ago(i.at)}` : ''}</small></li>)}</ul></div>
  ) : null
  const d = news.data
  return (
    <div className="ts-feed bt-news">
      <p className="ts-h">📰 {isToday ? 'Today’s news' : 'That day’s news'}</p>
      {!d && !news.error ? <p className="ts-none">Loading…</p> : news.error ? <p className="ts-none">Headlines are unavailable right now.</p> : <div className="bt-parts">
        {part('⚡ Outages', d?.outages, 3)}
        {part(isToday ? '🇺🇸 Top stories' : '🇺🇸 Major US news', d?.top, 3)}
        {part('📍 San Jose', d?.local, 3)}
        {!d?.outages.length && !d?.top.length && !d?.local.length && <p className="ts-none">No headlines for this day.</p>}
      </div>}
    </div>
  )
}

/** something fun: the quote of the day with an animated mark, or the GIF the owner picked */
export function BoardBoost({ day, isToday, edit }: { day: string; isToday: boolean; edit: boolean }) {
  const [gifTick, setGifTick] = useState(0)
  const gif = useAsync(async () => {
    const { data } = await supabase.from('reference_data').select('data').eq('key', 'board:GIF').maybeSingle()
    const url = String((data?.data as { url?: string } | undefined)?.url || '')
    return goodGif(url) ? url : ''
  }, [gifTick])
  const n = Math.floor(new Date(day + 'T12:00:00Z').getTime() / 864e5)
  const [quote, by] = QUOTES[n % QUOTES.length], mark = MARKS[n % MARKS.length]
  const setGif = async () => {
    const u = prompt('Paste a GIF link (for example from giphy.com: open the GIF, then “Copy link” › GIF link). Leave it empty to show the quote of the day.', gif.data || '')
    if (u === null) return
    const url = u.trim()
    if (url && !goodGif(url)) { alert('That doesn’t look like a link (it should start with https://).'); return }
    const { error } = await supabase.from('reference_data').upsert({ key: 'board:GIF', data: { url }, updated_at: new Date().toISOString() }, { onConflict: 'agency_id,key' })
    if (error) alert(error.message); else setGifTick((x) => x + 1)
  }
  return (
    <div className="ts-feed bt-fun">
      <p className="ts-h">{isToday ? '✨ Today’s boost' : '✨ That day’s boost'}{edit && <button type="button" className="bt-edit" onClick={setGif}>{gif.data ? 'Change GIF' : 'Add a GIF'}</button>}</p>
      <div className="bt-fun-b">
        {gif.data ? <img className="bt-gif" src={gif.data} alt="The team’s GIF of the day" /> : <div className="bt-mark" aria-hidden="true">{mark}</div>}
        <blockquote className="bt-quote">“{quote}”<cite>— {by}</cite></blockquote>
      </div>
    </div>
  )
}
