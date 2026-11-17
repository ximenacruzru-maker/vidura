// The "Today" row at the bottom of Team Space: something fun to start the day (a quote of the day with an animated
// mark, or a GIF the owner picks — paste any GIF link) and the day's headlines: San Jose, US outages and the top US
// stories (Google News, through the board-news function; titles and links only).
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

type Item = { title: string; source: string; link: string; at: string | null }
type News = { day: string; local: Item[]; outages: Item[]; top: Item[] }

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

export default function BoardToday({ day, isToday, edit, tick }: { day: string; isToday: boolean; edit: boolean; tick: number }) {
  const slot = Math.floor(tick / 20) // the headlines every 20 minutes
  const news = useAsync(async () => {
    const { data, error } = await supabase.functions.invoke('board-news', { body: { day } })
    if (error) throw error
    return data as News
  }, [day, slot])
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

  const list = (title: string, items: Item[] | undefined, empty: string) => (
    <div className="ts-feed bt-news">
      <p className="ts-h">{title}</p>
      {!news.data && !news.error ? <p className="ts-none">Loading…</p> : items?.length ? <ul>{items.map((i) => (
        <li key={i.link}><a href={i.link} target="_blank" rel="noreferrer">{i.title}</a><small>{i.source}{i.at ? ` · ${ago(i.at)}` : ''}</small></li>
      ))}</ul> : <p className="ts-none">{news.error ? 'Headlines are unavailable right now.' : empty}</p>}
    </div>
  )

  return (
    <div className="bt">
      <div className="ts-feed bt-fun">
        <p className="ts-h">{isToday ? '✨ Today’s boost' : '✨ That day’s boost'}{edit && <button type="button" className="bt-edit" onClick={setGif}>{gif.data ? 'Change GIF' : 'Add a GIF'}</button>}</p>
        {gif.data ? <img className="bt-gif" src={gif.data} alt="The team’s GIF of the day" /> : <div className="bt-mark" aria-hidden="true">{mark}</div>}
        <blockquote className="bt-quote">“{quote}”<cite>— {by}</cite></blockquote>
      </div>
      {list('📍 San Jose', news.data?.local, 'No San Jose headlines for this day.')}
      {list('⚡ Outages', news.data?.outages, 'No outages in the news — all systems go.')}
      {list(isToday ? '🇺🇸 Top stories' : '🇺🇸 Major US news', news.data?.top, 'No headlines for this day.')}
    </div>
  )
}
