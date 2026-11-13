/**
 * Income analysis for the Proventos tab: each position's income against what it cost and
 * what it is worth, how concentrated the income is, distribution cuts against a ticker's own
 * history, the payment calendar and the monthly income goal. Kept free of Obsidian imports
 * (unit tested in Node).
 */
import { monthsToReach } from "./calculators.ts";
import { monthOf, shiftMonth } from "./ledger.ts";
import type { Asset, Ledger } from "./ledger.ts";
import type { Provento } from "./proventos.ts";
import { tickerOf } from "./quotes.ts";

/** A received provento: the bank's movement or one estimated from B3. */
export interface Payout {
  assetId: string;
  date: string;
  /** cents, net */
  amount: number;
}

/** CDI is compared net of the 15% income tax a fixed income application pays after two years. */
export const CDI_TAX = 0.15;

/** Income share of a single position from which the tab warns about concentration, percent. */
export const CONCENTRATION_ALERT = 25;

/** A payment this much below the ticker's average of the previous 12 months counts as a cut, percent. */
export const CUT_ALERT = 10;

export interface PositionIncome {
  asset: Asset;
  /** cents received in the window */
  income: number;
  /** of all income in the window, percent */
  share: number;
  /** income over what the position cost, percent; null when the cost is unknown */
  yieldOnCost: number | null;
  /** income over what it is worth today, percent */
  currentYield: number | null;
  /** currentYield minus the CDI net of tax, percentage points; null without the CDI */
  vsCdi: number | null;
}

/**
 * Income per position over a 12-month window, largest first. `cdi` is the CDI of the same
 * window as a fraction (0.12 for 12%), compared net of `CDI_TAX`.
 */
export function positionIncome(ledger: Ledger, payouts: Payout[], cdi: number | null): PositionIncome[] {
  const byAsset = new Map<string, number>();
  for (const p of payouts) byAsset.set(p.assetId, (byAsset.get(p.assetId) ?? 0) + p.amount);
  const total = [...byAsset.values()].reduce((s, v) => s + v, 0);
  const cdiNet = cdi === null ? null : cdi * (1 - CDI_TAX) * 100;
  const out: PositionIncome[] = [];
  for (const [assetId, income] of byAsset) {
    const asset = ledger.investments.assets.find((a) => a.id === assetId);
    if (!asset) continue;
    const currentYield = !asset.closed && asset.value > 0 ? (income / asset.value) * 100 : null;
    out.push({
      asset,
      income,
      share: total > 0 ? (income / total) * 100 : 0,
      yieldOnCost: !asset.closed && asset.invested && asset.invested > 0 ? (income / asset.invested) * 100 : null,
      currentYield,
      vsCdi: currentYield === null || cdiNet === null ? null : currentYield - cdiNet,
    });
  }
  return out.sort((a, b) => b.income - a.income);
}

export interface DistributionCut {
  asset: Asset;
  ticker: string;
  last: Provento;
  /** average per share of the previous payments, currency units */
  average: number;
  /** how far the last payment is below the average, percent */
  drop: number;
}

/**
 * Open positions whose last provento paid, per share, at least `CUT_ALERT`% less than the
 * average of the ones paid in the 12 months before it. Only tickers that pay regularly
 * (three or more earlier payments in that window, of the same kind) count, so a stock's
 * one-off dividend is not taken for a cut. JCP and dividends are compared apart.
 */
export function distributionCuts(ledger: Ledger, proventos: Provento[], today: string): DistributionCut[] {
  const out: DistributionCut[] = [];
  const seen = new Set<string>();
  for (const asset of ledger.investments.assets) {
    const ticker = !asset.closed && tickerOf(asset);
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    const paid = proventos
      .filter((p): p is Provento & { payDate: string } => p.ticker === ticker && !!p.payDate && p.payDate <= today)
      .sort((a, b) => b.payDate.localeCompare(a.payDate));
    const last = paid[0];
    if (!last) continue;
    const from = `${shiftMonth(monthOf(last.payDate), -12)}${last.payDate.slice(7)}`;
    const before = paid.slice(1).filter((p) => p.kind === last.kind && p.payDate > from);
    if (before.length < 3) continue;
    const average = before.reduce((s, p) => s + p.perShare, 0) / before.length;
    const drop = average > 0 ? ((average - last.perShare) / average) * 100 : 0;
    if (drop >= CUT_ALERT) out.push({ asset, ticker, last, average, drop });
  }
  return out.sort((a, b) => b.drop - a.drop);
}

/** The months of the window, oldest first, and per position how much it paid in each. */
export function paymentCalendar(payouts: Payout[], today: string): { months: string[]; rows: { assetId: string; byMonth: number[] }[] } {
  const thisMonth = monthOf(today);
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(thisMonth, i - 11));
  const rows = new Map<string, number[]>();
  for (const p of payouts) {
    const i = months.indexOf(monthOf(p.date));
    if (i < 0 || p.date > today) continue;
    const row = rows.get(p.assetId) ?? Array<number>(12).fill(0);
    row[i] += p.amount;
    rows.set(p.assetId, row);
  }
  const total = (r: number[]) => r.reduce((s, v) => s + v, 0);
  return {
    months,
    rows: [...rows.entries()].map(([assetId, byMonth]) => ({ assetId, byMonth })).sort((a, b) => total(b.byMonth) - total(a.byMonth)),
  };
}

export interface IncomeGoal {
  /** cents a month wanted */
  goal: number;
  /** average a month over the last 12 months */
  now: number;
  missing: number;
  /** now over goal, percent, at most 100 */
  progress: number;
  /** portfolio that pays the goal at today's yield; null without a yield */
  wealthNeeded: number | null;
  /** months of `monthly` aportes, reinvesting the income, to get there; null = never or no yield */
  months: number | null;
}

/**
 * How far the monthly income is from `goal`. The portfolio is assumed to keep paying today's
 * yield (`yieldPct`, income of 12 months over its value) and nothing else: no price change,
 * every provento reinvested, `monthly` added each month.
 */
export function incomeGoal(goal: number, income12m: number, value: number, monthly: number, yieldPct: number): IncomeGoal {
  const now = Math.round(income12m / 12);
  const missing = Math.max(0, goal - now);
  const wealthNeeded = yieldPct > 0 ? Math.round((goal * 12 * 100) / yieldPct) : null;
  let months: number | null;
  if (missing === 0) months = 0;
  else if (wealthNeeded === null) months = null;
  else months = monthsToReach(value, monthly, yieldPct, wealthNeeded);
  return { goal, now, missing, progress: goal > 0 ? Math.min(100, (now / goal) * 100) : 0, wealthNeeded, months };
}
