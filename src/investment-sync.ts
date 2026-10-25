/**
 * Merges investment positions fetched from Pluggy into the ledger.
 *
 * Pluggy reports each position's current state, not its history, so every sync
 * overwrites the numbers and records a portfolio snapshot for the day. Names
 * and classes are only set when a position is first seen.
 *
 * Each snapshot also carries the money moved in or out since the previous
 * day's snapshot, so returns don't count contributions as gains: from the
 * position's movements when Pluggy returned them, otherwise estimated from
 * the change in amount invested.
 *
 * Kept free of Obsidian imports so it can be unit tested in Node.
 */
import { movementFlow, newId, recordSnapshot } from "./ledger.ts";
import type { Asset, AssetClass, Ledger, Movement, MovementType } from "./ledger.ts";

export interface PluggyInvestmentTransaction {
  id: string;
  /** BUY, SELL, TAX, TRANSFER, INTEREST or AMORTIZATION */
  type: string;
  /** CREDIT or DEBIT; tells the direction of a transfer */
  movementType?: string | null;
  /** ISO timestamp the operation was made */
  date: string;
  /** gross amount */
  amount: number;
  /** amount including expenses */
  netAmount?: number | null;
  quantity?: number | null;
  description?: string | null;
}

export interface PluggyInvestment {
  id: string;
  itemId: string;
  name: string;
  code?: string | null;
  /** FIXED_INCOME, SECURITY, MUTUAL_FUND, EQUITY, ETF or COE */
  type: string;
  subtype?: string | null;
  /** net amount, after taxes and fees */
  balance: number;
  /** gross amount */
  amount?: number | null;
  amountOriginal?: number | null;
  quantity?: number | null;
  rate?: number | null;
  rateType?: string | null;
  fixedAnnualRate?: number | null;
  issuer?: string | null;
  institution?: { name?: string | null } | null;
  /** ISO timestamps */
  date?: string | null;
  dueDate?: string | null;
  /** ACTIVE, PENDING or TOTAL_WITHDRAWAL */
  status?: string | null;
  /** fetched separately; missing when they could not be loaded */
  transactions?: PluggyInvestmentTransaction[];
}

export interface InvestmentSyncResult {
  added: number;
  updated: number;
  closed: number;
  /** movements imported for the first time */
  movements: number;
}

const MOVEMENT_TYPES: Record<string, MovementType> = {
  BUY: "buy",
  SELL: "sell",
  TAX: "tax",
  TRANSFER: "transfer",
  INTEREST: "income",
  AMORTIZATION: "amortization",
};

/** Max date drift when re-linking a movement that came back with a new id. */
const RELINK_DAYS = 3;

const RETIREMENT = ["RETIREMENT", "PGBL", "VGBL"];

export function assetClass(p: Pick<PluggyInvestment, "type" | "subtype">): AssetClass {
  const sub = p.subtype ?? "";
  switch (p.type) {
    case "FIXED_INCOME":
      return sub === "TREASURY" ? "treasury" : "fixed_income";
    case "EQUITY":
      return sub === "REAL_ESTATE_FUND" ? "reit" : sub === "ETF" ? "etf" : "stock";
    case "ETF":
      return "etf";
    case "MUTUAL_FUND":
      return RETIREMENT.includes(sub) ? "retirement" : sub === "REAL_ESTATE_FUND" ? "reit" : "fund";
    case "SECURITY":
      return RETIREMENT.includes(sub) ? "retirement" : "other";
    default:
      return "other";
  }
}

function cents(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : undefined;
}

/** Copy Pluggy's numbers onto `asset`; returns whether anything changed. */
function apply(asset: Asset, p: PluggyInvestment, today: string): boolean {
  const before = JSON.stringify(asset);
  const set = <K extends keyof Asset>(key: K, value: Asset[K] | null | undefined) => {
    if (value === undefined || value === null || value === "") delete asset[key];
    else asset[key] = value;
  };
  asset.value = cents(p.balance) ?? 0;
  set("grossValue", cents(p.amount));
  // Pluggy reports 0 when it does not know the cost; 0 would show the whole value as profit
  set("invested", cents(p.amountOriginal) || undefined);
  set("quantity", p.quantity ?? undefined);
  set("code", p.code);
  set("issuer", p.issuer);
  set("institution", p.institution?.name);
  set("rate", p.rate || undefined);
  set("rateType", p.rateType);
  set("fixedRate", p.fixedAnnualRate || undefined);
  set("dueDate", p.dueDate?.slice(0, 10));
  asset.updatedAt = p.date?.slice(0, 10) || today;
  set("closed", p.status === "TOTAL_WITHDRAWAL" || undefined);
  return JSON.stringify(asset) !== before;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

/** Invested amount that counts for flows: unknown cost counts at value, a closed position at nothing. */
function basis(a: Pick<Asset, "value" | "invested" | "closed">): number {
  return a.closed ? 0 : (a.invested ?? a.value);
}

/**
 * Money moved, estimated from the change in amount invested. A withdrawal lowers
 * the amount invested by its cost but takes out its current value.
 */
function estimatedFlow(before: Pick<Asset, "value" | "invested" | "closed">, after: Asset): number {
  const prev = basis(before);
  const change = basis(after) - prev;
  return change < 0 && prev > 0 ? Math.round((change * before.value) / prev) : change;
}

/**
 * Upsert the movements Pluggy returned for `asset`. A movement that came back
 * with a new id is re-linked to the existing one. Returns how many are new.
 */
function mergeMovements(ledger: Ledger, asset: Asset, txs: PluggyInvestmentTransaction[]): number {
  const movements = ledger.investments.movements;
  const returned = new Set(txs.map((t) => t.id));
  let added = 0;
  for (const t of txs) {
    const type = MOVEMENT_TYPES[t.type];
    if (!type) continue;
    const m: Omit<Movement, "id"> = {
      assetId: asset.id,
      date: t.date.slice(0, 10),
      type,
      amount: Math.round(Math.abs(t.netAmount ?? t.amount) * 100),
      pluggyId: t.id,
    };
    if (t.quantity) m.quantity = Math.abs(t.quantity);
    if (t.description) m.description = t.description;
    if (type === "transfer") m.direction = t.movementType === "DEBIT" ? "out" : "in";
    const existing =
      movements.find((x) => x.pluggyId === t.id) ??
      movements.find(
        (x) =>
          x.assetId === asset.id &&
          x.type === type &&
          x.amount === m.amount &&
          !returned.has(x.pluggyId ?? "") &&
          daysBetween(x.date, m.date) <= RELINK_DAYS
      );
    if (existing) Object.assign(existing, m);
    else {
      movements.push({ id: newId(), ...m });
      added++;
    }
  }
  return added;
}

/** Net flow and income of `assetId` in (`since`, `today`]. */
function windowFlows(ledger: Ledger, assetId: string, since: string, today: string): { flow: number; income: number } {
  let flow = 0;
  let income = 0;
  for (const m of ledger.investments.movements) {
    if (m.assetId !== assetId || m.date <= since || m.date > today) continue;
    flow += movementFlow(m);
    if (m.type === "income") income += m.amount;
  }
  return { flow, income };
}

/**
 * Upsert the positions of the items in `itemIds` and their movements, and close
 * the positions those items no longer report. Positions of other items and
 * manual ones are left alone. Records today's snapshot with the flows since the
 * previous day's one. Mutates the ledger.
 */
export function applyInvestments(ledger: Ledger, investments: PluggyInvestment[], itemIds: string[], today: string): InvestmentSyncResult {
  const result: InvestmentSyncResult = { added: 0, updated: 0, closed: 0, movements: 0 };
  const assets = ledger.investments.assets;
  const snaps = ledger.investments.snapshots;
  const last = snaps[snaps.length - 1];
  // flows are measured from the last snapshot of an earlier day; a second sync on the same day replaces today's
  const since = [...snaps].reverse().find((s) => s.date < today)?.date;
  const sameDay = last?.date === today ? last : undefined;
  let moved = 0;
  let estimated = 0;
  let income = 0;

  const seen = new Set<string>();
  for (const p of investments) {
    seen.add(p.id);
    let asset = assets.find((a) => a.pluggyId === p.id);
    const before = asset ? { value: asset.value, invested: asset.invested, closed: asset.closed } : { value: 0, invested: 0 };
    const newlyTracked = !asset || !!asset.closed;
    if (!asset) {
      asset = { id: newId(), name: p.name, assetClass: assetClass(p), value: 0, updatedAt: today, pluggyId: p.id, pluggyItemId: p.itemId };
      apply(asset, p, today);
      assets.push(asset);
      result.added++;
    } else if (apply(asset, p, today)) {
      result.updated++;
    }
    if (p.transactions) result.movements += mergeMovements(ledger, asset, p.transactions);
    if (since === undefined) continue;
    if (newlyTracked) {
      // e.g. a bank linked later: its old purchases are outside the window, so its value arrives as money in, not gain
      if (!asset.closed) moved += asset.value;
      if (p.transactions) income += windowFlows(ledger, asset.id, since, today).income;
    } else if (p.transactions) {
      const w = windowFlows(ledger, asset.id, since, today);
      moved += w.flow;
      income += w.income;
    } else {
      estimated += estimatedFlow(before, asset);
    }
  }
  for (const a of assets) {
    if (!a.pluggyId || a.closed || seen.has(a.pluggyId) || !itemIds.includes(a.pluggyItemId ?? "")) continue;
    const before = { value: a.value, invested: a.invested };
    a.closed = true;
    result.closed++;
    // gone without a word: assume it was withdrawn at its last value
    if (since !== undefined) estimated += estimatedFlow(before, a);
  }

  if (since === undefined) recordSnapshot(ledger, today);
  else {
    // movement flows cover the whole window each time; estimates only cover this sync's change
    const est = estimated + (sameDay?.estimated ?? 0);
    recordSnapshot(ledger, today, { flow: moved + est, estimated: est, income });
  }
  return result;
}
