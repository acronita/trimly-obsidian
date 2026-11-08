/**
 * Public RSS feeds: recommended portfolios and news. Only the feed's address is
 * requested, so nothing about the user leaves the device, and whatever filters by
 * their positions runs here. Text comes from other sites: it is only ever shown as
 * plain text, and links must be https.
 *
 * Kept free of Obsidian imports so it can be unit tested in Node.
 */

export interface FeedSource {
  id: string;
  name: string;
  url: string;
  /** the feed is a site's search, so its results are checked against this */
  titleMatch?: RegExp;
}

export interface FeedItem {
  title: string;
  link: string;
  /** YYYY-MM-DD */
  date: string;
  source: string;
}

/** Sites that publish what brokers recommend each month, each with its own switch since any of them can change. */
export const PORTFOLIO_SOURCES: FeedSource[] = [
  { id: "moneytimes", name: "Money Times", url: "https://www.moneytimes.com.br/tag/carteira-recomendada/feed/" },
  { id: "investnews", name: "InvestNews", url: "https://investnews.com.br/tag/carteira-recomendada/feed/" },
  { id: "infomoney", name: "InfoMoney", url: "https://www.infomoney.com.br/?s=carteira+recomendada&feed=rss2", titleMatch: /carteira|recomend/i },
];

/**
 * Whole news feeds, filtered here by the positions' tickers. Asking the sites for
 * news on a ticker would tell them what the user holds, so all of it is read instead.
 * Each page is ten or so items, so this reaches back about a day.
 */
export const NEWS_SOURCES: FeedSource[] = [
  { id: "infomoney", name: "InfoMoney", url: "https://www.infomoney.com.br/feed/" },
  { id: "moneytimes", name: "Money Times", url: "https://www.moneytimes.com.br/feed/" },
  { id: "seudinheiro", name: "Seu Dinheiro", url: "https://www.seudinheiro.com/feed/" },
];
const NEWS_PAGES = 5;

/** Every source with its own switch in the settings, once each. */
export const ALL_SOURCES: FeedSource[] = [...new Map([...PORTFOLIO_SOURCES, ...NEWS_SOURCES].map((s) => [s.id, s])).values()];

/** The pages to read of each news feed. */
export function newsPages(sources: FeedSource[]): FeedSource[] {
  return sources.flatMap((s) => Array.from({ length: NEWS_PAGES }, (_, i) => ({ ...s, url: `${s.url}?paged=${i + 1}` })));
}

/** How far back news and filings are worth listing. */
export const NEWS_MAX_DAYS = 30;

/** How far back a recommendation is still worth listing. */
export const PORTFOLIO_MAX_DAYS = 60;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function plainText(raw: string): string {
  return raw
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(\w+);/g, (whole, name: string) => ENTITIES[name] ?? whole)
    .replace(/\s+/g, " ")
    .trim();
}

const tag = (item: string, name: string) => item.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i"))?.[1];

/** Items of an RSS document; one missing its title, date or an https link is left out. */
export function parseRss(xml: string, source: FeedSource): FeedItem[] {
  const out: FeedItem[] = [];
  for (const [, item] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = plainText(tag(item, "title") ?? "");
    const link = plainText(tag(item, "link") ?? "");
    const time = Date.parse(plainText(tag(item, "pubDate") ?? ""));
    if (!title || !link.startsWith("https://") || Number.isNaN(time)) continue;
    if (source.titleMatch && !source.titleMatch.test(title)) continue;
    out.push({ title, link, date: new Date(time).toISOString().slice(0, 10), source: source.name });
  }
  return out;
}

/** Newest first, without repeats or anything older than `maxDays` before `today`. */
export function recentItems(items: FeedItem[], today: string, maxDays: number): FeedItem[] {
  const oldest = new Date(Date.parse(`${today}T12:00:00Z`) - maxDays * 86_400_000).toISOString().slice(0, 10);
  const seen = new Set<string>();
  return items
    .filter((i) => i.date >= oldest && !seen.has(i.link) && seen.add(i.link))
    .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
}

/** Only the sites Trimly already reads: the assistant can't be sent anywhere else. */
export function isFeedSite(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && ALL_SOURCES.some((s) => new URL(s.url).hostname === hostname);
  } catch {
    return false;
  }
}

/** Longer than this, an article costs more than it adds. */
const MAX_ARTICLE_CHARS = 30_000;

/** The readable text of a page. */
export function articleText(html: string): string {
  const body = html.replace(/<(script|style|nav|header|footer|aside|noscript)\b[\s\S]*?<\/\1>/gi, " ").replace(/<(\/p|br|\/h\d|\/li)\b[^>]*>/gi, " ");
  return plainText(body).slice(0, MAX_ARTICLE_CHARS);
}

const tickerRoot = (ticker: string) => ticker.slice(0, 4);

/** Items naming one of `tickers` in the title: any share class of the company counts (PETR3 for PETR4). */
export function newsForTickers(items: FeedItem[], tickers: string[]): (FeedItem & { ticker: string })[] {
  const out: (FeedItem & { ticker: string })[] = [];
  for (const item of items) {
    const ticker = tickers.find((t) => new RegExp(`\\b${tickerRoot(t)}\\d{1,2}F?\\b`).test(item.title));
    if (ticker) out.push({ ...item, ticker });
  }
  return out;
}
