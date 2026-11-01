/**
 * Portfolio returns from the daily snapshots, and the benchmarks: CDI, IPCA,
 * poupança, IBOV and IFIX.
 *
 * Returns are time-weighted: money put in or taken out is not gain or loss,
 * and income paid out (dividends, coupons) is. Snapshots record their flows at
 * sync time (see investment-sync.ts); older ones without them fall back to the
 * change in amount invested: contributions at cost, withdrawals scaled by the
 * portfolio's value/cost ratio.
 *
 * Kept free of Obsidian imports so it can be unit tested in Node.
 */
import { shiftMonth, toISODate } from "./ledger.ts";
import type { PortfolioSnapshot } from "./ledger.ts";

/** Growth factor since the first snapshot (1 = no change). */
export interface IndexPoint {
  date: string;
  index: number;
}

/** One value of a BCB series: CDI per day, or IPCA and poupança per month (dated the 1st), in percent. */
export interface Rate {
  date: string;
  rate: number;
}

/** An index's closing points on a trading day (IBOV, IFIX), oldest first. */
export interface Close {
  date: string;
  close: number;
}

export interface Benchmarks {
  cdi: Rate[];
  ipca: Rate[];
  poupanca: Rate[];
  /** null when B3 could not be reached; see `indexError` */
  ibov: Close[] | null;
  ifix: Close[] | null;
  indexError?: string;
}

/** Chain the per-snapshot returns into a cumulative index. */
export function portfolioIndex(snaps: PortfolioSnapshot[]): IndexPoint[] {
  if (snaps.length === 0) return [];
  const out: IndexPoint[] = [{ date: snaps[0].date, index: 1 }];
  let index = 1;
  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i - 1];
    const cur = snaps[i];
    // flows land at the end of the period; from an empty portfolio there is nothing to grow.
    // Older snapshots carry no flow: a withdrawal lowers the amount invested by its cost,
    // but takes out its current value.
    const change = cur.invested - prev.invested;
    const flow = cur.flow ?? (change < 0 && prev.invested > 0 ? (change * prev.value) / prev.invested : change);
    // payouts left the portfolio as gain
    const growth = prev.value > 0 ? (cur.value - flow + (cur.income ?? 0)) / prev.value : 1;
    index *= Math.max(0, growth);
    out.push({ date: cur.date, index });
  }
  return out;
}

/** Index on `date` (last point on or before it), or null before the first point. */
export function indexAt(points: IndexPoint[], date: string): number | null {
  let value: number | null = null;
  for (const p of points) {
    if (p.date > date) break;
    value = p.index;
  }
  return value;
}

/** Return between two dates as a fraction (0.01 = 1%); `from` before the first point counts from the start. */
export function periodReturn(points: IndexPoint[], from: string, to: string): number | null {
  if (points.length === 0) return null;
  const start = indexAt(points, from) ?? points[0].index;
  const end = indexAt(points, to);
  return end === null || start === 0 ? null : end / start - 1;
}

/** CDI accumulated over the business days after `from` up to `to`, as a fraction. */
export function cdiReturn(cdi: Rate[], from: string, to: string): number {
  let f = 1;
  for (const r of cdi) if (r.date > from && r.date <= to) f *= 1 + r.rate / 100;
  return f - 1;
}

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return toISODate(new Date(y, m, 0));
}

/**
 * Monthly rates (IPCA, poupança) of the months that lie entirely after `from` and
 * end by `to`, compounded, as a fraction.
 */
export function monthlyRateReturn(rates: Rate[], from: string, to: string): number {
  let f = 1;
  for (const r of rates) {
    const month = r.date.slice(0, 7);
    if (`${month}-01` > from && monthEnd(month) <= to) f *= 1 + r.rate / 100;
  }
  return f - 1;
}

/** Close on `date` (last one on or before it), or null before the first. */
function closeAt(closes: Close[], date: string): number | null {
  let value: number | null = null;
  for (const c of closes) {
    if (c.date > date) break;
    value = c.close;
  }
  return value;
}

/**
 * Index change between the closes on `from` and on `to`, as a fraction; `from`
 * before the first close counts from it. null without closes.
 */
export function closeReturn(closes: Close[] | null, from: string, to: string): number | null {
  if (!closes || closes.length === 0) return null;
  const start = closeAt(closes, from) ?? closes[0].close;
  const end = closeAt(closes, to);
  return end === null || start === 0 ? null : end / start - 1;
}

export interface MonthReturn {
  month: string;
  portfolio: number | null;
  /** null without benchmark data */
  cdi: number | null;
  /** null until the IBGE publishes the month */
  ipca: number | null;
  /** null until the month ends: poupança pays on the anniversary */
  poupanca: number | null;
  ibov: number | null;
  ifix: number | null;
}

/** Month by month from the first snapshot's month to `today`'s, oldest first. */
export function monthlyReturns(points: IndexPoint[], bench: Benchmarks | null, today: string): MonthReturn[] {
  if (points.length === 0) return [];
  const first = points[0].date;
  const out: MonthReturn[] = [];
  for (let m = first.slice(0, 7); m <= today.slice(0, 7); m = shiftMonth(m, 1)) {
    const prevEnd = monthEnd(shiftMonth(m, -1));
    const from = prevEnd < first ? first : prevEnd;
    const end = monthEnd(m);
    const to = end > today ? today : end;
    const ipca = bench?.ipca.find((r) => r.date.startsWith(m));
    const poupanca = end <= today ? bench?.poupanca.find((r) => r.date.startsWith(m)) : undefined;
    out.push({
      month: m,
      portfolio: periodReturn(points, from, to),
      cdi: bench ? cdiReturn(bench.cdi, from, to) : null,
      ipca: ipca ? ipca.rate / 100 : null,
      poupanca: poupanca ? poupanca.rate / 100 : null,
      ibov: closeReturn(bench?.ibov ?? null, from, to),
      ifix: closeReturn(bench?.ifix ?? null, from, to),
    });
  }
  return out;
}
