/**
 * Merges investment positions fetched from Pluggy into the ledger.
 *
 * Pluggy reports each position's current state, not its history, so every sync
 * overwrites the numbers and records a portfolio snapshot for the day. Names
 * and classes are only set when a position is first seen.
 *
 * Kept free of Obsidian imports so it can be unit tested in Node.
 */
import { newId, recordSnapshot } from "./ledger.ts";
import type { Asset, AssetClass, Ledger } from "./ledger.ts";

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
}

export interface InvestmentSyncResult {
  added: number;
  updated: number;
  closed: number;
}

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

/**
 * Upsert the positions of the items in `itemIds` and close the ones those items
 * no longer report. Positions of other items and manual ones are left alone.
 * Records today's snapshot. Mutates the ledger.
 */
export function applyInvestments(ledger: Ledger, investments: PluggyInvestment[], itemIds: string[], today: string): InvestmentSyncResult {
  const result: InvestmentSyncResult = { added: 0, updated: 0, closed: 0 };
  const assets = ledger.investments.assets;
  const seen = new Set<string>();
  for (const p of investments) {
    seen.add(p.id);
    let asset = assets.find((a) => a.pluggyId === p.id);
    if (!asset) {
      asset = { id: newId(), name: p.name, assetClass: assetClass(p), value: 0, updatedAt: today, pluggyId: p.id, pluggyItemId: p.itemId };
      apply(asset, p, today);
      assets.push(asset);
      result.added++;
    } else if (apply(asset, p, today)) {
      result.updated++;
    }
  }
  for (const a of assets) {
    if (!a.pluggyId || a.closed || seen.has(a.pluggyId) || !itemIds.includes(a.pluggyItemId ?? "")) continue;
    a.closed = true;
    result.closed++;
  }
  recordSnapshot(ledger, today);
  return result;
}
