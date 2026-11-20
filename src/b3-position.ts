/**
 * Positions from the B3 investor area's position report (*Posição*): what is held
 * today, by ticker, Tesouro Direto bond or fixed income product. Restores positions a
 * bank sync zeroed or closed by mistake: it sets their value and quantity and reopens
 * them. A position the bank still reports with a value is the bank's and is left
 * alone. Rows with no position in the ledger are only listed.
 *
 * Kept free of Obsidian imports so it can be unit tested in Node.
 */
import { parseDate, parseNumber } from "./investment-import.ts";
import { saveAsset } from "./ledger.ts";
import type { Asset, Ledger } from "./ledger.ts";
import { tickerOf } from "./quotes.ts";
import type { Rows } from "./spreadsheet.ts";

export interface HeldPosition {
  kind: "ticker" | "treasury" | "fixed_income";
  /** B3's product name ("Tesouro Selic 2027", "CDB - BANCO X") */
  name: string;
  ticker?: string;
  isin?: string;
  issuer?: string;
  dueDate?: string;
  quantity?: number;
  /** cents, net when B3 gives it */
  value: number;
  grossValue?: number;
  invested?: number;
}

export interface PositionPreview {
  /** the report's date: the value's reference date */
  date: string;
  restores: { assetId: string; name: string; value: number; quantity?: number; reopens: boolean; grossValue?: number; invested?: number }[];
  /** held per B3 but with no position in the ledger to restore */
  unmatched: string[];
}

const COLUMNS = {
  product: ["produto"],
  ticker: ["codigo de negociacao"],
  isin: ["codigo isin / distribuicao", "codigo isin", "isin"],
  issuer: ["emissor"],
  dueDate: ["vencimento", "data de vencimento"],
  quantity: ["quantidade"],
  // net first: it is what a synced position's value means
  value: ["valor liquido", "valor atualizado", "valor atualizado curva", "valor atualizado mtm"],
  gross: ["valor bruto"],
  invested: ["valor aplicado"],
};
type Column = keyof typeof COLUMNS;

const normalized = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");

function findColumns(header: string[]): Partial<Record<Column, number>> | null {
  const cells = header.map(normalized);
  const out: Partial<Record<Column, number>> = {};
  for (const [column, names] of Object.entries(COLUMNS) as [Column, string[]][]) {
    for (const name of names) {
      const i = cells.indexOf(name);
      if (i >= 0) {
        out[column] = i;
        break;
      }
    }
  }
  // a statement of movements has a date column; a position report doesn't
  const isStatement = cells.some((c) => c.startsWith("data do") || c === "data" || c === "entrada/saida");
  return out.product !== undefined && out.value !== undefined && !isStatement ? out : null;
}

const cents = (n: number | null) => (n === null ? undefined : Math.round(n * 100));

/** Each sheet's rows as positions; the total rows B3 adds at the bottom are left out. */
export function parsePositions(sheets: Rows[]): HeldPosition[] | null {
  let recognized = false;
  const out: HeldPosition[] = [];
  for (const rows of sheets) {
    const at = rows.findIndex((r) => findColumns(r));
    if (at < 0) continue;
    recognized = true;
    const col = findColumns(rows[at])!;
    for (const r of rows.slice(at + 1)) {
      const cell = (c: Column) => (col[c] === undefined ? "" : (r[col[c]!] ?? "").trim());
      const name = cell("product");
      const value = cents(parseNumber(cell("value")));
      if (!name || normalized(name).startsWith("total") || value === undefined) continue;
      const ticker = cell("ticker").toUpperCase() || undefined;
      const isin = cell("isin").toUpperCase() || undefined;
      const dueDate = parseDate(cell("dueDate")) ?? undefined;
      const kind = ticker ? "ticker" : /tesouro/i.test(name) || isin?.startsWith("BRSTN") ? "treasury" : dueDate ? "fixed_income" : null;
      if (!kind) continue;
      const p: HeldPosition = { kind, name, value };
      if (ticker) p.ticker = ticker;
      if (isin) p.isin = isin;
      if (dueDate) p.dueDate = dueDate;
      if (cell("issuer")) p.issuer = cell("issuer");
      const quantity = parseNumber(cell("quantity"));
      if (quantity !== null) p.quantity = quantity;
      const gross = cents(parseNumber(cell("gross")));
      if (gross !== undefined) p.grossValue = gross;
      const invested = cents(parseNumber(cell("invested")));
      if (invested) p.invested = invested;
      out.push(p);
    }
  }
  return recognized ? merged(out) : null;
}

function keyOf(p: HeldPosition): string {
  return p.ticker ?? p.isin ?? `${normalized(p.issuer ?? p.name)}|${p.dueDate ?? ""}`;
}

/** One position per product: B3 lists one row per broker. */
function merged(list: HeldPosition[]): HeldPosition[] {
  const byKey = new Map<string, HeldPosition>();
  const add = (a?: number, b?: number) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));
  for (const p of list) {
    const k = keyOf(p);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, { ...p });
      continue;
    }
    prev.value += p.value;
    prev.quantity = add(prev.quantity, p.quantity);
    prev.grossValue = add(prev.grossValue, p.grossValue);
    prev.invested = add(prev.invested, p.invested);
  }
  return [...byKey.values()];
}

/** "Tesouro IPCA+ 2035" → "tesouro ipca+": two bonds can share a due date. */
const family = (name: string) => normalized(name).replace(/\s*\d{4}$/, "");

function matches(a: Asset, p: HeldPosition): boolean {
  switch (p.kind) {
    case "ticker":
      return tickerOf(a) === p.ticker || a.name.trim().toUpperCase() === p.ticker;
    case "treasury":
      return (!!p.isin && a.code?.toUpperCase() === p.isin) || (a.assetClass === "treasury" && a.dueDate === p.dueDate && family(a.name) === family(p.name));
    case "fixed_income": {
      if (a.assetClass !== "fixed_income" || a.dueDate !== p.dueDate) return false;
      const word = normalized(p.issuer ?? p.name).split(/[^a-z0-9]+/).find((w) => w.length > 2);
      return !!word && normalized(`${a.issuer ?? ""} ${a.name}`).includes(word);
    }
  }
}

/**
 * The position each held product restores: an open one before a closed one (a sync may
 * have left several copies), then the oldest, which carries the history.
 */
function target(ledger: Ledger, p: HeldPosition, taken: Set<string>): Asset | undefined {
  return ledger.investments.assets
    .filter((a) => !taken.has(a.id) && matches(a, p))
    .sort((x, y) => Number(!!x.closed) - Number(!!y.closed) || (x.addedOn ?? x.updatedAt).localeCompare(y.addedOn ?? y.updatedAt))[0];
}

/** What importing the report would change; positions already matching it are left out. */
export function previewPositions(ledger: Ledger, held: HeldPosition[], date: string): PositionPreview {
  const out: PositionPreview = { date, restores: [], unmatched: [] };
  const taken = new Set<string>();
  for (const p of held) {
    const a = target(ledger, p, taken);
    if (!a) {
      out.unmatched.push(p.ticker ?? p.name);
      continue;
    }
    taken.add(a.id);
    // still reported by the bank: the next sync would put its numbers back anyway
    if (!a.closed && a.value > 0) continue;
    const r: PositionPreview["restores"][number] = { assetId: a.id, name: a.name, value: p.value, reopens: !!a.closed };
    if (p.quantity !== undefined) r.quantity = p.quantity;
    if (p.grossValue !== undefined) r.grossValue = p.grossValue;
    if (p.invested !== undefined) r.invested = p.invested;
    out.restores.push(r);
  }
  return out;
}

/**
 * Set the value and quantity B3 reports and reopen what was closed. A synced position the
 * bank closed becomes manual, or the next sync would close it again: it keeps its
 * connection, so the bank's position takes it back once reported with a value (see
 * `applyInvestments`), and a manual Tesouro bond is priced daily meanwhile. Reopening
 * counts as putting money back, undoing the withdrawal the close counted. Mutates the ledger.
 */
export function applyPositions(ledger: Ledger, preview: PositionPreview, today: string) {
  for (const r of preview.restores) {
    const a = ledger.investments.assets.find((x) => x.id === r.assetId);
    if (!a) continue;
    const next: Asset = { ...a, value: r.value };
    delete next.closed;
    if (r.quantity !== undefined) next.quantity = r.quantity;
    if (r.grossValue !== undefined) next.grossValue = r.grossValue;
    if (r.invested !== undefined && !a.costEdited) next.invested = r.invested;
    if (a.pluggyId && a.closed) {
      delete next.pluggyId;
      delete next.movementsSynced;
    } else if (a.pluggyId) next.updatedAt = preview.date;
    saveAsset(ledger, next, today);
  }
}

/** The report's date in B3's file name ("posicao-2026-11-19-10-30-00.xlsx"), if any. */
export function reportDate(fileName: string): string | null {
  return fileName.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}
