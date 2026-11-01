import { requestUrl } from "obsidian";
import { t } from "./i18n";
import type { QuoteData } from "./quotes";

/**
 * Minimal brapi.dev client: one request per ticker, since the free plan quotes
 * one ticker per request. Only the tickers and the token are sent.
 */
const BASE = "https://brapi.dev/api/quote";

interface BrapiResult {
  symbol: string;
  regularMarketPrice?: number | null;
  regularMarketChangePercent?: number | null;
  regularMarketTime?: string | null;
  longName?: string | null;
  shortName?: string | null;
  fiftyTwoWeekLow?: number | null;
  fiftyTwoWeekHigh?: number | null;
  priceEarnings?: number | null;
  earningsPerShare?: number | null;
  marketCap?: number | null;
  logourl?: string | null;
  historicalDataPrice?: { date: number; close: number | null }[] | null;
}

export interface QuoteFetch {
  quotes: QuoteData[];
  /** one message per ticker that could not be quoted */
  errors: string[];
}

export async function fetchQuotes(token: string, tickers: string[]): Promise<QuoteFetch> {
  const out: QuoteFetch = { quotes: [], errors: [] };
  for (const ticker of tickers) {
    const res = await requestUrl({
      // the free plan allows 3 months of daily history; it comes in the same request
      url: `${BASE}/${encodeURIComponent(ticker)}?range=3mo&interval=1d`,
      headers: { Authorization: `Bearer ${token}` },
      throw: false,
    });
    // a bad token or an exhausted plan fails every ticker the same way: stop here
    if (res.status === 401 || res.status === 403) throw new Error(t.errors.brapiRejected);
    if (res.status === 429) throw new Error(t.errors.brapiLimit);
    if (res.status >= 300) {
      let detail = "";
      try {
        detail = (res.json as { message?: string })?.message ?? "";
      } catch {
        // body was not JSON
      }
      out.errors.push(t.errors.failed(t.errors.brapiQuote(ticker), res.status, detail));
      continue;
    }
    const r = (res.json as { results?: BrapiResult[] }).results?.[0];
    if (!r || typeof r.regularMarketPrice !== "number") {
      out.errors.push(t.errors.failed(t.errors.brapiQuote(ticker), res.status, ""));
      continue;
    }
    out.quotes.push({
      symbol: r.symbol || ticker,
      price: r.regularMarketPrice,
      changePct: r.regularMarketChangePercent,
      time: r.regularMarketTime,
      longName: r.longName || r.shortName,
      low52: r.fiftyTwoWeekLow,
      high52: r.fiftyTwoWeekHigh,
      pe: r.priceEarnings,
      eps: r.earningsPerShare,
      marketCap: r.marketCap,
      logo: r.logourl,
      history: (r.historicalDataPrice ?? []).flatMap((h) => (typeof h.close === "number" ? [[h.date, h.close] as [number, number]] : [])),
    });
  }
  return out;
}
