/**
 * Investment history from a spreadsheet: the B3 investor area's statements or any
 * broker's, recognized by the names of their columns. It fills in what banks don't
 * report, above all what shares cost. History only: a position's value and quantity
 * stay what the bank or the user says.
 *
 * Kept free of Obsidian imports so it can be unit tested in Node.
 */
import { taxKind, taxPosition } from "./income-tax.ts";
import { IMPORT_PREFIX, newId } from "./ledger.ts";
import type { Asset, Ledger, Movement, MovementType } from "./ledger.ts";
import { tickerOf } from "./quotes.ts";
import type { Rows } from "./spreadsheet.ts";

export interface ImportedTrade {
  date: string;
  type: Extract<MovementType, "buy" | "sell" | "income">;
  ticker: string;
  quantity?: number;
  amount: number;
}

export interface ImportPreview {
  /** what would be added */
  trades: (ImportedTrade & { assetId: string })[];
  /** rows already recorded */
  duplicates: number;
  /** tickers with rows but no position to put them in */
  unmatched: string[];
  /** rows not imported, by what they were: splits, bonus shares, transfers between brokers */
  skipped: Record<string, number>;
}

const COLUMNS = {
  date: ["data do negocio", "data", "data da operacao", "data de negociacao", "data do pregao", "data pregao"],
  side: ["tipo de movimentacao", "compra/venda", "c/v", "operacao", "tipo de operacao", "natureza", "tipo"],
  flow: ["entrada/saida"],
  event: ["movimentacao", "evento"],
  ticker: ["codigo de negociacao", "ticker", "codigo", "codigo do ativo", "ativo", "papel", "produto"],
  quantity: ["quantidade", "qtd", "qtde"],
  price: ["preco", "preco unitario", "valor unitario", "preco de compra"],
  value: ["valor", "valor da operacao", "valor total", "total", "financeiro"],
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
  return out.date !== undefined && out.ticker !== undefined && out.quantity !== undefined && (out.side !== undefined || out.event !== undefined) ? out : null;
}

/** "1.234,56", "R$ 97,50", or Excel's own "97.5"; null for "-" and the like. */
export function parseNumber(raw: string | undefined): number | null {
  let s = (raw ?? "").replace(/[^\d.,-]/g, "");
  if (!/\d/.test(s)) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** dd/mm/yyyy, ISO, or the day number Excel stores. */
export function parseDate(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const serial = Number(s);
  // Excel counts days from 1899-12-30
  if (serial > 20_000 && serial < 80_000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
  return null;
}

/** The ticker of a cell, which may be "HGLG11 - CSHG LOGÍSTICA" or the fractional "PETR4F". */
function tickerIn(raw: string | undefined): string | null {
  return (raw ?? "").toUpperCase().match(/\b([A-Z]{4}\d{1,2})F?\b/)?.[1] ?? null;
}

function tradeType(side: string, flow: string, event: string): ImportedTrade["type"] | null {
  for (const text of [side, event]) {
    if (/rendimento|dividendo|juros sobre capital|jcp|provento/.test(text)) return "income";
  }
  if (/^(c|compra)\b/.test(side)) return "buy";
  if (/^(v|venda)\b/.test(side)) return "sell";
  // the investor area's movement statement: the settlement of a trade, in or out of custody
  if (/liquidacao/.test(event)) return /credito|entrada/.test(flow) ? "buy" : /debito|saida/.test(flow) ? "sell" : null;
  return null;
}

export interface ParsedSheet {
  trades: ImportedTrade[];
  skipped: Record<string, number>;
}

/** The trades in a sheet, or null when none of it looks like a statement. */
export function parseStatement(rows: Rows): ParsedSheet | null {
  const headerAt = rows.slice(0, 20).findIndex((r) => findColumns(r));
  if (headerAt < 0) return null;
  const c = findColumns(rows[headerAt]) as Partial<Record<Column, number>>;
  const at = (row: string[], column: Column) => (c[column] === undefined ? "" : (row[c[column] as number] ?? ""));
  const out: ParsedSheet = { trades: [], skipped: {} };
  const skip = (label: string) => (out.skipped[label] = (out.skipped[label] ?? 0) + 1);
  for (const row of rows.slice(headerAt + 1)) {
    if (row.every((cell) => !cell.trim())) continue;
    const date = parseDate(at(row, "date"));
    const label = (at(row, "event") || at(row, "side")).trim();
    if (!date) {
      // totals and notes under the table
      continue;
    }
    const type = tradeType(normalized(at(row, "side")), normalized(at(row, "flow")), normalized(at(row, "event")));
    const ticker = tickerIn(at(row, "ticker"));
    if (!type || !ticker) {
      skip(label || at(row, "ticker").trim());
      continue;
    }
    const quantity = parseNumber(at(row, "quantity")) ?? undefined;
    const value = parseNumber(at(row, "value"));
    const price = parseNumber(at(row, "price"));
    const amount = value ?? (price !== null && quantity ? price * quantity : null);
    if (!amount || (type !== "income" && !quantity)) {
      skip(label);
      continue;
    }
    out.trades.push({ date, type, ticker, amount: Math.round(Math.abs(amount) * 100), ...(quantity ? { quantity: Math.abs(quantity) } : {}) });
  }
  return out;
}

const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/** A statement dates a trade and its settlement apart, and a bank may report either. */
const SAME_TRADE_DAYS = 3;

function isSame(m: Movement, trade: ImportedTrade): boolean {
  if (m.type !== trade.type || days(m.date, trade.date) > SAME_TRADE_DAYS) return false;
  return trade.type === "income" ? Math.abs(m.amount - trade.amount) <= 1 : m.quantity === trade.quantity;
}

/** What importing would do. Each movement already recorded answers for one row only, so importing twice adds nothing and two equal trades both count. */
export function previewImport(ledger: Ledger, sheets: Rows[]): ImportPreview | null {
  const parsed = sheets.map(parseStatement).filter((p): p is ParsedSheet => p !== null);
  if (parsed.length === 0) return null;
  const out: ImportPreview = { trades: [], duplicates: 0, unmatched: [], skipped: {} };
  const unmatched = new Set<string>();
  const pool = [...ledger.investments.movements];
  for (const sheet of parsed) {
    for (const [label, n] of Object.entries(sheet.skipped)) out.skipped[label] = (out.skipped[label] ?? 0) + n;
    // only other sheets can repeat a row: two equal rows in one sheet are two trades
    const added: Movement[] = [];
    for (const trade of sheet.trades) {
      const asset = ledger.investments.assets.find((a) => tickerOf(a) === trade.ticker);
      if (!asset) {
        unmatched.add(trade.ticker);
        continue;
      }
      const same = pool.findIndex((m) => m.assetId === asset.id && isSame(m, trade));
      if (same >= 0) {
        pool.splice(same, 1);
        out.duplicates++;
      } else {
        out.trades.push({ ...trade, assetId: asset.id });
        added.push({ id: "", assetId: asset.id, date: trade.date, type: trade.type, amount: trade.amount, quantity: trade.quantity });
      }
    }
    pool.push(...added);
  }
  out.unmatched = [...unmatched].sort();
  return out;
}

/** Whole history known for a synced position: what it cost follows from the trades, better than any estimate. */
function setCostFromTrades(ledger: Ledger, asset: Asset) {
  const kind = taxKind(asset);
  if (!kind || !asset.pluggyId) return;
  const p = taxPosition(asset, kind, ledger.investments.movements);
  const uncertain = p.issues.some((i) => i === "missingCost" || i === "missingHistory" || i === "missingQuantity" || i === "transfer");
  if (uncertain || p.heldBefore > 1e-6 || p.quantity <= 0) return;
  asset.invested = p.cost;
  asset.costEdited = true;
}

/** Add what the preview found. Mutates the ledger. */
export function applyImport(ledger: Ledger, preview: ImportPreview) {
  const touched = new Set<string>();
  for (const trade of preview.trades) {
    const m: Movement = { id: newId(), assetId: trade.assetId, date: trade.date, type: trade.type, amount: trade.amount, pluggyId: `${IMPORT_PREFIX}${newId()}` };
    if (trade.quantity) m.quantity = trade.quantity;
    ledger.investments.movements.push(m);
    touched.add(trade.assetId);
  }
  for (const a of ledger.investments.assets) if (touched.has(a.id)) setCostFromTrades(ledger, a);
}
