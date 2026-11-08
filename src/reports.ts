/**
 * Reports over any period: income and expense totals, by category, by account and
 * over time, against the period before or the same period a year earlier. Same
 * counting as the overview: transfers move money between own accounts and are out,
 * and everything is in the settings' currency. Nothing here is stored.
 *
 * Kept free of Obsidian imports so it can be unit tested in Node.
 */
import { baseAmount, shiftMonth } from "./ledger.ts";
import type { Ledger, Transaction } from "./ledger.ts";

export interface ReportRange {
  /** first and last day, inclusive */
  from: string;
  to: string;
}

export interface ReportFilter extends ReportRange {
  /** limit to one account; empty = all */
  accountId?: string;
  /** limit to one category, "" for the uncategorized; missing or "all" = every category */
  categoryId?: string;
}

export interface ReportTotals {
  income: number;
  expense: number;
}

export interface Report extends ReportTotals {
  /** by category id, "" for uncategorized */
  expenseByCategory: Map<string, number>;
  incomeByCategory: Map<string, number>;
  byAccount: Map<string, ReportTotals>;
  /** by month ("YYYY-MM") with movement, or by year ("YYYY") */
  series: Map<string, ReportTotals>;
}

export type ReportPreset = "thisMonth" | "lastMonth" | "last3Months" | "last12Months" | "thisYear" | "lastYear";
export const REPORT_PRESETS: ReportPreset[] = ["thisMonth", "lastMonth", "last3Months", "last12Months", "thisYear", "lastYear"];

/** A period longer than this is charted by year: more months than this don't fit as bars. */
const MAX_MONTH_BARS = 24;

const pad = (n: number) => String(n).padStart(2, "0");

function lastDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${pad(new Date(y, m, 0).getDate())}`;
}

function isMonthEnd(date: string): boolean {
  return date === lastDay(date.slice(0, 7));
}

/** `date` moved by whole months; a month's last day stays its last day, other days are capped to the month. */
function shiftDate(date: string, months: number): string {
  const month = shiftMonth(date.slice(0, 7), months);
  const end = lastDay(month);
  return isMonthEnd(date) ? end : `${month}-${pad(Math.min(Number(date.slice(8, 10)), Number(end.slice(8, 10))))}`;
}

function shiftDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const out = new Date(y, m - 1, d + days);
  return `${out.getFullYear()}-${pad(out.getMonth() + 1)}-${pad(out.getDate())}`;
}

export function presetRange(preset: ReportPreset, today: string): ReportRange {
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  switch (preset) {
    case "thisMonth":
      return { from: `${month}-01`, to: today };
    case "lastMonth":
      return { from: `${shiftMonth(month, -1)}-01`, to: lastDay(shiftMonth(month, -1)) };
    case "last3Months":
      return { from: `${shiftMonth(month, -2)}-01`, to: today };
    case "last12Months":
      return { from: `${shiftMonth(month, -11)}-01`, to: today };
    case "thisYear":
      return { from: `${year}-01-01`, to: today };
    case "lastYear":
      return { from: `${Number(year) - 1}-01-01`, to: `${Number(year) - 1}-12-31` };
  }
}

/** The same stretch right before: whole months compare with whole months, whatever their lengths; other periods by days. */
export function previousRange({ from, to }: ReportRange): ReportRange {
  if (from.endsWith("-01") && isMonthEnd(to)) {
    const [fy, fm] = from.split("-").map(Number);
    const [ty, tm] = to.split("-").map(Number);
    const months = (ty - fy) * 12 + tm - fm + 1;
    return { from: shiftDate(from, -months), to: shiftDate(to, -months) };
  }
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  return { from: shiftDays(from, -days), to: shiftDays(to, -days) };
}

export function lastYearRange({ from, to }: ReportRange): ReportRange {
  return { from: shiftDate(from, -12), to: shiftDate(to, -12) };
}

function matches(tx: Transaction, f: ReportFilter): boolean {
  if (tx.type === "transfer" || tx.date < f.from || tx.date > f.to) return false;
  if (f.accountId && tx.accountId !== f.accountId) return false;
  return f.categoryId === undefined || f.categoryId === "all" || (tx.categoryId ?? "") === f.categoryId;
}

export function buildReport(ledger: Ledger, f: ReportFilter): Report {
  const [fy, fm] = f.from.split("-").map(Number);
  const [ty, tm] = f.to.split("-").map(Number);
  const byYear = (ty - fy) * 12 + tm - fm + 1 > MAX_MONTH_BARS;
  const out: Report = { income: 0, expense: 0, expenseByCategory: new Map(), incomeByCategory: new Map(), byAccount: new Map(), series: new Map() };
  const add = <K>(map: Map<K, ReportTotals>, key: K, field: keyof ReportTotals, cents: number) => {
    const totals = map.get(key) ?? { income: 0, expense: 0 };
    totals[field] += cents;
    map.set(key, totals);
  };
  for (const tx of ledger.transactions) {
    if (!matches(tx, f)) continue;
    const cents = baseAmount(ledger, tx);
    const field = tx.type === "income" ? "income" : "expense";
    const categories = tx.type === "income" ? out.incomeByCategory : out.expenseByCategory;
    out[field] += cents;
    categories.set(tx.categoryId ?? "", (categories.get(tx.categoryId ?? "") ?? 0) + cents);
    add(out.byAccount, tx.accountId, field, cents);
    add(out.series, tx.date.slice(0, byYear ? 4 : 7), field, cents);
  }
  return out;
}

/** Every bar of a report's period in order, empty months and years included, so gaps show. */
export function seriesKeys(f: ReportRange): string[] {
  const [fy, fm] = f.from.split("-").map(Number);
  const [ty, tm] = f.to.split("-").map(Number);
  const out: string[] = [];
  if ((ty - fy) * 12 + tm - fm + 1 > MAX_MONTH_BARS) {
    for (let y = fy; y <= ty; y++) out.push(String(y));
    return out;
  }
  for (let m = f.from.slice(0, 7); m <= f.to.slice(0, 7); m = shiftMonth(m, 1)) out.push(m);
  return out;
}

/** Change against the comparison, in percent; null when there was nothing to compare with. */
export function changePct(now: number, before: number): number | null {
  return before > 0 ? ((now - before) / before) * 100 : null;
}
