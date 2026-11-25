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
import { t } from "./i18n/index.ts";
import { isSameTrade, setAsideMovement, setAsideSettlementRepeats } from "./investment-import.ts";
import { IMPORT_PREFIX, flowWindowStart, newId, recordSnapshot } from "./ledger.ts";
import type { Asset, AssetClass, Ledger, Movement, MovementType } from "./ledger.ts";

/**
 * Classes a bank sync may not close on its own word: Pluggy has reported every Tesouro bond
 * gone or zeroed, more than once, while nothing was sold, and sends no movements for them.
 */
const HELD_UNTIL_PROVEN: AssetClass[] = ["treasury", "fixed_income"];

/**
 * Whether a held position (see HELD_UNTIL_PROVEN) the bank reports gone or zeroed really
 * ended. `movements` are the position's own, the bank's ones of this sync included.
 */
export function provenGone(asset: Asset, movements: Movement[], today: string): boolean {
  // a matured bond pays out on its due date
  if (asset.dueDate && asset.dueDate <= today) return true;
  // money taken out recently, after the last money put in: an old sale says nothing about today
  const recent = new Date(Date.parse(today) - PROOF_DAYS * 86_400_000).toISOString().slice(0, 10);
  const lastIn = movements.reduce((d, m) => (m.type === "buy" || (m.type === "transfer" && m.direction === "in") ? (m.date > d ? m.date : d) : d), "");
  return movements.some((m) => (m.type === "sell" || (m.type === "transfer" && m.direction === "out")) && m.date >= recent && m.date >= lastIn);
}

/** How far back a sale still explains the bank reporting a position gone. */
const PROOF_DAYS = 30;

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
  /** profit or loss so far */
  amountProfit?: number | null;
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
  /** reference date of each item left as it was because Pluggy sent older data than the ledger's */
  stale: string[];
  /** positions the bank reported gone or zeroed for the first time, kept open for lack of proof */
  held: number;
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

/** Product codes that read as product names; the rest are translated. */
const SUBTYPE_NAMES = ["CDB", "LCI", "LCA", "LC", "LIG", "LF", "CRI", "CRA", "PGBL", "VGBL"];

function productLabel(p: Pick<PluggyInvestment, "type" | "subtype">): string {
  const sub = p.subtype ?? "";
  if (SUBTYPE_NAMES.includes(sub)) return sub;
  if (sub === "STRUCTURED_NOTE") return "COE";
  const translated = t.labels.product[sub as keyof typeof t.labels.product];
  if (translated) return translated;
  return p.type === "FIXED_INCOME" ? t.labels.product.fixedIncome : "";
}

/** Tesouro Direto bonds by their technical code, most specific first. Product names are Brazilian proper names. */
const TREASURY_BONDS: [RegExp, string][] = [
  [/^LFT\b/i, "Tesouro Selic"],
  [/^NTN-?F\b/i, "Tesouro Prefixado com Juros Semestrais"],
  [/^LTN\b/i, "Tesouro Prefixado"],
  [/^NTN-?B1\b/i, "Tesouro RendA+"],
  [/^NTN-?B\s*(P|PRINC)/i, "Tesouro IPCA+"],
  [/^NTN-?B\b/i, "Tesouro IPCA+ com Juros Semestrais"],
];

/**
 * Tesouro Direto name ("Tesouro Selic 2027") for a bond Pluggy names by its
 * code (LFT, LTN, NTN-B…), falling back to the index when the code is unknown.
 * Null when it is not a treasury bond or already has a proper name.
 */
export function treasuryName(p: Pick<PluggyInvestment, "name" | "subtype" | "rateType" | "fixedAnnualRate" | "dueDate">): string | null {
  const name = p.name.trim();
  if (/tesouro/i.test(name)) return null;
  const known = TREASURY_BONDS.find(([re]) => re.test(name))?.[1];
  if (!known && p.subtype !== "TREASURY") return null;
  const product =
    known ??
    (p.rateType === "SELIC" ? "Tesouro Selic" : p.rateType === "IPCA" ? "Tesouro IPCA+" : p.fixedAnnualRate ? "Tesouro Prefixado" : null);
  if (!product) return null;
  const year = p.dueDate?.slice(0, 4);
  return year ? `${product} ${year}` : product;
}

/**
 * Pluggy's name, unless it is a treasury bond code ("LFT" → "Tesouro Selic 2027")
 * or a bare product code ("CDB224AXYZ1" → "CDB · Issuer"). Tickers stay as they are.
 */
export function displayName(
  p: Pick<PluggyInvestment, "name" | "code" | "type" | "subtype" | "issuer" | "rateType" | "fixedAnnualRate" | "dueDate">
): string {
  const treasury = treasuryName(p);
  if (treasury) return treasury;
  const name = p.name.trim();
  const looksLikeCode = (!/\s/.test(name) && /\d/.test(name)) || (!!p.code && name === p.code);
  if (!looksLikeCode || p.type === "EQUITY" || p.type === "ETF") return name;
  const label = productLabel(p);
  const parts = [label, p.issuer?.trim()].filter(Boolean);
  return parts.length ? parts.join(" · ") : name;
}

/** Copy Pluggy's numbers onto `asset`; returns whether anything changed. */
/** What it cost, when the bank reports the profit and not the cost; a profit of 0 usually means it doesn't know. */
function costFromProfit(p: PluggyInvestment): number | undefined {
  if (!p.amountProfit) return undefined;
  const cost = cents((p.amount ?? p.balance) - p.amountProfit);
  return cost && cost > 0 ? cost : undefined;
}

function apply(asset: Asset, p: PluggyInvestment, today: string, itemInstitution?: string): boolean {
  const before = JSON.stringify(asset);
  const set = <K extends keyof Asset>(key: K, value: Asset[K] | null | undefined) => {
    if (value === undefined || value === null || value === "") delete asset[key];
    else asset[key] = value;
  };
  // reported with a value again: the bank's numbers are back
  delete asset.missingSince;
  asset.value = cents(p.balance) ?? 0;
  set("grossValue", cents(p.amount));
  // Pluggy reports 0 when it does not know the cost; 0 would show the whole value as profit
  if (!asset.costEdited) set("invested", cents(p.amountOriginal) || costFromProfit(p));
  set("quantity", p.quantity ?? undefined);
  set("code", p.code);
  set("issuer", p.issuer);
  set("subtype", p.subtype);
  set("pluggyName", p.name);
  // MeuPluggy and some banks leave the institution empty: another position of the same
  // connection (same bank) may name it, and the issuer is the last stand-in. Only a fixed
  // income issuer is a bank: a fund's, FII's or stock's issuer is the product itself.
  const issuer = asset.assetClass === "fixed_income" ? p.issuer : undefined;
  if (!asset.institutionEdited) set("institution", p.institution?.name || itemInstitution || issuer);
  if (!asset.renamed) asset.name = displayName(p);
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
 * with a new id is re-linked to the existing one, and one the user deleted stays
 * deleted. Spreadsheet rows for a trade the bank now reports give way to it.
 * Returns how many are new.
 */
function mergeMovements(ledger: Ledger, asset: Asset, txs: PluggyInvestmentTransaction[]): number {
  const { movements, dismissedMovements } = ledger.investments;
  const returned = new Set(txs.map((t) => t.id));
  let added = 0;
  for (const t of txs) {
    const type = MOVEMENT_TYPES[t.type];
    if (!type) continue;
    // some brokers repeat a redemption as an empty "SAIDA" line: no money and no shares moved
    if (!Math.round(Math.abs(t.netAmount ?? t.amount) * 100) && !t.quantity) {
      ledger.investments.movements = ledger.investments.movements.filter((x) => x.pluggyId !== t.id);
      continue;
    }
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
    const relinks = (x: Movement) =>
      x.assetId === asset.id && x.type === type && x.amount === m.amount && !returned.has(x.pluggyId ?? "") && daysBetween(x.date, m.date) <= RELINK_DAYS;
    const existing =
      movements.find((x) => x.pluggyId === t.id) ??
      dismissedMovements.find((x) => x.pluggyId === t.id) ??
      movements.find(relinks) ??
      dismissedMovements.find(relinks);
    if (existing) Object.assign(existing, m);
    else {
      movements.push({ id: newId(), ...m });
      added++;
    }
  }
  const imported = movements.filter((x) => x.assetId === asset.id && x.pluggyId?.startsWith(IMPORT_PREFIX));
  for (const bank of movements.filter((x) => x.assetId === asset.id && returned.has(x.pluggyId ?? ""))) {
    const i = imported.findIndex((x) => isSameTrade(x, bank));
    if (i >= 0) setAsideMovement(ledger, imported.splice(i, 1)[0]);
  }
  return added;
}

/**
 * Pluggy can report one product twice, as an open position and a closed one, each
 * with its own copy of the same movements: they would count double. The open
 * position keeps them. Mutates the ledger.
 */
function setAsideClosedTwins(ledger: Ledger) {
  const { assets, movements } = ledger.investments;
  for (const closed of assets.filter((a) => a.pluggyId && a.closed && a.pluggyName)) {
    const open = assets.filter(
      (a) => a.pluggyId && !a.closed && a.pluggyName === closed.pluggyName && a.dueDate === closed.dueDate && a.assetClass === closed.assetClass
    );
    const pool = movements.filter((m) => open.some((a) => a.id === m.assetId));
    for (const m of movements.filter((x) => x.assetId === closed.id)) {
      const i = pool.findIndex((x) => x.type === m.type && x.date === m.date && x.amount === m.amount && x.quantity === m.quantity);
      if (i < 0) continue;
      pool.splice(i, 1);
      setAsideMovement(ledger, m);
    }
  }
}

/**
 * Up to 1.7.1 a fund's, FII's or stock's own name (its issuer) could become its institution,
 * and from there spread to the whole connection with "apply to the connection". A broker
 * is never named like one of those products, so such an institution goes back to sync.
 */
function forgetProductInstitutions(ledger: Ledger) {
  const assets = ledger.investments.assets;
  const products = new Set(assets.filter((a) => a.issuer && a.assetClass !== "fixed_income").map((a) => a.issuer!.trim()));
  for (const a of assets) {
    if (!a.pluggyId || !a.institution || !products.has(a.institution.trim())) continue;
    delete a.institution;
    delete a.institutionEdited;
  }
}

/**
 * Items whose report is older than what the ledger already has: even the newest
 * reference date sent is before the newest one of the item's open positions.
 * Pluggy has served such a report with every position zeroed and under new ids,
 * which would close the whole portfolio. Item id → the report's date.
 */
function staleItems(ledger: Ledger, investments: PluggyInvestment[], today: string): Map<string, string> {
  const reported = new Map<string, string>();
  for (const p of investments) {
    // same fallback as apply(), so a position without a date counts as today's
    const date = p.date?.slice(0, 10) || today;
    if (date > (reported.get(p.itemId) ?? "")) reported.set(p.itemId, date);
  }
  const stale = new Map<string, string>();
  for (const [item, date] of reported) {
    // a frozen position's date is Trimly's own pricing, not the bank's
    const known = ledger.investments.assets.some((a) => a.pluggyId && !a.closed && !a.missingSince && a.pluggyItemId === item && a.updatedAt > date);
    if (known) stale.set(item, date);
  }
  return stale;
}

/**
 * The position put back by hand (from B3's position report) after the bank had closed it,
 * for a product the bank reports again with a value. Manual but still tied to its
 * connection (`pluggyItemId`), which no other manual position is.
 */
function restoredTwin(assets: Asset[], p: PluggyInvestment): Asset | undefined {
  if (p.status === "TOTAL_WITHDRAWAL" || !(p.balance > 0)) return undefined;
  const due = p.dueDate?.slice(0, 10);
  const code = p.code?.trim().toUpperCase();
  return assets.find(
    (a) =>
      !a.pluggyId &&
      !a.closed &&
      a.pluggyItemId === p.itemId &&
      a.assetClass === assetClass(p) &&
      ((!!code && a.code?.toUpperCase() === code) || (!!a.dueDate && a.dueDate === due && a.name === displayName(p)))
  );
}

/**
 * The restored position becomes synced again under `p`'s id, instead of the bank's
 * position arriving as a second one. The bank may report it under an id it already used
 * for a zeroed copy, closed then and reopened by now: that copy gives its movements to the
 * restored position, which carries the history, and goes. Returns the copy's value that
 * counted as money in, now leaving with it. Mutates the ledger.
 */
function adopt(ledger: Ledger, restored: Asset, p: PluggyInvestment, copy: Asset | undefined): number {
  restored.pluggyId = p.id;
  if (!copy) return 0;
  const inv = ledger.investments;
  for (const m of [...inv.movements, ...inv.dismissedMovements]) if (m.assetId === copy.id) m.assetId = restored.id;
  inv.assets = inv.assets.filter((a) => a.id !== copy.id);
  return copy.closed ? 0 : copy.value;
}

/**
 * Keep `asset` open at its last value when the bank says it ended without proof. Returns
 * whether it was held; counts it in `result` the first time. Mutates the asset.
 */
function hold(ledger: Ledger, asset: Asset, today: string, result: InvestmentSyncResult): boolean {
  if (!HELD_UNTIL_PROVEN.includes(asset.assetClass)) return false;
  if (provenGone(asset, ledger.investments.movements.filter((m) => m.assetId === asset.id), today)) return false;
  if (!asset.missingSince) {
    asset.missingSince = today;
    result.held++;
  }
  return true;
}

/**
 * Upsert the positions of the items in `itemIds` and their movements, and close
 * the positions those items no longer report. Positions of other items and
 * manual ones are left alone, and so are those of an item whose report is older
 * than the ledger's. Records today's snapshot with the flows since the
 * previous day's one. Mutates the ledger.
 */
export function applyInvestments(ledger: Ledger, investments: PluggyInvestment[], itemIds: string[], today: string): InvestmentSyncResult {
  const result: InvestmentSyncResult = { added: 0, updated: 0, closed: 0, movements: 0, stale: [], held: 0 };
  const stale = staleItems(ledger, investments, today);
  if (stale.size) {
    result.stale = [...stale.values()];
    investments = investments.filter((p) => !stale.has(p.itemId));
    itemIds = itemIds.filter((i) => !stale.has(i));
  }
  const since = flowWindowStart(ledger, today);
  // money moved that the positions' movements don't explain
  let untracked = 0;

  // an item is one bank connection: the institution most of its positions report
  const itemInstitution = new Map<string, string>();
  const counts = new Map<string, Map<string, number>>();
  for (const p of investments) {
    const name = p.institution?.name?.trim();
    if (!name) continue;
    const byName = counts.get(p.itemId) ?? new Map<string, number>();
    byName.set(name, (byName.get(name) ?? 0) + 1);
    counts.set(p.itemId, byName);
  }
  for (const [item, byName] of counts) itemInstitution.set(item, [...byName.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  forgetProductInstitutions(ledger);

  const seen = new Set<string>();
  for (const p of investments) {
    seen.add(p.id);
    let asset = ledger.investments.assets.find((a) => a.pluggyId === p.id);
    const restored = restoredTwin(ledger.investments.assets, p);
    if (restored) {
      const gone = adopt(ledger, restored, p, asset);
      if (since !== undefined) untracked -= gone;
      asset = restored;
    }
    const assets = ledger.investments.assets;
    if (asset && !asset.closed && (p.status === "TOTAL_WITHDRAWAL" || !(p.balance > 0))) {
      if (p.transactions) result.movements += mergeMovements(ledger, asset, p.transactions);
      if (hold(ledger, asset, today, result)) continue;
    }
    const before = asset ? { value: asset.value, invested: asset.invested, closed: asset.closed } : { value: 0, invested: 0 };
    const newlyTracked = !asset || !!asset.closed;
    if (!asset) {
      asset = { id: newId(), name: displayName(p), assetClass: assetClass(p), value: 0, updatedAt: today, pluggyId: p.id, pluggyItemId: p.itemId };
      apply(asset, p, today, itemInstitution.get(p.itemId));
      assets.push(asset);
      result.added++;
    } else if (apply(asset, p, today, itemInstitution.get(p.itemId))) {
      result.updated++;
    }
    if (p.transactions) result.movements += mergeMovements(ledger, asset, p.transactions);
    setAsideSettlementRepeats(ledger, asset);
    asset.movementsSynced = !!p.transactions;
    if (newlyTracked) {
      asset.addedOn = today;
      // e.g. a bank linked later: its old purchases are outside the window, so its value arrives as money in, not gain
      if (since !== undefined && !asset.closed) untracked += asset.value;
    } else if (!p.transactions && since !== undefined && !(before.invested === undefined && asset.invested !== undefined)) {
      // a cost becoming known isn't money moved
      untracked += estimatedFlow(before, asset);
    }
  }
  for (const a of ledger.investments.assets) {
    if (!a.pluggyId || a.closed || seen.has(a.pluggyId) || !itemIds.includes(a.pluggyItemId ?? "")) continue;
    if (hold(ledger, a, today, result)) continue;
    const before = { value: a.value, invested: a.invested };
    a.closed = true;
    result.closed++;
    // gone without a word: assume it was withdrawn at its last value
    if (since !== undefined) untracked += estimatedFlow(before, a);
  }
  setAsideClosedTwins(ledger);
  recordSnapshot(ledger, today, untracked);
  return result;
}
