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
      url: `${BASE}/${encodeURIComponent(ticker)}`,
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
    });
  }
  return out;
}
