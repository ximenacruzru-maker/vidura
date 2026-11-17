// Supabase Edge Function: board-news
//
// Headlines for Team Space's news panel: San Jose news, US outages (power, internet, phone, cloud, banks…) and, for today,
// the top US stories — from Google News' public RSS feeds, for the day asked for. Returns each headline's title,
// source, link and time only. Signed-in staff only (verify_jwt on). Kept in memory for an hour per day: the board
// reads the headlines, and the breaking news, once an hour.
// `breaking`: outage or breaking stories from the last three hours, for the board's red banner.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
type Item = { title: string; source: string; link: string; at: string | null };
const cache = new Map<string, { at: number; body: unknown }>();

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]+>/g, "").trim();
const tag = (x: string, t: string) => { const m = new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`).exec(x); return m ? decode(m[1]) : ""; };

async function feed(q: string | null, n: number): Promise<Item[]> {
  const url = q ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en` : "https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en";
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; board-news/1.0)" } });
  if (!r.ok) return [];
  const xml = await r.text();
  const seen = new Set<string>();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const x = m[1], source = tag(x, "source");
    let title = tag(x, "title");
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
    const d = tag(x, "pubDate");
    return { title, source, link: tag(x, "link"), at: d ? new Date(d).toISOString() : null };
  }).filter((i) => { const k = i.title.toLowerCase().slice(0, 60); if (!i.title || seen.has(k)) return false; seen.add(k); return true; }).slice(0, n);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({}));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  const day = /^\d{4}-\d{2}-\d{2}$/.test(body?.day || "") && body.day <= today ? body.day : today;
  const hit = cache.get(day);
  if (hit && Date.now() - hit.at < 60 * 60_000) return json(hit.body);
  const next = new Date(new Date(day + "T12:00:00Z").getTime() + 864e5).toISOString().slice(0, 10);
  const span = day === today ? " when:1d" : ` after:${day} before:${next}`;
  try {
    const [local, outages, top, fresh] = await Promise.all([
      feed(`"San Jose"${span}`, 5),
      feed(`(outage OR outages OR "power outage" OR "internet outage" OR "service outage" OR "is down" OR "went down" OR "banks down" OR "bank outage" OR "banking outage")${span}`, 5),
      day === today ? feed(null, 5) : feed(`(breaking OR major) news United States${span}`, 5),
      // breaking: an outage or breaking story in the last three hours (today only)
      day === today ? feed(`("is down" OR "are down" OR "went down" OR outage OR outages OR "breaking news") when:3h`, 4) : Promise.resolve([] as Item[]),
    ]);
    const recent = (i: Item) => !!i.at && Date.now() - new Date(i.at).getTime() < 3 * 3600_000
    const breaking = [...fresh, ...outages.filter(recent)].filter((i, k, all) => recent(i) && all.findIndex((x) => x.title === i.title) === k).slice(0, 3);
    const out = { day, local, outages, top, breaking };
    cache.set(day, { at: Date.now(), body: out });
    return json(out);
  } catch (e) {
    return json({ day, local: [], outages: [], top: [], breaking: [], error: (e as Error).message }, 200);
  }
});
