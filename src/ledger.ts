/**
 * Ledger data model and pure finance logic (balances, summaries, recurring).
 *
 * All money values are integer cents to avoid floating-point drift. Dates are
 * local "YYYY-MM-DD" strings; months are "YYYY-MM".
 *
 * Kept free of Obsidian and local imports so it can be unit tested in Node.
 */

export const LEDGER_VERSION = 1;

export type AccountType = "checking" | "savings" | "credit" | "cash" | "investment" | "other";
export type CategoryKind = "expense" | "income";
export type TxType = "expense" | "income" | "transfer";
export type Frequency = "weekly" | "monthly" | "yearly";

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: "Checking",
  savings: "Savings",
  credit: "Credit card",
  cash: "Cash",
  investment: "Investment",
  other: "Other",
};

export const ACCOUNT_TYPE_ICONS: Record<AccountType, string> = {
  checking: "landmark",
  savings: "piggy-bank",
  credit: "credit-card",
  cash: "wallet",
  investment: "trending-up",
  other: "coins",
};

/** Lucide icon names offered for categories. */
export const CATEGORY_ICONS = [
  "home", "shopping-cart", "utensils", "coffee", "car", "fuel", "bus", "plane", "heart-pulse", "pill",
  "zap", "wifi", "smartphone", "clapperboard", "gamepad-2", "music", "shopping-bag", "shirt", "gift",
  "graduation-cap", "book", "baby", "dog", "dumbbell", "wrench", "receipt", "landmark", "briefcase",
  "laptop", "trending-up", "coins", "piggy-bank", "plus-circle", "more-horizontal", "tag",
];

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /** balance before the first transaction, in cents (negative for debt) */
  openingBalance: number;
  archived?: boolean;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  /** Lucide icon name; missing = "tag" */
  icon?: string;
}

export interface Transaction {
  id: string;
  date: string;
  type: TxType;
  /** always positive, in cents; `type` gives the direction */
  amount: number;
  accountId: string;
  /** destination account, transfers only */
  toAccountId?: string;
  /** income/expense only; missing = uncategorized */
  categoryId?: string;
  description: string;
  notes?: string;
  /** set when the transaction was posted by a recurring rule */
  recurringId?: string;
}

export interface Budget {
  categoryId: string;
  /** monthly spending limit, in cents */
  limit: number;
}

export interface Recurring {
  id: string;
  description: string;
  type: TxType;
  amount: number;
  accountId: string;
  toAccountId?: string;
  categoryId?: string;
  frequency: Frequency;
  /** first occurrence; its day of month anchors monthly/yearly rules */
  startDate: string;
  /** next occurrence not yet posted */
  nextDate: string;
  /** last allowed occurrence (inclusive), optional */
  endDate?: string;
}

export interface Ledger {
  version: number;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  recurring: Recurring[];
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const DEFAULT_CATEGORIES: [string, CategoryKind, string, string][] = [
  ["Housing", "expense", "#8e7cc3", "home"],
  ["Groceries", "expense", "#6aa84f", "shopping-cart"],
  ["Dining out", "expense", "#e69138", "utensils"],
  ["Transport", "expense", "#3d85c6", "car"],
  ["Health", "expense", "#cc4125", "heart-pulse"],
  ["Utilities", "expense", "#45818e", "zap"],
  ["Entertainment", "expense", "#c27ba0", "clapperboard"],
  ["Shopping", "expense", "#f1c232", "shopping-bag"],
  ["Education", "expense", "#674ea7", "graduation-cap"],
  ["Other expenses", "expense", "#999999", "more-horizontal"],
  ["Salary", "income", "#38761d", "briefcase"],
  ["Freelance", "income", "#0b5394", "laptop"],
  ["Investments", "income", "#134f5c", "trending-up"],
  ["Other income", "income", "#666666", "plus-circle"],
];

export function defaultLedger(): Ledger {
  return {
    version: LEDGER_VERSION,
    accounts: [{ id: newId(), name: "Wallet", type: "cash", openingBalance: 0 }],
    categories: DEFAULT_CATEGORIES.map(([name, kind, color, icon]) => ({ id: newId(), name, kind, color, icon })),
    transactions: [],
    budgets: [],
    recurring: [],
  };
}

/** Parse decrypted JSON into a ledger, filling any missing collections. */
export function parseLedger(json: string): Ledger {
  const raw = JSON.parse(json) as Partial<Ledger>;
  if (typeof raw.version === "number" && raw.version > LEDGER_VERSION) {
    throw new Error(`Ledger version ${raw.version} is newer than this plugin supports; update Trimly`);
  }
  const categories = raw.categories ?? [];
  // ledgers created before category icons existed: give default categories their icon
  for (const c of categories) {
    if (!c.icon) c.icon = DEFAULT_CATEGORIES.find(([name, kind]) => name === c.name && kind === c.kind)?.[3];
  }
  return {
    version: LEDGER_VERSION,
    accounts: raw.accounts ?? [],
    categories,
    transactions: raw.transactions ?? [],
    budgets: raw.budgets ?? [],
    recurring: raw.recurring ?? [],
  };
}

// ---- money ----

/**
 * Parse user input like "1234.56", "1.234,56", "1,234.56" or "12,5" into cents.
 * The last "." or "," is the decimal separator when followed by 1-2 digits;
 * other separators are thousands groupings. Returns null when not a number.
 */
export function parseAmount(input: string): number | null {
  const s = input.trim().replace(/\s/g, "").replace(/^[^\d\-.,]+/, "");
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  const lastSep = Math.max(body.lastIndexOf("."), body.lastIndexOf(","));
  let intPart = body;
  let fracPart = "";
  if (lastSep >= 0 && body.length - lastSep - 1 <= 2) {
    intPart = body.slice(0, lastSep);
    fracPart = body.slice(lastSep + 1);
  }
  intPart = intPart.replace(/[.,]/g, "");
  if (intPart === "" && fracPart === "") return null;
  const cents = Number(intPart || "0") * 100 + Number(fracPart.padEnd(2, "0") || "0");
  if (!Number.isFinite(cents)) return null;
  return neg ? -cents : cents;
}

const CURRENCY_LOCALES: Record<string, string> = {
  BRL: "pt-BR",
  USD: "en-US",
  EUR: "de-DE",
  GBP: "en-GB",
  JPY: "ja-JP",
  CAD: "en-CA",
  AUD: "en-AU",
  ARS: "es-AR",
  MXN: "es-MX",
  CHF: "de-CH",
};

/** Number format that people using `currency` expect (R$ 1.234,56 for BRL), falling back to `fallback`. */
export function localeForCurrency(currency: string, fallback?: string): string | undefined {
  return CURRENCY_LOCALES[currency] ?? fallback;
}

export function formatMoney(cents: number, currency: string, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** Cents as a plain editable string, e.g. 123456 -> "1234.56". */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

// ---- dates ----

export function todayISO(now = new Date()): string {
  return toISODate(now);
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(y: number, m0: number): number {
  return new Date(y, m0 + 1, 0).getDate();
}

/** Occurrence after `date` for a rule anchored on `anchorDay` (day of month of startDate). */
export function nextOccurrence(date: string, frequency: Frequency, anchorDay: number): string {
  const [y, m, d] = date.split("-").map(Number);
  if (frequency === "weekly") return toISODate(new Date(y, m - 1, d + 7));
  const months = frequency === "monthly" ? 1 : 12;
  const target = new Date(y, m - 1 + months, 1);
  const day = Math.min(anchorDay, daysInMonth(target.getFullYear(), target.getMonth()));
  return toISODate(new Date(target.getFullYear(), target.getMonth(), day));
}

// ---- computations ----

/** Signed effect of a transaction on one account, in cents. */
export function effectOn(tx: Transaction, accountId: string): number {
  let v = 0;
  if (tx.accountId === accountId) v += tx.type === "income" ? tx.amount : -tx.amount;
  if (tx.type === "transfer" && tx.toAccountId === accountId) v += tx.amount;
  return v;
}

/** Account balance including every transaction up to `upTo` (inclusive), or all when omitted. */
export function accountBalance(ledger: Ledger, accountId: string, upTo?: string): number {
  const acc = ledger.accounts.find((a) => a.id === accountId);
  let bal = acc?.openingBalance ?? 0;
  for (const tx of ledger.transactions) {
    if (upTo && tx.date > upTo) continue;
    bal += effectOn(tx, accountId);
  }
  return bal;
}

export function netWorth(ledger: Ledger, upTo?: string): number {
  return ledger.accounts.reduce((sum, a) => sum + accountBalance(ledger, a.id, upTo), 0);
}

export interface MonthSummary {
  income: number;
  expense: number;
  net: number;
}

/** Income/expense totals for a month. Transfers move money between own accounts and are excluded. */
export function monthSummary(ledger: Ledger, month: string): MonthSummary {
  let income = 0;
  let expense = 0;
  for (const tx of ledger.transactions) {
    if (monthOf(tx.date) !== month) continue;
    if (tx.type === "income") income += tx.amount;
    else if (tx.type === "expense") expense += tx.amount;
  }
  return { income, expense, net: income - expense };
}

/** Income and expense totals for the `count` months ending at `lastMonth`, oldest first. */
export function monthlyHistory(ledger: Ledger, lastMonth: string, count: number): ({ month: string } & MonthSummary)[] {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const month = shiftMonth(lastMonth, -i);
    out.push({ month, ...monthSummary(ledger, month) });
  }
  return out;
}

/** Recurring occurrences due between `from` and `to` (inclusive), soonest first. */
export function upcomingRecurring(ledger: Ledger, from: string, to: string): Recurring[] {
  return ledger.recurring
    .filter((r) => r.nextDate >= from && r.nextDate <= to && !(r.endDate && r.nextDate > r.endDate))
    .sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1));
}

/** Expense total per category id for a month; uncategorized expenses use the key "". */
export function spendingByCategory(ledger: Ledger, month: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const tx of ledger.transactions) {
    if (tx.type !== "expense" || monthOf(tx.date) !== month) continue;
    const key = tx.categoryId ?? "";
    out.set(key, (out.get(key) ?? 0) + tx.amount);
  }
  return out;
}

/** Newest first; ties broken by id so the order is stable. */
export function sortTransactions(txs: Transaction[]): Transaction[] {
  return [...txs].sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
}

/**
 * Post every recurring occurrence due on or before `today`, advancing each
 * rule's nextDate. Mutates the ledger; returns how many transactions were added.
 */
export function postDueRecurring(ledger: Ledger, today: string): number {
  let posted = 0;
  for (const r of ledger.recurring) {
    const anchorDay = Number(r.startDate.slice(8, 10));
    // guard against a corrupted rule looping forever
    for (let i = 0; i < 1000 && r.nextDate <= today; i++) {
      if (r.endDate && r.nextDate > r.endDate) break;
      ledger.transactions.push({
        id: newId(),
        date: r.nextDate,
        type: r.type,
        amount: r.amount,
        accountId: r.accountId,
        toAccountId: r.type === "transfer" ? r.toAccountId : undefined,
        categoryId: r.type === "transfer" ? undefined : r.categoryId,
        description: r.description,
        recurringId: r.id,
      });
      posted++;
      r.nextDate = nextOccurrence(r.nextDate, r.frequency, anchorDay);
    }
  }
  return posted;
}

/** Drop references to a deleted category so transactions show as uncategorized. */
export function removeCategory(ledger: Ledger, categoryId: string) {
  ledger.categories = ledger.categories.filter((c) => c.id !== categoryId);
  ledger.budgets = ledger.budgets.filter((b) => b.categoryId !== categoryId);
  for (const tx of ledger.transactions) if (tx.categoryId === categoryId) delete tx.categoryId;
  for (const r of ledger.recurring) if (r.categoryId === categoryId) delete r.categoryId;
}

export function accountInUse(ledger: Ledger, accountId: string): boolean {
  return (
    ledger.transactions.some((t) => t.accountId === accountId || t.toAccountId === accountId) ||
    ledger.recurring.some((r) => r.accountId === accountId || r.toAccountId === accountId)
  );
}
