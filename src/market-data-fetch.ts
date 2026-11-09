import { requestUrl } from "obsidian";
import { STATUS_INVEST, XP, XP_LISTS, marketLookup, parseStatusInvest, parseXpRows, statusInvestCategories, statusInvestUrl, xpListUrl } from "./market-data";
import type { MarketLookup, MarketRow } from "./market-data";

/** XP's lists take dozens of requests, so a conversation's questions share one reading. */
const KEEP_MS = 60 * 60 * 1000;
const XP_PAGES_AT_ONCE = 5;
const XP_MAX_PAGES = 40;

const cache = new Map<string, { at: number; rows: MarketRow[] }>();

async function cached(key: string, load: () => Promise<MarketRow[]>): Promise<MarketRow[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.rows;
  const rows = await load();
  cache.set(key, { at: Date.now(), rows });
  return rows;
}

async function get(url: string) {
  const res = await requestUrl({ url, throw: false });
  if (res.status >= 300) throw new Error(`HTTP ${res.status}`);
  return res;
}

type XpPage = { html: string; max_pages: number };

async function xpList(list: (typeof XP_LISTS)[number]): Promise<MarketRow[]> {
  const first = (await get(xpListUrl(list, 1))).json as XpPage;
  const rows = parseXpRows(first.html);
  const last = Math.min(first.max_pages, XP_MAX_PAGES);
  for (let page = 2; page <= last; page += XP_PAGES_AT_ONCE) {
    const batch = Array.from({ length: Math.min(XP_PAGES_AT_ONCE, last - page + 1) }, (_, i) => get(xpListUrl(list, page + i)));
    for (const res of await Promise.all(batch)) rows.push(...parseXpRows((res.json as XpPage).html));
  }
  return rows;
}

/** One source's lists: a list that can't be read marks the source, and the others still count. */
async function readAll(name: string, loads: Promise<MarketRow[]>[], unavailable: string[]): Promise<MarketRow[]> {
  const settled = await Promise.allSettled(loads);
  if (settled.some((s) => s.status === "rejected")) unavailable.push(name);
  return settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
}

export async function fetchMarketData(tickers: string[], useXp: boolean): Promise<MarketLookup> {
  const unavailable: string[] = [];
  const [statusInvest, xp] = await Promise.all([
    readAll(STATUS_INVEST, statusInvestCategories(tickers).map((c) => cached(`si${c}`, async () => parseStatusInvest((await get(statusInvestUrl(c))).text))), unavailable),
    useXp ? readAll(XP, XP_LISTS.map((l) => cached(l.type, () => xpList(l))), unavailable) : Promise.resolve([]),
  ]);
  return marketLookup(tickers, statusInvest, xp, unavailable);
}
