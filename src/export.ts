/**
 * Readable copies of the data, to keep outside the vault: the whole ledger as JSON
 * and tables as CSV. Only builds the text; saving it is up to the caller, which must
 * never write it to the vault (see the encryption rule in CLAUDE.md). Credentials
 * stay out, since a backup gets copied around.
 *
 * Kept free of Obsidian imports so it can be unit tested in Node.
 */
import { t } from "./i18n/index.ts";
import type { Ledger } from "./ledger.ts";

/** Excel in Brazil opens this as columns: semicolons, decimal commas, and a BOM so accents survive. */
const SEPARATOR = ";";
const BOM = "﻿";

/**
 * Text for one cell. Spreadsheets run a cell starting with these as a formula, and
 * descriptions come from banks and stores, so those are kept as text.
 */
export function textCell(value: string | undefined): string {
  const text = value ?? "";
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function moneyCell(cents: number | undefined): string {
  return cents === undefined ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

function numberCell(n: number | undefined): string {
  return n === undefined ? "" : String(n).replace(".", ",");
}

function table(header: string[], rows: string[][]): string {
  return BOM + [header.map(textCell), ...rows].map((r) => r.join(SEPARATOR)).join("\r\n") + "\r\n";
}

const byDate = <T extends { date: string }>(list: T[]) => [...list].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));

/** The whole ledger, without the bank sync credentials and the quotes token. */
export function ledgerJson(ledger: Ledger): string {
  const copy = { ...ledger };
  delete copy.pluggy;
  delete copy.brapi;
  return JSON.stringify(copy, null, 2);
}

export function transactionsCsv(ledger: Ledger, baseCurrency: string): string {
  const e = t.exportFile;
  const account = (id?: string) => ledger.accounts.find((a) => a.id === id);
  return table(
    [e.date, e.type, e.amount, e.currency, e.account, e.toAccount, e.category, e.description, e.notes, e.received],
    byDate(ledger.transactions).map((tx) => [
      tx.date,
      textCell(t.labels.txType[tx.type]),
      moneyCell(tx.amount),
      account(tx.accountId)?.currency ?? baseCurrency,
      textCell(account(tx.accountId)?.name),
      textCell(account(tx.toAccountId)?.name),
      textCell(ledger.categories.find((c) => c.id === tx.categoryId)?.name),
      textCell(tx.description),
      textCell(tx.notes),
      moneyCell(tx.toAmount),
    ])
  );
}

export function positionsCsv(ledger: Ledger): string {
  const e = t.exportFile;
  return table(
    [e.name, e.code, e.assetClass, e.portfolio, e.institution, e.quantity, e.invested, e.value, e.dueDate, e.closed],
    ledger.investments.assets.map((a) => [
      textCell(a.name),
      textCell(a.code),
      textCell(t.labels.assetClass[a.assetClass]),
      textCell(ledger.investments.portfolios?.find((p) => p.id === a.portfolioId)?.name ?? t.portfolios.main),
      textCell(a.institution),
      numberCell(a.quantity),
      moneyCell(a.invested),
      moneyCell(a.value),
      a.dueDate ?? "",
      a.closed ? e.yes : e.no,
    ])
  );
}

export function movementsCsv(ledger: Ledger): string {
  const e = t.exportFile;
  return table(
    [e.date, e.position, e.type, e.amount, e.quantity, e.description],
    byDate(ledger.investments.movements).map((m) => [
      m.date,
      textCell(ledger.investments.assets.find((a) => a.id === m.assetId)?.name),
      textCell(t.labels.movement[m.type]),
      moneyCell(m.amount),
      numberCell(m.quantity),
      textCell(m.description),
    ])
  );
}
