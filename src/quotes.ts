/**
 * Market quotes (from brapi.dev) applied to positions with a B3 ticker.
 *
 * Every matching position gets the quote for display. Manual positions with a
 * quantity also get their value recalculated, which is a market move (gain or
 * loss), not money moved. Synced positions keep the value their bank reports.
 *
 * Kept free of Obsidian imports so it can be unit tested in Node.
 */
import { recordSnapshot, toISODate } from "./ledger.ts";
import type { Asset, Ledger, Quote } from "./ledger.ts";

/** B3 ticker: four letters and one or two digits (PETR4, HGLG11, BOVA11, AAPL34); a trailing F is the fractional market. */
const TICKER = /^([A-Z]{4}\d{1,2})F?$/;

/** A quote as brapi reports it; prices in currency units. */
export interface QuoteData {
  symbol: string;
  price: number;
  changePct?: number | null;
  time?: string | null;
  longName?: string | null;
  low52?: number | null;
  high52?: number | null;
  pe?: number | null;
  eps?: number | null;
  marketCap?: number | null;
  logo?: string | null;
  /** daily closes: [unix seconds, price] */
  history?: [number, number][];
}

const num = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const cents = (v: number) => Math.round(v * 100);

function toQuote(q: QuoteData): Quote {
  const out: Quote = { price: cents(q.price) };
  if (num(q.changePct)) out.changePct = q.changePct;
  if (q.time) out.time = q.time;
  if (q.longName) out.longName = q.longName;
  if (num(q.low52)) out.low52 = cents(q.low52);
  if (num(q.high52)) out.high52 = cents(q.high52);
  if (num(q.pe)) out.pe = q.pe;
  if (num(q.eps)) out.eps = cents(q.eps);
  if (num(q.marketCap)) out.marketCap = q.marketCap;
  if (q.logo) out.logo = q.logo;
  const history = (q.history ?? []).filter(([d, p]) => num(d) && num(p)).map(([d, p]): [string, number] => [toISODate(new Date(d * 1000)), cents(p)]);
  if (history.length) out.history = history;
  return out;
}

/**
 * Institution to show for a position: the one the bank or the user set, else
 * the company or fund name from its quote (`inferred`), else null. Display only:
 * the stored institution is never replaced by a quote.
 */
export function institutionOf(a: Pick<Asset, "institution" | "quote">): { name: string; inferred: boolean } | null {
  if (a.institution) return { name: a.institution, inferred: false };
  if (a.quote?.longName) return { name: a.quote.longName, inferred: true };
  return null;
}

/** Average price paid per share, in cents; null without quantity or cost. */
export function averagePrice(a: Pick<Asset, "invested" | "quantity">): number | null {
  return a.invested && a.quantity ? Math.round(a.invested / a.quantity) : null;
}

/** The ticker to quote for a position, or null when its code is not a B3 ticker. */
export function tickerOf(a: Pick<Asset, "code">): string | null {
  const m = a.code?.trim().toUpperCase().match(TICKER);
  return m ? m[1] : null;
}

/** Tickers of the open positions, once each. */
export function quoteTickers(ledger: Ledger): string[] {
  const out = new Set<string>();
  for (const a of ledger.investments.assets) {
    const ticker = !a.closed && tickerOf(a);
    if (ticker) out.add(ticker);
  }
  return [...out];
}

/** Store the quotes on their positions and revalue manual ones. Returns how many positions changed. Mutates the ledger. */
export function applyQuotes(ledger: Ledger, quotes: QuoteData[], today: string): number {
  const bySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));
  let changed = 0;
  let revalued = false;
  for (const a of ledger.investments.assets) {
    const ticker = !a.closed && tickerOf(a);
    const q = ticker ? bySymbol.get(ticker) : undefined;
    if (!q || !Number.isFinite(q.price)) continue;
    const before = JSON.stringify(a);
    a.quote = toQuote(q);
    if (!a.pluggyId && a.quantity) {
      const value = Math.round(q.price * 100 * a.quantity);
      if (value !== a.value) {
        a.value = value;
        a.updatedAt = today;
        revalued = true;
      }
    }
    if (JSON.stringify(a) !== before) changed++;
  }
  if (revalued) recordSnapshot(ledger, today);
  return changed;
}
