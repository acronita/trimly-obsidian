/**
 * Market quotes (from brapi.dev) applied to positions with a B3 ticker.
 *
 * Every matching position gets the quote for display. Manual positions with a
 * quantity also get their value recalculated, which is a market move (gain or
 * loss), not money moved. Synced positions keep the value their bank reports.
 *
 * Kept free of Obsidian imports so it can be unit tested in Node.
 */
import { recordSnapshot } from "./ledger.ts";
import type { Asset, Ledger } from "./ledger.ts";

/** B3 ticker: four letters and one or two digits (PETR4, HGLG11, BOVA11, AAPL34); a trailing F is the fractional market. */
const TICKER = /^([A-Z]{4}\d{1,2})F?$/;

export interface QuoteData {
  symbol: string;
  /** price per share, in currency units */
  price: number;
  changePct?: number | null;
  time?: string | null;
  longName?: string | null;
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
    a.quote = { price: Math.round(q.price * 100) };
    if (typeof q.changePct === "number" && Number.isFinite(q.changePct)) a.quote.changePct = q.changePct;
    if (q.time) a.quote.time = q.time;
    if (q.longName) a.quote.longName = q.longName;
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
