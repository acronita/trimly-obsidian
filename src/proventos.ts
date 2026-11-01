/**
 * Announced proventos (dividends, JCP, FII income) of the positions with a B3
 * ticker, from what the B3 website lists for each issuer (see b3.ts).
 *
 * B3 lists them by ISIN, so each one is matched back to the ticker by the
 * ISIN's share type: ACNOR is the common share (3), ACNPR the preferred (4),
 * CDAM a unit (11), CTF a fund quota (11). Rights and receipts are left out.
 *
 * Kept free of Obsidian imports so it can be unit tested in Node.
 */
import { tickerOf } from "./quotes.ts";
import type { Asset, Ledger } from "./ledger.ts";

/** One row of B3's `cashDividends`; dates "DD/MM/YYYY", rate "0,47156696000" per share. */
export interface CashDividend {
  isinCode: string;
  label: string;
  rate: string;
  lastDatePrior: string;
  paymentDate: string;
  relatedTo?: string;
}

export type ProventoKind = "dividend" | "jcp" | "income" | "other";

export interface Provento {
  ticker: string;
  kind: ProventoKind;
  /** gross, in currency units per share */
  perShare: number;
  /** last day holding the share earns it (data-com) */
  dataCom: string;
  /** null when B3 has no payment date yet */
  payDate: string | null;
  relatedTo?: string;
}

/** JCP pays with 15% income tax withheld. */
export const JCP_NET = 0.85;

const SHARE_TYPES: [string, string][] = [
  ["ACNOR", "3"],
  ["ACNPR", "4"],
  ["ACNPA", "5"],
  ["ACNPB", "6"],
  ["ACNPC", "7"],
  ["ACNPD", "8"],
  ["CDAM", "11"],
  ["CTF", "11"],
];

/** "PETR4" -> "PETR", the issuer code B3 lists proventos under. */
export function issuerOf(ticker: string): string {
  return ticker.slice(0, 4);
}

/** "BRPETRACNPR6" -> "PETR4"; null for rights, receipts and anything else. */
export function tickerOfIsin(isin: string): string | null {
  const issuer = isin.slice(2, 6);
  const type = isin.slice(6);
  const found = SHARE_TYPES.find(([code]) => type.startsWith(code));
  return found ? `${issuer}${found[1]}` : null;
}

function isoOf(br: string): string | null {
  const m = br?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function kindOf(label: string): ProventoKind {
  const l = label.trim().toUpperCase();
  if (l === "DIVIDENDO") return "dividend";
  if (l.startsWith("JRS CAP")) return "jcp";
  if (l === "RENDIMENTO") return "income";
  return "other";
}

/** B3's rows as proventos, dropping the ones no ticker matches or without a data-com. */
export function parseCashDividends(rows: CashDividend[]): Provento[] {
  const out: Provento[] = [];
  for (const r of rows) {
    const ticker = tickerOfIsin(r.isinCode ?? "");
    const dataCom = isoOf(r.lastDatePrior);
    const perShare = Number((r.rate ?? "").replace(/\./g, "").replace(",", "."));
    if (!ticker || !dataCom || !Number.isFinite(perShare) || perShare <= 0) continue;
    out.push({ ticker, kind: kindOf(r.label ?? ""), perShare, dataCom, payDate: isoOf(r.paymentDate), relatedTo: r.relatedTo || undefined });
  }
  return out;
}

/** Issuers of the open positions with a B3 ticker, once each. */
export function proventoIssuers(ledger: Ledger): string[] {
  const out = new Set<string>();
  for (const a of ledger.investments.assets) {
    const ticker = !a.closed && tickerOf(a);
    if (ticker) out.add(issuerOf(ticker));
  }
  return [...out].sort();
}

export interface UpcomingProvento {
  asset: Asset;
  provento: Provento;
  /** expected payment in cents, net of JCP tax, by today's quantity; null without one */
  amount: number | null;
}

/**
 * Proventos of the open positions still to be paid (payment date from `today`
 * on, or no payment date yet with a data-com from `today` on), by payment date.
 */
export function upcomingProventos(ledger: Ledger, proventos: Provento[], today: string): UpcomingProvento[] {
  const out: UpcomingProvento[] = [];
  for (const a of ledger.investments.assets) {
    const ticker = !a.closed && tickerOf(a);
    if (!ticker) continue;
    for (const p of proventos) {
      if (p.ticker !== ticker) continue;
      if (p.payDate ? p.payDate < today : p.dataCom < today) continue;
      const net = p.perShare * (p.kind === "jcp" ? JCP_NET : 1);
      out.push({ asset: a, provento: p, amount: a.quantity ? Math.round(a.quantity * net * 100) : null });
    }
  }
  const key = (u: UpcomingProvento) => u.provento.payDate ?? "9999-12-31";
  return out.sort((x, y) => key(x).localeCompare(key(y)) || x.provento.ticker.localeCompare(y.provento.ticker));
}

/** Per open position with a B3 ticker, the latest provento already paid (or null when B3 lists none), by ticker. */
export function lastPaidProventos(ledger: Ledger, proventos: Provento[], today: string): { ticker: string; provento: Provento | null }[] {
  const tickers = new Set<string>();
  for (const a of ledger.investments.assets) {
    const ticker = !a.closed && tickerOf(a);
    if (ticker) tickers.add(ticker);
  }
  return [...tickers].sort().map((ticker) => {
    let last: Provento | null = null;
    for (const p of proventos) {
      if (p.ticker !== ticker || !p.payDate || p.payDate >= today) continue;
      if (!last || p.payDate > (last.payDate ?? "")) last = p;
    }
    return { ticker, provento: last };
  });
}
