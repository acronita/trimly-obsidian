/**
 * Investment history from a spreadsheet: the B3 investor area's statements or any
 * broker's, recognized by the names of their columns. It fills in what banks don't
 * report, above all what shares cost. History only: a position's value and quantity
 * stay what the bank or the user says.
 *
 * Kept free of Obsidian imports so it can be unit tested in Node.
 */
import { taxKind, taxPosition } from "./income-tax.ts";
import { IMPORT_PREFIX, newId, recordSnapshot } from "./ledger.ts";
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

type Trade = Pick<Movement, "date" | "type" | "amount" | "quantity">;

/** Whether two records describe one trade. Amounts can't decide it: a bank reports them with fees, a statement without. */
export function isSameTrade(a: Trade, b: Trade): boolean {
  if (a.type !== b.type || days(a.date, b.date) > SAME_TRADE_DAYS) return false;
  if (a.type === "income") return Math.abs(a.amount - b.amount) <= 1;
  if (a.quantity && b.quantity) return Math.abs(a.quantity - b.quantity) < 1e-6;
  // no quantity to compare: the amount, allowing for fees
  return Math.abs(a.amount - b.amount) <= Math.max(a.amount, b.amount) * 0.01;
}

/** What importing would do. Each movement already recorded answers for one row only, so importing twice adds nothing and two equal trades both count. */
export function previewImport(ledger: Ledger, sheets: Rows[]): ImportPreview | null {
  const parsed = sheets.map(parseStatement).filter((p): p is ParsedSheet => p !== null);
  if (parsed.length === 0) return null;
  const out: ImportPreview = { trades: [], duplicates: 0, unmatched: [], skipped: {} };
  const unmatched = new Set<string>();
  // a movement the user deleted is still recorded: importing the same file must not bring it back
  const pool = [...ledger.investments.movements, ...ledger.investments.dismissedMovements];
  for (const sheet of parsed) {
    for (const [label, n] of Object.entries(sheet.skipped)) out.skipped[label] = (out.skipped[label] ?? 0) + n;
    // only other sheets can repeat a row: two equal rows in one sheet are two trades
    const added: Movement[] = [];
    for (const trade of sheet.trades) {
      // a bank can report one ticker as more than one position, and the trade may be in any of them
      const held = ledger.investments.assets.filter((a) => tickerOf(a) === trade.ticker);
      const asset = held.find((a) => !a.closed) ?? held[0];
      if (!asset) {
        unmatched.add(trade.ticker);
        continue;
      }
      const same = pool.findIndex((m) => held.some((a) => a.id === m.assetId) && isSameTrade(m, trade));
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

/**
 * Take a bank or spreadsheet movement out, remembering it so sync and import don't
 * bring it back. The position's value stays what the bank says. Mutates the ledger.
 */
export function setAsideMovement(ledger: Ledger, m: Movement) {
  const { movements, dismissedMovements, assets } = ledger.investments;
  movements.splice(movements.indexOf(m), 1);
  dismissedMovements.push(m);
  // a repeat keeps a statement's trades from adding up to what is held, and so from giving the cost
  const asset = assets.find((a) => a.id === m.assetId);
  if (asset && movements.some((x) => x.assetId === asset.id && x.pluggyId?.startsWith(IMPORT_PREFIX))) setCostFromTrades(ledger, asset);
}

/** Longest gap expected between a trade's own date and the date another source gives it. */
const SETTLEMENT_DAYS = 5;

/**
 * One purchase can be recorded twice on different days: by the fills of the trade
 * day and as one settlement days later, so rows can't be paired one by one. Two
 * close days with the same totals are that repeat, but only if the trades add up to
 * more shares than the position holds; otherwise they are real, equal purchases.
 * All the repeats go or none do. A spreadsheet day gives way to a bank's, and
 * otherwise the later day goes, since the trade day is the one tax needs. Mutates the ledger.
 */
export function setAsideSettlementRepeats(ledger: Ledger, asset: Asset) {
  if (asset.quantity === undefined) return;
  const own = ledger.investments.movements.filter((m) => m.assetId === asset.id);
  const netShares = (rows: Movement[]) => rows.reduce((s, m) => s + (m.type === "buy" ? 1 : m.type === "sell" ? -1 : 0) * (m.quantity ?? 0), 0);
  const surplus = netShares(own) - asset.quantity;
  if (surplus <= 1e-6) return;
  const sum = (rows: Movement[], value: (m: Movement) => number) => rows.reduce((s, m) => s + value(m), 0);
  const sameTotals = (a: Movement[], b: Movement[]) => {
    const shares = sum(a, (m) => m.quantity ?? 0);
    const amount = sum(a, (m) => m.amount);
    return shares > 0 && Math.abs(shares - sum(b, (m) => m.quantity ?? 0)) < 1e-6 && Math.abs(amount - sum(b, (m) => m.amount)) <= amount * 0.01;
  };
  const fromSheet = (rows: Movement[]) => rows.every((m) => m.pluggyId?.startsWith(IMPORT_PREFIX));
  const repeats: Movement[] = [];
  for (const type of ["buy", "sell"] as const) {
    const byDay = new Map<string, Movement[]>();
    for (const m of own) if (m.type === type && m.pluggyId) byDay.set(m.date, [...(byDay.get(m.date) ?? []), m]);
    const dates = [...byDay.keys()].sort();
    const paired = new Set<string>();
    for (const first of dates) {
      if (paired.has(first)) continue;
      const a = byDay.get(first) as Movement[];
      const second = dates.find((d) => d > first && !paired.has(d) && days(first, d) <= SETTLEMENT_DAYS && sameTotals(a, byDay.get(d) as Movement[]));
      if (!second) continue;
      paired.add(first).add(second);
      const b = byDay.get(second) as Movement[];
      repeats.push(...(fromSheet(a) && !fromSheet(b) ? a : b));
    }
  }
  if (repeats.length && netShares(repeats) <= surplus + 1e-6) for (const m of repeats) setAsideMovement(ledger, m);
}

/** Delete a bank or spreadsheet movement at the user's request. Manual ones go through `removeManualMovement`, which also undoes their effect. */
export function dismissMovement(ledger: Ledger, id: string, today: string) {
  const m = ledger.investments.movements.find((x) => x.id === id);
  if (!m?.pluggyId) return;
  setAsideMovement(ledger, m);
  recordSnapshot(ledger, today);
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
  for (const a of ledger.investments.assets) {
    if (!touched.has(a.id)) continue;
    setAsideSettlementRepeats(ledger, a);
    setCostFromTrades(ledger, a);
  }
}
