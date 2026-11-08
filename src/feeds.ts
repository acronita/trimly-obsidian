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
  /**
   * Articles on recommended portfolios. "tag": all of it is about them, and what names no
   * type of asset is about stocks. "search": a site's search also brings guides and market
   * news, so only what recommends something, of a known type, counts.
   */
  portfolio?: "tag" | "search";
  /** the broker or research house publishing this feed itself */
  house?: string;
  /** every item is of this type, whatever its title says */
  kind?: PortfolioKind;
}

export type PortfolioKind = "diversified" | "stocks" | "fii" | "fixedIncome" | "funds" | "etf" | "abroad" | "crypto";

export interface FeedItem {
  title: string;
  link: string;
  /** YYYY-MM-DD */
  date: string;
  source: string;
  /** set on articles about recommended portfolios */
  kind?: PortfolioKind;
  /** the broker or research house it is about, when known */
  house?: string;
}

/** The tags sites use are almost all about stocks, so the other types are searched for: only these two sites' feeds honor a search. */
const PORTFOLIO_SEARCHES = ["carteira recomendada fiis", "renda fixa recomendada", "fundos multimercados recomendados", "ações internacionais recomendadas", "ações americanas recomendadas", "carteira recomendada etfs", "carteira diversificada alocação", "carteira recomendada xp btg"];
const SEARCHABLE: Pick<FeedSource, "id" | "name" | "url">[] = [
  { id: "investnews", name: "InvestNews", url: "https://investnews.com.br/" },
  { id: "infomoney", name: "InfoMoney", url: "https://www.infomoney.com.br/" },
];

/** XP publishes its own portfolios, one feed per asset class. The company (PJ) ones aren't for a personal budget. */
const XP_FEEDS: [string, PortfolioKind, RegExp?][] = [
  ["guia-de-investimentos/carteiras", "diversified", /^(?!.*\bPJ\b)/],
  ["carteira-alocacao-global", "diversified"],
  ["carteiras-xp-alfa", "diversified"],
  ["acoes/carteiras", "stocks"],
  ["analise-tecnica/carteiras", "stocks"],
  ["fundos-imobiliarios/carteiras", "fii"],
  ["renda-fixa/carteiras", "fixedIncome"],
  ["internacional/carteiras", "abroad"],
];

/** Sites that publish what brokers recommend, each with its own switch since any of them can change. */
export const PORTFOLIO_SOURCES: FeedSource[] = [
  ...XP_FEEDS.map(([path, kind, titleMatch]): FeedSource => ({ id: "xp", name: "XP", url: `https://conteudos.xpi.com.br/${path}/feed/`, portfolio: "tag", house: "XP", kind, titleMatch })),
  { id: "moneytimes", name: "Money Times", url: "https://www.moneytimes.com.br/tag/carteira-recomendada/feed/", portfolio: "tag" },
  { id: "investnews", name: "InvestNews", url: "https://investnews.com.br/tag/carteira-recomendada/feed/", portfolio: "tag" },
  { id: "infomoney", name: "InfoMoney", url: "https://www.infomoney.com.br/?s=carteira+recomendada&feed=rss2", titleMatch: /carteira|recomend/i, portfolio: "tag" },
  ...SEARCHABLE.flatMap((site) => PORTFOLIO_SEARCHES.map((q): FeedSource => ({ ...site, url: `${site.url}?s=${q.split(" ").map(encodeURIComponent).join("+")}&feed=rss2`, portfolio: "search" }))),
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
export const PORTFOLIO_MAX_DAYS = 365;

/** Per type, or the list gets too long to read, and costs the assistant too much. */
const PORTFOLIO_MAX_ITEMS = 12;

/** Houses that publish their portfolios only on their own pages, with no feed to read. */
export const HOUSE_PAGES = [
  { name: "XP", url: "https://conteudos.xpi.com.br/carteiras-recomendadas/" },
  { name: "BTG Pactual", url: "https://content.btgpactual.com/research/home/acoes" },
  { name: "Genial", url: "https://analisa.genialinvestimentos.com.br/carteiras-recomendadas/" },
  { name: "Itaú", url: "https://www.itau.com.br/investimentos/carteiras-recomendadas/" },
];

/** Case and accents count: "Ágora" is a broker, "agora" is a word. */
const HOUSES = ["XP", "BTG", "Itaú BBA", "Genial", "Santander", "Bradesco BBI", "Safra", "Ágora", "BB Investimentos", "Empiricus", "Suno", "Guide"].map((name) => ({
  name,
  pattern: new RegExp(`(?<![\\p{L}\\d])${name}(?![\\p{L}\\d])`, "u"),
}));

/** The house a title is about: the first one named, since the others are usually the stocks it picked. */
function houseIn(title: string): string | undefined {
  return HOUSES.map((h) => ({ name: h.name, at: title.search(h.pattern) }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at)[0]?.name;
}

/** In the order shown. Over text without accents; the first that matches wins, so the narrow types go first. */
const PORTFOLIO_KINDS: [PortfolioKind, RegExp][] = [
  ["crypto", /cripto|bitcoin|ethereum/],
  ["fii", /\bfiis?\b|fundos? imobiliari/],
  ["etf", /\betfs?\b/],
  ["fixedIncome", /renda fixa|tesouro direto|\bcdbs?\b|debentures?|credito privado|prefixado/],
  ["funds", /multimercado|fundos? de investimento|fundos recomendados/],
  ["abroad", /internaciona|exterior|\bbdrs?\b|americanas?\b|wall street/],
  ["diversified", /diversific|alocacao|portfolio|carteiras? de investimentos?/],
  ["stocks", /\bacoes\b|\bacao\b|dividendos|small caps/],
];
const PORTFOLIO_ORDER: PortfolioKind[] = ["diversified", "stocks", "fii", "fixedIncome", "funds", "etf", "abroad", "crypto"];

/** A search's results that actually recommend something, unlike guides and market news. */
const RECOMMENDS = /recomend|indicad|melhores|favorit|carteiras?\b|top picks|estrategia|portfolio|alocacao/;

const withoutAccents = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function portfolioKind(title: string, mode: "tag" | "search"): PortfolioKind | null {
  const text = withoutAccents(title);
  if (mode === "search" && !RECOMMENDS.test(text)) return null;
  return PORTFOLIO_KINDS.find(([, pattern]) => pattern.test(text))?.[0] ?? (mode === "tag" ? "stocks" : null);
}

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
    const kind = source.portfolio && (source.kind ?? portfolioKind(title, source.portfolio));
    if (kind === null) continue;
    const house = source.portfolio && (source.house ?? houseIn(title));
    out.push({ title, link, date: new Date(time).toISOString().slice(0, 10), source: source.name, ...(kind ? { kind } : {}), ...(house ? { house } : {}) });
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

/** The houses with something listed, to filter by. */
export function portfolioHouses(items: FeedItem[], today: string): string[] {
  return [...new Set(recentItems(items, today, PORTFOLIO_MAX_DAYS).flatMap((i) => (i.house ? [i.house] : [])))].sort((a, b) => a.localeCompare(b));
}

/** The articles on recommended portfolios worth listing, by type, without the types that have none; `house` narrows them to one. */
export function portfolioGroups(items: FeedItem[], today: string, house = ""): { kind: PortfolioKind; items: FeedItem[] }[] {
  const recent = recentItems(items, today, PORTFOLIO_MAX_DAYS).filter((i) => !house || i.house === house);
  return PORTFOLIO_ORDER.map((kind) => ({ kind, items: recent.filter((i) => i.kind === kind).slice(0, PORTFOLIO_MAX_ITEMS) })).filter((g) => g.items.length);
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
