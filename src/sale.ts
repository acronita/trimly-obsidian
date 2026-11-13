/**
 * Sale calculator: what selling part of a B3 position would bring, cost in income tax and
 * take from the allocation, and how it fares against the user's own rules. It evaluates,
 * never decides. Income tax comes from `income-tax.ts`, by adding the sale as a movement and
 * comparing the month before and after, so the R$ 20.000 exemption, losses carried by group
 * and other sales of the month all count. Kept free of Obsidian imports (unit tested in Node).
 */
import { STOCK_EXEMPTION, taxKind, taxMonths, taxPositions } from "./income-tax.ts";
import type { TaxGroup, TaxIssue, TaxKind, TaxMonth, TaxPosition } from "./income-tax.ts";
import { allocationClass, investableByClass, investableTotal, investableValue, monthOf, openAssets, pensionSlice, rebalance, shiftMonth } from "./ledger.ts";
import type { Asset, AssetClass, Ledger, Movement } from "./ledger.ts";

export type SaleRuleId = "band" | "order" | "cost" | "exemptIncome" | "destination" | "reserve" | "preferAporte";

export const SALE_RULE_IDS: SaleRuleId[] = ["band", "order", "cost", "exemptIncome", "destination", "reserve", "preferAporte"];

export interface SaleRules {
  /** rules left out of the evaluation */
  off?: SaleRuleId[];
  /** "band": percentage points the class must be above its target */
  band: number;
  /** "cost": income tax plus costs, as a percent of the sale, at most */
  maxCostPct: number;
  /** "preferAporte": months of aportes within which the targets are reached without selling */
  aporteMonths: number;
}

export const DEFAULT_SALE_RULES: SaleRules = { band: 5, maxCostPct: 1, aporteMonths: 12 };

/** B3 fees for an individual on a common operation: trading 0,005% + settlement 0,025%. */
export const B3_FEES_PCT = 0.03;

export interface SaleInput {
  assetId: string;
  quantity: number;
  /** cents per share */
  price: number;
  /** brokerage and B3 fees, cents */
  costs: number;
  /** class the money goes to; none = it leaves the portfolio */
  destination?: AssetClass;
  /** what the destination yields a year, net of income tax, percent */
  destinationYield?: number;
  /** aporte per month for the scenario without selling, cents */
  monthly: number;
  /** YYYY-MM-DD */
  today: string;
}

export interface AllocationChange {
  assetClass: AssetClass;
  /** percent of the portfolio without reserve and previdência */
  now: number;
  after: number;
  /** percent, scaled to 100 */
  target: number;
}

export type RuleStatus = "pass" | "fail" | "na";

export interface RuleResult {
  id: SaleRuleId;
  status: RuleStatus;
  /** what the rule found, for the message */
  detail: {
    /** percentage points the class is above its target */
    above?: number;
    /** tax plus costs, percent of the sale */
    costPct?: number;
    /** positions to sell first, by name */
    first?: string[];
    /** why a position comes first */
    because?: "noTax" | "lowerScore";
    /** yield of what is sold, percent a year */
    yieldPct?: number;
    months?: number | null;
  };
}

export interface SaleResult {
  asset: Asset;
  kind: TaxKind;
  assetClass: AssetClass;
  quantity: number;
  /** quantity × price */
  gross: number;
  costs: number;
  /** cents per share, from the IR tab's average cost; null when unknown */
  averagePrice: number | null;
  /** gross − costs − average cost of the shares sold; null when the cost is unknown */
  gain: number | null;
  /** losses of the sale's group (common or FII) available before it */
  lossAvailable: number;
  /** of those, what the sale uses */
  lossUsed: number;
  /** the stock exemption covers the sale */
  exempt: boolean;
  /** income tax the sale adds to the month */
  tax: number;
  /** what is left in hand: gross − costs − tax */
  net: number;
  /** proventos the sold shares paid in the last 12 months */
  income12m: number;
  /** income12m as a percent of the gross */
  incomeYield: number;
  allocation: AllocationChange[];
  /** months of `monthly` aportes to bring every class within the band, without selling; null = never or no aporte */
  monthsWithoutSelling: number | null;
  rules: RuleResult[];
  issues: TaxIssue[];
}

/** Positions the calculator takes: open B3 stocks, BDRs, ETFs and FIIs with shares. */
export function sellableAssets(ledger: Ledger): Asset[] {
  return openAssets(ledger)
    .filter((a) => taxKind(a) && (a.quantity ?? 0) > 0)
    .sort((x, y) => x.name.localeCompare(y.name));
}

/** The price to start from: the quote, else what the position is worth per share. */
export function defaultPrice(a: Asset): number {
  if (a.quote?.price) return a.quote.price;
  return a.quantity ? Math.round(a.value / a.quantity) : 0;
}

export function defaultCosts(gross: number): number {
  return Math.round((gross * B3_FEES_PCT) / 100);
}

function group(m: TaxMonth | undefined, kind: TaxKind): TaxGroup | undefined {
  return m && (kind === "fii" ? m.fii : m.common);
}

/** Losses a group has to use in `month`: what is left after the month's sales so far, else what the last month left. */
function lossAvailable(months: TaxMonth[], month: string, kind: TaxKind): number {
  const before = months.filter((m) => m.month <= month);
  const last = before[before.length - 1];
  return group(last, kind)?.lossCarry ?? 0;
}

/** Proventos paid by a position in the 12 months up to `today`. */
function income12m(ledger: Ledger, assetId: string, today: string): number {
  const from = `${shiftMonth(monthOf(today), -12)}-${today.slice(8, 10)}`;
  return ledger.investments.movements
    .filter((m) => m.assetId === assetId && m.type === "income" && m.date > from && m.date <= today)
    .reduce((s, m) => s + m.amount, 0);
}

/**
 * Months of `monthly` aportes until no class is more than `band` points above its target,
 * given the current values: an overweight class gets no new money, so only the total
 * growing brings it down. 0 when none is; null without aporte, targets, or when a class
 * can never get there.
 */
export function monthsToTargets(ledger: Ledger, monthly: number, band: number): number | null {
  const lines = rebalance(ledger, 0);
  if (!lines.length) return null;
  const total = investableTotal(ledger);
  let needed = total;
  for (const l of lines) {
    if (l.pct - l.target <= band) continue;
    const ceiling = l.target + band;
    if (ceiling <= 0) return null;
    needed = Math.max(needed, (l.value * 100) / ceiling);
  }
  if (needed <= total) return 0;
  const toTargets = monthly - pensionSlice(ledger, monthly);
  if (toTargets <= 0) return null;
  return Math.ceil((needed - total) / toTargets);
}

/** The sale's tax numbers: the month's result with the sale minus without it. */
function taxOf(ledger: Ledger, asset: Asset, kind: TaxKind, quantity: number, amount: number, date: string) {
  const month = monthOf(date);
  const before = taxMonths(taxPositions(ledger));
  const sale: Movement = { id: "sale-calculator", assetId: asset.id, date, type: "sell", amount, quantity };
  // the position ends without the sold shares, or the IR tab would take them as held from before its movements
  const assets = ledger.investments.assets.map((a) => (a.id === asset.id ? { ...a, quantity: (a.quantity ?? 0) - quantity } : a));
  const withSale = { ...ledger, investments: { ...ledger.investments, assets, movements: [...ledger.investments.movements, sale] } };
  const positions = taxPositions(withSale);
  const after = taxMonths(positions);
  const now = group(before.find((m) => m.month === month), kind);
  const then = group(after.find((m) => m.month === month), kind);
  // same-day sales keep their order, so the simulated one is the last of its date
  const sold = positions.find((p) => p.asset.id === asset.id)?.sales.filter((s) => s.date === date).pop();
  const monthAfter = after.find((m) => m.month === month);
  return {
    tax: (then?.tax ?? 0) - (now?.tax ?? 0),
    lossUsed: (then?.lossUsed ?? 0) - (now?.lossUsed ?? 0),
    lossAvailable: lossAvailable(before, month, kind),
    gain: sold?.gain ?? null,
    exempt: kind === "stock" && !!monthAfter?.exempt && (sold?.gain ?? 0) > 0,
  };
}

/** Whether selling `value` of another position of the class would cost no income tax. */
function noTaxFor(positions: TaxPosition[], a: Asset, value: number, losses: Record<"common" | "fii", number>, stockRoom: number): boolean {
  const kind = taxKind(a);
  if (!kind) return false;
  const p = positions.find((x) => x.asset.id === a.id);
  if (!p?.costKnown || !p.quantity || a.value <= 0) return false;
  const sold = Math.min(value, a.value);
  const gain = sold - (p.cost * sold) / a.value;
  if (gain <= 0) return true;
  if (kind === "stock" && sold <= stockRoom) return true;
  return gain <= losses[kind === "fii" ? "fii" : "common"];
}

export function simulateSale(ledger: Ledger, input: SaleInput, rules: SaleRules = DEFAULT_SALE_RULES): SaleResult | null {
  const asset = ledger.investments.assets.find((a) => a.id === input.assetId);
  const kind = asset && taxKind(asset);
  if (!asset || !kind) return null;
  const held = asset.quantity ?? 0;
  const quantity = Math.max(0, Math.min(input.quantity, held));
  const gross = Math.round(quantity * input.price);
  const costs = Math.max(0, Math.round(input.costs));
  const tax = taxOf(ledger, asset, kind, quantity, gross - costs, input.today);
  const positions = taxPositions(ledger);
  const position = positions.find((p) => p.asset.id === asset.id);
  const averagePrice = position?.costKnown && position.quantity > 0 ? Math.round(position.cost / position.quantity) : null;
  const net = gross - costs - tax.tax;
  const paid = income12m(ledger, asset.id, input.today);
  const forgone = held > 0 ? Math.round((paid * quantity) / held) : 0;
  const assetClass = allocationClass(asset);

  // allocation: the sold part leaves its class, the money joins the destination or leaves the portfolio
  const lines = rebalance(ledger, 0);
  const byClass = new Map(investableByClass(ledger));
  const total = investableTotal(ledger);
  const sold = Math.min(gross, investableValue(ledger, asset));
  const after = new Map(byClass);
  after.set(assetClass, (after.get(assetClass) ?? 0) - sold);
  if (input.destination) after.set(input.destination, (after.get(input.destination) ?? 0) + net);
  const totalAfter = total - sold + (input.destination ? net : 0);
  const classes = [...new Set<AssetClass>([...lines.map((l) => l.assetClass), assetClass, ...(input.destination ? [input.destination] : [])])];
  const pct = (v: number, of: number) => (of > 0 ? (v / of) * 100 : 0);
  const allocation: AllocationChange[] = classes.map((c) => ({
    assetClass: c,
    now: pct(byClass.get(c) ?? 0, total),
    after: pct(Math.max(0, after.get(c) ?? 0), totalAfter),
    target: lines.find((l) => l.assetClass === c)?.target ?? 0,
  }));

  const months = monthsToTargets(ledger, input.monthly, rules.band);
  const off = new Set(rules.off ?? []);
  const results: RuleResult[] = [];
  const add = (id: SaleRuleId, status: RuleStatus, detail: RuleResult["detail"] = {}) => {
    if (!off.has(id)) results.push({ id, status, detail });
  };

  const line = allocation.find((l) => l.assetClass === assetClass)!;
  const above = line.now - line.target;
  add("band", lines.length ? (above >= rules.band ? "pass" : "fail") : "na", { above });

  if (tax.tax <= 0) add("order", "pass", {});
  else {
    const month = monthOf(input.today);
    const months = taxMonths(positions);
    const current = months.find((m) => m.month === month);
    const losses = { common: lossAvailable(months, month, "stock"), fii: lossAvailable(months, month, "fii") };
    const stockRoom = STOCK_EXEMPTION - (current?.stockSales ?? 0);
    const others = openAssets(ledger).filter((a) => a.id !== asset.id && allocationClass(a) === assetClass && taxKind(a));
    const free = others.filter((a) => noTaxFor(positions, a, gross, losses, stockRoom));
    const lower = others.filter((a) => a.weight !== undefined && asset.weight !== undefined && a.weight < asset.weight);
    if (free.length) add("order", "fail", { first: free.map((a) => a.name), because: "noTax" });
    else if (lower.length) add("order", "fail", { first: lower.map((a) => a.name), because: "lowerScore" });
    else add("order", "pass", {});
  }

  const costPct = gross > 0 ? ((tax.tax + costs) / gross) * 100 : 0;
  add("cost", gross > 0 ? (costPct <= rules.maxCostPct ? "pass" : "fail") : "na", { costPct });

  const exemptIncome = forgone > 0 && (kind === "fii" || kind === "stock");
  const incomeYield = gross > 0 ? (forgone / gross) * 100 : 0;
  const destinationLine = input.destination ? allocation.find((l) => l.assetClass === input.destination) : undefined;
  const destinationBelow = !!destinationLine && destinationLine.now < destinationLine.target;
  if (!exemptIncome) add("exemptIncome", "na", {});
  else {
    const yields = input.destinationYield !== undefined && input.destinationYield >= incomeYield;
    add("exemptIncome", destinationBelow || yields ? "pass" : "fail", { yieldPct: incomeYield });
  }

  add("destination", destinationBelow ? "pass" : "fail", {});
  add("reserve", ledger.investments.reserve?.assetIds.includes(asset.id) ? "fail" : "pass", {});
  add("preferAporte", input.monthly > 0 ? (months !== null && months <= rules.aporteMonths ? "fail" : "pass") : "na", { months });

  return {
    asset,
    kind,
    assetClass,
    quantity,
    gross,
    costs,
    averagePrice,
    gain: tax.gain,
    lossAvailable: tax.lossAvailable,
    lossUsed: tax.lossUsed,
    exempt: tax.exempt,
    tax: tax.tax,
    net,
    income12m: forgone,
    incomeYield,
    allocation,
    monthsWithoutSelling: months,
    rules: results,
    issues: position?.issues ?? [],
  };
}
