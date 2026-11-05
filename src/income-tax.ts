/**
 * Income tax on B3 variable income, from the movements in the ledger: average
 * cost per position, each sale's gain, the R$ 20.000 stock exemption, the tax due
 * per month with losses carried forward, and the year-end costs for the yearly
 * return. Common operations only: day trades, options, fixed income ETFs, FI-Infra
 * and corporate actions (splits, bonus shares) are not modeled.
 *
 * Rates: Lei 11.033/2004 art. 2-3 (15%, stock sales up to R$ 20.000 a month
 * exempt), Lei 8.668/1993 art. 18 (FII, 20%).
 *
 * An estimate to check, never a filing. Kept free of Obsidian imports so it can be
 * unit tested in Node.
 */
import { isBusinessDay } from "./business-days.ts";
import { monthOf, shiftMonth } from "./ledger.ts";
import type { Asset, Ledger, Movement } from "./ledger.ts";
import { tickerOf } from "./quotes.ts";

export type TaxKind = "stock" | "bdr" | "etf" | "fii";

/** What makes a position's numbers uncertain; shown so the user can check it. */
export type TaxIssue =
  | "missingQuantity"
  | "missingCost"
  | "missingHistory"
  | "openingEstimated"
  | "notSynced"
  | "transfer"
  | "amortization"
  | "dayTrade"
  | "noTicker";

export const STOCK_EXEMPTION = 20_000_00;
const COMMON_RATE = 0.15;
const FII_RATE = 0.2;
/** A DARF under this is not paid: it adds to the next month's. */
const DARF_MINIMUM = 10_00;
const EPSILON = 1e-6;

export interface TaxSale {
  assetId: string;
  date: string;
  kind: TaxKind;
  amount: number;
  /** amount minus average cost; null when the cost isn't known */
  gain: number | null;
}

export interface TaxPosition {
  asset: Asset;
  kind: TaxKind;
  sales: TaxSale[];
  issues: TaxIssue[];
  /** today, after every movement */
  quantity: number;
  cost: number;
  /** quantity and cost at the end of `date` */
  at: (date: string) => { quantity: number; cost: number };
}

/** One tax group's result in a month: stocks, BDRs and ETFs together, or FIIs. */
export interface TaxGroup {
  sales: number;
  /** after the exemption */
  gain: number;
  lossUsed: number;
  /** losses left for later months */
  lossCarry: number;
  tax: number;
}

export interface TaxMonth {
  month: string;
  /** sales of stocks alone, what the exemption looks at */
  stockSales: number;
  exempt: boolean;
  /** stock gains left out by the exemption */
  exemptGain: number;
  common: TaxGroup;
  fii: TaxGroup;
  /** to pay for this month, with what smaller months left; 0 under the minimum */
  darf: number;
  /** last business day of the next month; set when there is a DARF */
  due?: string;
  /** some sale's gain is unknown, so the numbers count it as zero */
  incomplete: boolean;
}

/** BDR tickers end in 31 to 39; those sales get no exemption. */
export function taxKind(a: Pick<Asset, "assetClass" | "code">): TaxKind | null {
  if (a.assetClass === "reit") return "fii";
  if (a.assetClass === "etf") return "etf";
  if (a.assetClass !== "stock") return null;
  return /3[1-9]$/.test(tickerOf(a) ?? "") ? "bdr" : "stock";
}

const isIn = (m: Movement) => m.type === "buy" || (m.type === "transfer" && m.direction !== "out");
const isOut = (m: Movement) => m.type === "sell" || (m.type === "transfer" && m.direction === "out");

/** By date, buys before sells on the same day. */
function chronological(movements: Movement[]): Movement[] {
  return [...movements].sort((x, y) => (x.date === y.date ? Number(isOut(x)) - Number(isOut(y)) : x.date < y.date ? -1 : 1));
}

export function taxPosition(asset: Asset, kind: TaxKind, allMovements: Movement[]): TaxPosition {
  const movements = chronological(allMovements.filter((m) => m.assetId === asset.id && (isIn(m) || isOut(m) || m.type === "amortization")));
  const issues = new Set<TaxIssue>();
  if (!tickerOf(asset)) issues.add("noTicker");
  if (asset.pluggyId && !asset.movementsSynced) issues.add("notSynced");
  if (movements.some((m) => m.type === "transfer")) issues.add("transfer");
  if (movements.some((m) => m.type === "amortization")) issues.add("amortization");
  const buyDates = new Set(movements.filter((m) => m.type === "buy").map((m) => m.date));
  if (movements.some((m) => m.type === "sell" && buyDates.has(m.date))) issues.add("dayTrade");

  const trades = movements.filter((m) => m.type !== "amortization");
  // without a quantity the average cost means nothing, from then on
  let reliable = trades.every((m) => m.quantity);
  if (!reliable) issues.add("missingQuantity");

  // what the movements don't explain was held before them: a closed position ended at zero
  const net = trades.reduce((s, m) => s + (isIn(m) ? 1 : -1) * (m.quantity ?? 0), 0);
  const end = asset.closed ? 0 : (asset.quantity ?? Math.max(0, net));
  let opening = end - net;
  if (opening < -EPSILON) {
    issues.add("missingHistory");
    opening = 0;
  }
  let openingCost = 0;
  if (opening > EPSILON) {
    const outs = trades.filter(isOut);
    if (asset.invested !== undefined && outs.every((m) => m.cost !== undefined)) {
      // manual positions keep the cost each withdrawal took off, so what they started with is exact
      const put = trades.filter(isIn).reduce((s, m) => s + m.amount, 0);
      const taken = outs.reduce((s, m) => s + (m.cost ?? 0), 0);
      openingCost = Math.max(0, asset.invested - put + taken);
      if (asset.pluggyId && trades.length) issues.add("openingEstimated");
    } else if (asset.invested && asset.quantity) {
      openingCost = (opening * asset.invested) / asset.quantity;
      issues.add("openingEstimated");
    } else {
      issues.add("missingCost");
      reliable = false;
    }
  }

  const sales: TaxSale[] = [];
  const replay = (upTo?: string, record = false) => {
    let quantity = opening;
    let cost = openingCost;
    for (const m of movements) {
      if (upTo && m.date > upTo) break;
      if (m.type === "amortization") {
        cost = Math.max(0, cost - m.amount);
      } else if (isIn(m)) {
        quantity += m.quantity ?? 0;
        cost += m.amount;
      } else {
        const sold = m.quantity ?? 0;
        const short = sold > quantity + EPSILON;
        if (record && short) issues.add("missingHistory");
        const taken = quantity > EPSILON ? (Math.min(sold, quantity) / quantity) * cost : 0;
        if (record && m.type === "sell") {
          sales.push({ assetId: asset.id, date: m.date, kind, amount: m.amount, gain: reliable && !short ? Math.round(m.amount - taken) : null });
        }
        cost -= taken;
        quantity = Math.max(0, quantity - sold);
      }
    }
    return { quantity, cost: Math.round(cost) };
  };
  const now = replay(undefined, true);
  return { asset, kind, sales, issues: [...issues], quantity: now.quantity, cost: now.cost, at: (date) => replay(date) };
}

/** Every stock, BDR, ETF and FII position, closed ones included: their sales still count. */
export function taxPositions(ledger: Ledger): TaxPosition[] {
  const out: TaxPosition[] = [];
  for (const a of ledger.investments.assets) {
    const kind = taxKind(a);
    if (kind) out.push(taxPosition(a, kind, ledger.investments.movements));
  }
  return out;
}

/** Last business day of the month after `month`. */
export function darfDue(month: string): string {
  const [y, m] = shiftMonth(month, 1).split("-").map(Number);
  const date = new Date(y, m, 0);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  while (!isBusinessDay(iso(date))) date.setDate(date.getDate() - 1);
  return iso(date);
}

/** The result of one group once its losses are used; a loss joins them. */
function settle(sales: number, gain: number, lossBefore: number, rate: number): TaxGroup {
  if (gain <= 0) return { sales, gain, lossUsed: 0, lossCarry: lossBefore - gain, tax: 0 };
  const lossUsed = Math.min(lossBefore, gain);
  return { sales, gain, lossUsed, lossCarry: lossBefore - lossUsed, tax: Math.round((gain - lossUsed) * rate) };
}

/** Months with sales, oldest first: losses and DARFs under the minimum carry from each to the next. */
export function taxMonths(positions: TaxPosition[]): TaxMonth[] {
  const byMonth = new Map<string, TaxSale[]>();
  for (const p of positions) {
    for (const s of p.sales) byMonth.set(monthOf(s.date), [...(byMonth.get(monthOf(s.date)) ?? []), s]);
  }
  let commonLoss = 0;
  let fiiLoss = 0;
  let pending = 0;
  return [...byMonth.keys()].sort().map((month) => {
    const sales = byMonth.get(month) ?? [];
    const sum = (list: TaxSale[], f: (s: TaxSale) => number) => list.reduce((t, s) => t + f(s), 0);
    const gainOf = (s: TaxSale) => s.gain ?? 0;
    const stocks = sales.filter((s) => s.kind === "stock");
    const others = sales.filter((s) => s.kind === "bdr" || s.kind === "etf");
    const fiis = sales.filter((s) => s.kind === "fii");
    const stockSales = sum(stocks, (s) => s.amount);
    const stockGain = sum(stocks, gainOf);
    const exempt = stockSales <= STOCK_EXEMPTION;
    // the exemption covers gains; a loss in an exempt month still counts against later gains
    const exemptGain = exempt && stockGain > 0 ? stockGain : 0;
    const common = settle(stockSales + sum(others, (s) => s.amount), stockGain - exemptGain + sum(others, gainOf), commonLoss, COMMON_RATE);
    const fii = settle(sum(fiis, (s) => s.amount), sum(fiis, gainOf), fiiLoss, FII_RATE);
    commonLoss = common.lossCarry;
    fiiLoss = fii.lossCarry;
    const owed = pending + common.tax + fii.tax;
    const darf = owed >= DARF_MINIMUM ? owed : 0;
    pending = owed - darf;
    return {
      month,
      stockSales,
      exempt,
      exemptGain,
      common,
      fii,
      darf,
      due: darf ? darfDue(month) : undefined,
      incomplete: sales.some((s) => s.gain === null),
    };
  });
}

/** Group and code on the yearly return's Bens e Direitos form; null where it should be checked in the program. */
export function assetCode(kind: TaxKind): string | null {
  if (kind === "stock") return "03-01";
  if (kind === "fii") return "07-03";
  return null;
}
