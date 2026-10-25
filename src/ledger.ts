/**
 * Ledger data model and pure finance logic (balances, summaries, recurring, obligations).
 *
 * All money values are integer cents to avoid floating-point drift. Dates are
 * local "YYYY-MM-DD" strings; months are "YYYY-MM".
 *
 * Kept free of Obsidian imports so it can be unit tested in Node.
 */
import { LANGUAGES, t } from "./i18n/index.ts";
import type { Strings } from "./i18n/index.ts";
import { businessDayFrom } from "./business-days.ts";

export const LEDGER_VERSION = 5;

export type AccountType = "checking" | "savings" | "credit" | "cash" | "investment" | "other";
export type CategoryKind = "expense" | "income";
export type TxType = "expense" | "income" | "transfer";
export type Frequency = "weekly" | "monthly" | "yearly";
export type MovementType = "buy" | "sell" | "income" | "tax" | "amortization" | "transfer";
export type AssetClass = "fixed_income" | "treasury" | "stock" | "reit" | "etf" | "fund" | "retirement" | "other";
export type ObligationKind = "payment" | "document";
export type ObligationFrequency = "monthly" | "yearly";

export const ACCOUNT_TYPE_ICONS: Record<AccountType, string> = {
  checking: "landmark",
  savings: "piggy-bank",
  credit: "credit-card",
  cash: "wallet",
  investment: "trending-up",
  other: "coins",
};

export const ASSET_CLASS_COLORS: Record<AssetClass, string> = {
  fixed_income: "#3d85c6",
  treasury: "#0b5394",
  stock: "#6aa84f",
  reit: "#e69138",
  etf: "#45818e",
  fund: "#8e7cc3",
  retirement: "#c27ba0",
  other: "#999999",
};

export const ASSET_CLASS_ICONS: Record<AssetClass, string> = {
  fixed_income: "landmark",
  treasury: "shield",
  stock: "candlestick-chart",
  reit: "building-2",
  etf: "layers",
  fund: "briefcase",
  retirement: "umbrella",
  other: "coins",
};

export const MOVEMENT_ICONS: Record<MovementType, string> = {
  buy: "arrow-down-left",
  sell: "arrow-up-right",
  income: "coins",
  tax: "receipt",
  amortization: "undo-2",
  transfer: "arrow-left-right",
};

/** Lucide icon names offered for categories. */
export const CATEGORY_ICONS = [
  "home", "shopping-cart", "utensils", "coffee", "car", "fuel", "bus", "plane", "heart-pulse", "pill",
  "zap", "wifi", "smartphone", "clapperboard", "gamepad-2", "music", "shopping-bag", "shirt", "gift",
  "graduation-cap", "book", "baby", "dog", "dumbbell", "wrench", "receipt", "landmark", "briefcase",
  "laptop", "trending-up", "coins", "piggy-bank", "plus-circle", "more-horizontal", "tag",
];

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  /** balance before the first transaction, in cents (negative for debt) */
  openingBalance: number;
  archived?: boolean;
  /** Pluggy account this one mirrors; its balance and transactions come from bank sync */
  pluggyId?: string;
  /** credit cards: day of month the bill closes (last day of a cycle); month end when unset */
  closingDay?: number;
  /** credit cards: day of month the closed bill is due */
  dueDay?: number;
  /** credit cards: credit limit, in cents */
  creditLimit?: number;
  /** ISO 4217 code of the account's money; missing = the currency set in the settings */
  currency?: string;
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
  /** Pluggy transaction ids this one was imported from (two for a paired transfer) */
  pluggyIds?: string[];
  /** imported while the bank still listed it as pending */
  pending?: boolean;
  /** made in another currency than the account's (e.g. a card purchase in USD); `amount` is what the account was charged */
  original?: { currency: string; amount: number };
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
  /** a service paid for regularly (streaming, apps, gym); listed apart with its yearly cost */
  subscription?: boolean;
}

/**
 * Something to do by a due date every month or year, by hand: a bill to pay, a
 * tax return to file, an invoice to issue. Unlike a recurring rule it moves no
 * money by itself; each occurrence is marked done (optionally with the
 * transaction that paid it) or skipped. Dates are only days (and a month for
 * yearly ones): every period's occurrence falls in that month or year.
 */
export interface Obligation {
  id: string;
  name: string;
  kind: ObligationKind;
  frequency: ObligationFrequency;
  /** payments: day of month due; documents: day the window to send it opens */
  day: number;
  /** documents: last day of the window, the deadline; unset = `day` */
  endDay?: number;
  /** yearly ones: month of `day`, 1-12 */
  month?: number;
  /** yearly documents: month of `endDay` when the window ends in a later month; unset = `month` */
  endMonth?: number;
  /** first day of the month (or year) it was created in; occurrences due earlier are never open */
  since: string;
  /** stopped: no more occurrences, history kept */
  archived?: boolean;
  /** usual amount, payments only, in cents */
  amount?: number;
  /** remind this many days before the due date */
  remindDays: number;
  notes?: string;
  /** occurrences dealt with */
  settled: Settlement[];
}

export interface Settlement {
  /** due date of the occurrence */
  due: string;
  /** done = paid or issued; skipped = nothing to do that period (no water bill this month) */
  status: "done" | "skipped";
  /**
   * when it was done; for a payment marked on a day banks are closed, the next
   * business day it is scheduled for (later than today until then)
   */
  date: string;
  /** the transaction that paid it, optional */
  transactionId?: string;
}

/** One investment position. Values are the latest known, in cents. */
export interface Asset {
  id: string;
  name: string;
  assetClass: AssetClass;
  /** ticker or product code, e.g. "PETR4" */
  code?: string;
  issuer?: string;
  /** broker or bank holding it */
  institution?: string;
  quantity?: number;
  /** current net value (after taxes and fees) */
  value: number;
  /** current gross value, when known */
  grossValue?: number;
  /** amount originally invested, when known */
  invested?: number;
  /** percentage of the index, e.g. 110 for "110% CDI" */
  rate?: number;
  /** benchmark index, e.g. "CDI", "IPCA" */
  rateType?: string;
  /** fixed annual rate in percent, e.g. 5 for "IPCA + 5%" */
  fixedRate?: number;
  /** maturity date (YYYY-MM-DD) */
  dueDate?: string;
  /** date the value refers to (YYYY-MM-DD) */
  updatedAt: string;
  /** fully withdrawn or no longer reported; kept for history, excluded from totals */
  closed?: boolean;
  /** Pluggy investment this one mirrors, and the item it belongs to */
  pluggyId?: string;
  pluggyItemId?: string;
  /** synced positions: whether the last sync loaded its movements (manual positions always have them) */
  movementsSynced?: boolean;
  /** day Trimly started tracking it (YYYY-MM-DD) */
  addedOn?: string;
  /** synced positions: Pluggy's product subtype (e.g. "CDB") and name as the bank reports it */
  subtype?: string;
  pluggyName?: string;
  /** the user changed the name, so sync stops replacing it */
  renamed?: boolean;
  /** the user set the institution of a synced position, so sync stops replacing it */
  institutionEdited?: boolean;
  /** last brapi quote, for positions with a B3 ticker */
  quote?: Quote;
}

/** Market quote of a ticker. */
export interface Quote {
  /** price per share, in cents */
  price: number;
  /** change today, in percent */
  changePct?: number;
  /** ISO timestamp of the quote */
  time?: string;
  /** company or fund name */
  longName?: string;
  /** 52-week range, cents */
  low52?: number;
  high52?: number;
  /** price/earnings ratio */
  pe?: number;
  /** earnings per share, cents */
  eps?: number;
  /** market value of the company, in currency units */
  marketCap?: number;
  /** logo image URL */
  logo?: string;
  /** daily closes of the last 3 months, oldest first: [YYYY-MM-DD, cents] */
  history?: [string, number][];
}

/** Money moving in or out of one position, in cents. */
export interface Movement {
  id: string;
  assetId: string;
  date: string;
  type: MovementType;
  /** always positive, net of fees; `type` (and `direction` for transfers) gives the direction */
  amount: number;
  quantity?: number;
  description?: string;
  /** transfers only */
  direction?: "in" | "out";
  /** manual withdrawals: cost taken off the position, so deleting the movement can put it back */
  cost?: number;
  pluggyId?: string;
}

/** Portfolio total on one day, recorded whenever positions change. */
export interface PortfolioSnapshot {
  date: string;
  value: number;
  invested: number;
  /**
   * net money put in (+) or taken out (−) since the previous day's snapshot;
   * missing on the first snapshot and on ones recorded before movements existed
   */
  flow?: number;
  /**
   * the part of `flow` that movements don't explain: estimates from changes in
   * amount invested, and positions that started being tracked
   */
  estimated?: number;
  /** dividends, interest and coupons paid out since the previous day's snapshot */
  income?: number;
}

/** Desired share of the portfolio for one asset class. */
export interface AllocationTarget {
  assetClass: AssetClass;
  /** percent, e.g. 40 for 40% */
  pct: number;
}

export interface Investments {
  assets: Asset[];
  /** oldest first, at most one per day */
  snapshots: PortfolioSnapshot[];
  movements: Movement[];
  targets: AllocationTarget[];
}

/** brapi.dev token for quotes. Kept inside the encrypted ledger, never in data.json. */
export interface BrapiConfig {
  token: string;
  /** ISO timestamp of the last successful update */
  lastUpdate?: string;
}

/** Public exchange rates for converting other currencies into `base`, the currency set in the settings. */
export interface FxRates {
  base: string;
  /** day the rates refer to */
  date: string;
  /** day they were fetched, so a weekend's rates are not fetched again */
  fetched: string;
  /** units of each currency per 1 `base` */
  rates: Record<string, number>;
}

/** Bank sync credentials. Kept inside the encrypted ledger, never in data.json. */
export interface PluggyConfig {
  clientId: string;
  clientSecret: string;
  itemIds: string[];
  /** ISO timestamp of the last successful sync */
  lastSync?: string;
}

export interface Ledger {
  version: number;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  recurring: Recurring[];
  obligations: Obligation[];
  investments: Investments;
  /** set when bank sync is configured */
  pluggy?: PluggyConfig;
  /** set when quotes are configured */
  brapi?: BrapiConfig;
  /** exchange rates, set when some account or transaction is in another currency */
  fx?: FxRates;
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export type DefaultCategory = keyof Strings["defaults"]["categories"];

const DEFAULT_CATEGORIES: [DefaultCategory, CategoryKind, string, string][] = [
  ["housing", "expense", "#8e7cc3", "home"],
  ["groceries", "expense", "#6aa84f", "shopping-cart"],
  ["dining", "expense", "#e69138", "utensils"],
  ["transport", "expense", "#3d85c6", "car"],
  ["health", "expense", "#cc4125", "heart-pulse"],
  ["utilities", "expense", "#45818e", "zap"],
  ["entertainment", "expense", "#c27ba0", "clapperboard"],
  ["shopping", "expense", "#f1c232", "shopping-bag"],
  ["education", "expense", "#674ea7", "graduation-cap"],
  ["otherExpenses", "expense", "#999999", "more-horizontal"],
  ["salary", "income", "#38761d", "briefcase"],
  ["freelance", "income", "#0b5394", "laptop"],
  ["investments", "income", "#134f5c", "trending-up"],
  ["otherIncome", "income", "#666666", "plus-circle"],
];

/** Which starter category `c` still is, by its name in any language; undefined once renamed. */
export function defaultCategoryKey(c: Pick<Category, "name" | "kind">): DefaultCategory | undefined {
  return DEFAULT_CATEGORIES.find(
    ([key, kind]) => kind === c.kind && Object.values(LANGUAGES).some((l) => l.defaults.categories[key] === c.name)
  )?.[0];
}

/** Rename the starter categories and account still named as in `from` to their names in `to`. Mutates the ledger. */
export function translateDefaults(ledger: Ledger, from: Strings, to: Strings) {
  for (const c of ledger.categories) {
    const key = DEFAULT_CATEGORIES.find(([k, kind]) => kind === c.kind && from.defaults.categories[k] === c.name)?.[0];
    if (key) c.name = to.defaults.categories[key];
  }
  for (const a of ledger.accounts) if (a.name === from.defaults.wallet) a.name = to.defaults.wallet;
}

export function defaultLedger(): Ledger {
  return {
    version: LEDGER_VERSION,
    accounts: [{ id: newId(), name: t.defaults.wallet, type: "cash", openingBalance: 0 }],
    categories: DEFAULT_CATEGORIES.map(([key, kind, color, icon]) => ({ id: newId(), name: t.defaults.categories[key], kind, color, icon })),
    transactions: [],
    budgets: [],
    recurring: [],
    obligations: [],
    investments: { assets: [], snapshots: [], movements: [], targets: [] },
  };
}

/** Parse decrypted JSON into a ledger, filling any missing collections. */
export function parseLedger(json: string): Ledger {
  const raw = JSON.parse(json) as Partial<Ledger>;
  if (typeof raw.version === "number" && raw.version > LEDGER_VERSION) {
    throw new Error(t.errors.newerLedger(raw.version));
  }
  const categories = raw.categories ?? [];
  // ledgers created before category icons existed: give default categories their icon
  for (const c of categories) {
    if (!c.icon) {
      const key = defaultCategoryKey(c);
      c.icon = DEFAULT_CATEGORIES.find(([k]) => k === key)?.[3];
    }
  }
  return {
    version: LEDGER_VERSION,
    accounts: raw.accounts ?? [],
    categories,
    transactions: raw.transactions ?? [],
    budgets: raw.budgets ?? [],
    recurring: raw.recurring ?? [],
    obligations: (raw.obligations ?? []).map(migrateObligation),
    investments: {
      assets: raw.investments?.assets ?? [],
      snapshots: raw.investments?.snapshots ?? [],
      movements: raw.investments?.movements ?? [],
      targets: raw.investments?.targets ?? [],
    },
    pluggy: raw.pluggy,
    brapi: raw.brapi,
    fx: raw.fx,
  };
}

/** An obligation as saved up to 0.9.0, with full first and last due dates instead of days. */
type LegacyObligation = Obligation & { startDate?: string; endDate?: string };

function migrateObligation(o: LegacyObligation): Obligation {
  if (o.day) return o;
  const { startDate = todayISO(), endDate, ...rest } = o;
  // weekly obligations no longer exist; they become monthly on the same day
  const migrated: Obligation = { ...rest, frequency: o.frequency === "yearly" ? "yearly" : "monthly", day: Number(startDate.slice(8, 10)), since: startDate };
  if (migrated.frequency === "yearly") migrated.month = Number(startDate.slice(5, 7));
  if (endDate && endDate < todayISO()) migrated.archived = true;
  return migrated;
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

export function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
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

// ---- currencies ----

/** Currency of an account's money; undefined = the currency set in the settings. */
export function accountCurrency(ledger: Ledger, accountId: string): string | undefined {
  return ledger.accounts.find((a) => a.id === accountId)?.currency;
}

/**
 * `cents` in `currency` converted into the settings' currency with the stored
 * rates. Unchanged when `currency` is the settings' one (or unset), and when no
 * rate is known yet, since there is nothing better to show.
 */
export function toBase(ledger: Ledger, cents: number, currency?: string): number {
  const fx = ledger.fx;
  if (!currency || !fx || currency === fx.base) return cents;
  const rate = fx.rates[currency];
  return rate ? Math.round(cents / rate) : cents;
}

/** `cents` in `from` converted into `to` with the stored rates; unchanged when a rate is missing. */
export function convert(ledger: Ledger, cents: number, from: string, to: string): number {
  const fx = ledger.fx;
  if (from === to || !fx) return cents;
  const rate = (c: string) => (c === fx.base ? 1 : fx.rates[c]);
  return rate(from) && rate(to) ? Math.round((cents / rate(from)) * rate(to)) : cents;
}

/** A transaction's amount in the settings' currency. */
export function baseAmount(ledger: Ledger, tx: Transaction): number {
  return toBase(ledger, tx.amount, accountCurrency(ledger, tx.accountId));
}

/** Currencies other than `base` in use by accounts or transactions, to fetch rates for. */
export function foreignCurrencies(ledger: Ledger, base: string): string[] {
  const out = new Set<string>();
  for (const a of ledger.accounts) if (a.currency && a.currency !== base) out.add(a.currency);
  for (const tx of ledger.transactions) if (tx.original && tx.original.currency !== base) out.add(tx.original.currency);
  return [...out].sort();
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

/** One credit card bill: the charges of a cycle and what is still unpaid. */
export interface CardBill {
  /** first day of the cycle */
  start: string;
  /** closing date, last day of the cycle (inclusive) */
  close: string;
  /** undefined when the card has no due day */
  due?: string;
  /** charges minus refunds in the cycle, in cents (positive = owed) */
  total: number;
  /** payments counted toward this bill */
  paid: number;
  /** part of `total` not paid yet */
  remaining: number;
}

/** The card's closing date in a month (0-based), clamped to short months. */
function closingIn(year: number, month: number, closingDay?: number): string {
  const d = new Date(year, month, 1);
  const last = daysInMonth(d.getFullYear(), d.getMonth());
  return toISODate(new Date(d.getFullYear(), d.getMonth(), Math.min(closingDay ?? last, last)));
}

/** First date on `dueDay` after `close`. */
function dueAfter(close: string, dueDay: number): string {
  const [y, m] = close.split("-").map(Number);
  const same = closingIn(y, m - 1, dueDay);
  return same > close ? same : closingIn(y, m, dueDay);
}

/** A transfer into the card: paying its bill. */
export function isCardPayment(tx: Transaction, accountId: string): boolean {
  return tx.type === "transfer" && tx.toAccountId === accountId;
}

/**
 * A credit card bill on `today`: offset 0 is the open one, -1 the last closed,
 * -2 the one before, and so on. A card's balance adds up its whole history;
 * bills split it by cycle instead. Payments (transfers into the card) made
 * after a bill closes, until the next closing, pay that bill; what exceeds it
 * goes to the following one. Refunds and other credits lower the bill of their
 * own cycle.
 */
export function cardBill(ledger: Ledger, accountId: string, today: string, offset = 0): CardBill {
  const acc = ledger.accounts.find((a) => a.id === accountId);
  const [y, m] = today.split("-").map(Number);
  // the cycle includes its closing day, so a bill closing today is still open
  let k = 0;
  while (closingIn(y, m - 1 + k, acc?.closingDay) < today) k++;
  const closeAt = (j: number) => closingIn(y, m - 1 + k + offset + j, acc?.closingDay);
  const [before, prev, close, next] = [closeAt(-2), closeAt(-1), closeAt(0), closeAt(1)];

  let total = 0;
  let prevTotal = 0;
  let paid = 0;
  let prevPaid = 0;
  for (const tx of ledger.transactions) {
    const v = effectOn(tx, accountId);
    if (v === 0 || tx.date <= before || tx.date > next) continue;
    if (isCardPayment(tx, accountId)) {
      if (tx.date > close) paid += v;
      else if (tx.date > prev) prevPaid += v;
    } else if (tx.date > prev && tx.date <= close) total -= v;
    else if (tx.date <= prev) prevTotal -= v;
  }
  paid += Math.max(0, prevPaid - Math.max(0, prevTotal));
  const start = toISODate(new Date(Date.parse(`${prev}T12:00:00`) + 86_400_000));
  return {
    start,
    close,
    due: acc?.dueDay ? dueAfter(close, acc.dueDay) : undefined,
    total,
    paid,
    remaining: Math.max(0, total - paid),
  };
}

/** The last closed bill and the open one of a credit card on `today`. */
export function cardBills(ledger: Ledger, accountId: string, today: string): { closed: CardBill; open: CardBill } {
  return { closed: cardBill(ledger, accountId, today, -1), open: cardBill(ledger, accountId, today, 0) };
}

/** Accounts plus investments, in the settings' currency. */
export function netWorth(ledger: Ledger, upTo?: string): number {
  return ledger.accounts.reduce((sum, a) => sum + toBase(ledger, accountBalance(ledger, a.id, upTo), a.currency), 0) + portfolioValue(ledger, upTo);
}

// ---- investments ----

export function openAssets(ledger: Ledger): Asset[] {
  return ledger.investments.assets.filter((a) => !a.closed);
}

/**
 * Investment total today, or on `upTo` from the snapshots. Positions only have
 * a current value, so a date before the first snapshot counts as zero.
 */
export function portfolioValue(ledger: Ledger, upTo?: string): number {
  const current = openAssets(ledger).reduce((s, a) => s + a.value, 0);
  if (!upTo) return current;
  const snaps = ledger.investments.snapshots;
  if (snaps.length && upTo >= snaps[snaps.length - 1].date) return current;
  let value = 0;
  for (const s of snaps) if (s.date <= upTo) value = s.value;
  return value;
}

/** Amount invested in open positions; positions with unknown cost count at their current value. */
export function portfolioInvested(ledger: Ledger): number {
  return openAssets(ledger).reduce((s, a) => s + (a.invested ?? a.value), 0);
}

/**
 * Signed money into (+) or out of (−) a position. Income leaves the position as
 * a payout and tax is a cost, so neither counts as a flow.
 */
export function movementFlow(m: Movement): number {
  switch (m.type) {
    case "buy":
      return m.amount;
    case "sell":
    case "amortization":
      return -m.amount;
    case "transfer":
      return m.direction === "out" ? -m.amount : m.amount;
    default:
      return 0;
  }
}

/** Income paid per month ("YYYY-MM") between `from` and `to` (inclusive). */
export function incomeByMonth(ledger: Ledger, from: string, to: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of ledger.investments.movements) {
    if (m.type !== "income" || m.date < from || m.date > to) continue;
    out.set(monthOf(m.date), (out.get(monthOf(m.date)) ?? 0) + m.amount);
  }
  return out;
}

/** Current value per asset class, largest first. */
export function allocationByClass(ledger: Ledger): [AssetClass, number][] {
  const out = new Map<AssetClass, number>();
  for (const a of openAssets(ledger)) out.set(a.assetClass, (out.get(a.assetClass) ?? 0) + a.value);
  return [...out.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
}

/** Date of the last snapshot before `today`: flows on today's snapshot count from the day after it. */
export function flowWindowStart(ledger: Ledger, today: string): string | undefined {
  const snaps = ledger.investments.snapshots;
  for (let i = snaps.length - 1; i >= 0; i--) if (snaps[i].date < today) return snaps[i].date;
  return undefined;
}

/**
 * Record today's portfolio total, replacing an earlier snapshot of the same day,
 * with the money moved and the income paid since the previous day's snapshot.
 * Those come from the movements of every position whose movements are known,
 * plus `untracked`: money moved that movements don't explain (estimates, a
 * position that starts being tracked). `untracked` adds up over the day's calls,
 * so a sync and a manual edit on the same day don't overwrite each other.
 * Mutates the ledger.
 */
export function recordSnapshot(ledger: Ledger, today: string, untracked = 0) {
  const snaps = ledger.investments.snapshots;
  const last = snaps[snaps.length - 1];
  if (last && last.date > today) return;
  const snap: PortfolioSnapshot = { date: today, value: portfolioValue(ledger), invested: portfolioInvested(ledger) };
  const since = flowWindowStart(ledger, today);
  if (since !== undefined) {
    const estimated = (last?.date === today ? (last.estimated ?? 0) : 0) + untracked;
    // a synced position tracked since inside the window already arrived at its value; its older buys must not count again
    const tracked = new Set(
      ledger.investments.assets
        .filter((a) => (!a.pluggyId || a.movementsSynced) && !(a.pluggyId && a.addedOn && a.addedOn > since))
        .map((a) => a.id)
    );
    let moved = 0;
    let income = 0;
    for (const m of ledger.investments.movements) {
      if (m.date <= since || m.date > today || !tracked.has(m.assetId)) continue;
      moved += movementFlow(m);
      if (m.type === "income") income += m.amount;
    }
    Object.assign(snap, { flow: moved + estimated, estimated, income });
  }
  if (last?.date === today) snaps[snaps.length - 1] = snap;
  else snaps.push(snap);
}

// ---- allocation targets ----

export interface RebalanceLine {
  assetClass: AssetClass;
  /** current value, cents */
  value: number;
  /** current share, percent */
  pct: number;
  /** target share, percent, scaled so the targets add up to 100 */
  target: number;
  /** cents to buy (+) or sell (−) to hit the target today */
  gap: number;
  /** cents of the new contribution to put here */
  contribute: number;
}

/** Split `cents` by `weights` in whole cents; the rounding remainder goes to the largest weights. */
function splitCents(cents: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0 || cents <= 0) return weights.map(() => 0);
  const out = weights.map((w) => Math.floor((cents * w) / total));
  let left = cents - out.reduce((s, v) => s + v, 0);
  const order = weights.map((w, i) => [w, i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  return out;
}

/**
 * Where each class stands against its target, and how to split a new
 * `contribution` to get closer without selling: underweight classes first, in
 * proportion to how far behind they are, then any rest by target weight.
 * Classes without a target count as a 0% target. Empty when there are no targets.
 */
export function rebalance(ledger: Ledger, contribution: number): RebalanceLine[] {
  const targets = ledger.investments.targets.filter((t) => t.pct > 0);
  const sum = targets.reduce((s, t) => s + t.pct, 0);
  if (sum <= 0) return [];
  const current = new Map(allocationByClass(ledger));
  const classes = [...new Set<AssetClass>([...targets.map((t) => t.assetClass), ...current.keys()])];
  const total = portfolioValue(ledger);
  const after = total + Math.max(0, contribution);
  const lines: RebalanceLine[] = classes.map((c) => {
    const value = current.get(c) ?? 0;
    const target = ((targets.find((t) => t.assetClass === c)?.pct ?? 0) / sum) * 100;
    return { assetClass: c, value, pct: total > 0 ? (value / total) * 100 : 0, target, gap: Math.round((total * target) / 100) - value, contribute: 0 };
  });
  const deficits = lines.map((l) => Math.max(0, Math.round((after * l.target) / 100) - l.value));
  const behind = deficits.reduce((s, d) => s + d, 0);
  const c = Math.max(0, contribution);
  const first = splitCents(Math.min(c, behind), deficits);
  const rest = splitCents(c - Math.min(c, behind), lines.map((l) => l.target));
  lines.forEach((l, i) => (l.contribute = first[i] + rest[i]));
  return lines.sort((a, b) => b.target - a.target || b.value - a.value);
}

// ---- manual investments ----

function outsideWindow(ledger: Ledger, date: string, today: string): boolean {
  const since = flowWindowStart(ledger, today);
  return since !== undefined && date <= since;
}

/**
 * Apply (or undo) a manual movement to its position's value, cost and quantity.
 * Withdrawals take cost off at the position's average cost.
 */
function applyMovement(a: Asset, m: Movement, undo: boolean) {
  const s = undo ? -1 : 1;
  const cost = a.invested ?? a.value;
  const q = (m.quantity ?? 0) * s;
  const out = m.type === "sell" || m.type === "amortization" || (m.type === "transfer" && m.direction === "out");
  if (m.type === "buy" || (m.type === "transfer" && !out)) {
    a.value += s * m.amount;
    a.invested = cost + s * m.amount;
    if (q) a.quantity = (a.quantity ?? 0) + q;
  } else if (out) {
    if (!undo) m.cost = a.value > 0 ? Math.min(cost, Math.round((cost * m.amount) / a.value)) : 0;
    a.value -= s * m.amount;
    a.invested = cost - s * (m.cost ?? 0);
    if (q && m.type !== "amortization") a.quantity = (a.quantity ?? 0) - q;
  } else if (m.type === "tax") {
    a.value -= s * m.amount;
  }
  a.value = Math.max(0, a.value);
  if (a.invested !== undefined) a.invested = Math.max(0, a.invested);
}

/**
 * Create or update a position. A new open position arrives as money in at its
 * value; closing one counts as withdrawing it, reopening as putting it back.
 * Any other value change is gain or loss. Mutates the ledger.
 */
export function saveAsset(ledger: Ledger, asset: Asset, today: string) {
  const assets = ledger.investments.assets;
  const i = assets.findIndex((a) => a.id === asset.id);
  const before = i >= 0 ? assets[i] : null;
  if (!asset.pluggyId) asset.updatedAt = today;
  let untracked = 0;
  if (!before) {
    asset.addedOn = today;
    if (!asset.closed) untracked = asset.value;
    assets.push(asset);
  } else {
    if (before.name !== asset.name) asset.renamed = true;
    if (asset.pluggyId && (before.institution ?? "") !== (asset.institution ?? "")) asset.institutionEdited = true;
    if (!before.closed && asset.closed) untracked = -before.value;
    else if (before.closed && !asset.closed) untracked = asset.value;
    assets[i] = asset;
  }
  recordSnapshot(ledger, today, untracked);
}

/**
 * Give `asset`'s institution to the other positions of the same bank connection
 * that have none, as if the user had set each. Returns how many changed. Mutates the ledger.
 */
export function applyInstitutionToConnection(ledger: Ledger, asset: Asset): number {
  if (!asset.pluggyItemId || !asset.institution) return 0;
  let n = 0;
  for (const a of ledger.investments.assets) {
    if (a.id === asset.id || a.pluggyItemId !== asset.pluggyItemId || a.institution) continue;
    a.institution = asset.institution;
    a.institutionEdited = true;
    n++;
  }
  return n;
}

/** Delete a manual position and its movements; its value leaves as money out, not as loss. Mutates the ledger. */
export function removeManualAsset(ledger: Ledger, assetId: string, today: string) {
  const a = ledger.investments.assets.find((x) => x.id === assetId);
  if (!a || a.pluggyId) return;
  ledger.investments.assets = ledger.investments.assets.filter((x) => x.id !== assetId);
  ledger.investments.movements = ledger.investments.movements.filter((m) => m.assetId !== assetId);
  recordSnapshot(ledger, today, a.closed ? 0 : -a.value);
}

/**
 * Create or update a movement on a manual position, applying it to the
 * position (an edit first undoes the old version). A movement dated before the
 * current flow window still changed the value today, so it counts as money
 * moved today. Mutates the ledger.
 */
export function saveManualMovement(ledger: Ledger, m: Movement, today: string) {
  const movements = ledger.investments.movements;
  const asset = (id: string) => ledger.investments.assets.find((a) => a.id === id && !a.pluggyId);
  let untracked = 0;
  const i = movements.findIndex((x) => x.id === m.id);
  if (i >= 0) {
    const old = movements[i];
    const oldAsset = asset(old.assetId);
    if (oldAsset) applyMovement(oldAsset, old, true);
    if (outsideWindow(ledger, old.date, today)) untracked -= movementFlow(old);
    movements.splice(i, 1);
  }
  const target = asset(m.assetId);
  if (!target) return;
  applyMovement(target, m, false);
  target.updatedAt = today;
  movements.push(m);
  if (outsideWindow(ledger, m.date, today)) untracked += movementFlow(m);
  recordSnapshot(ledger, today, untracked);
}

/** Delete a manual movement, undoing its effect on the position. Mutates the ledger. */
export function removeManualMovement(ledger: Ledger, id: string, today: string) {
  const m = ledger.investments.movements.find((x) => x.id === id);
  const a = m && ledger.investments.assets.find((x) => x.id === m.assetId && !x.pluggyId);
  if (!m || !a) return;
  applyMovement(a, m, true);
  a.updatedAt = today;
  ledger.investments.movements = ledger.investments.movements.filter((x) => x.id !== id);
  recordSnapshot(ledger, today, outsideWindow(ledger, m.date, today) ? -movementFlow(m) : 0);
}

export interface MonthSummary {
  income: number;
  expense: number;
  net: number;
}

/** Income/expense totals for a month, in the settings' currency. Transfers move money between own accounts and are excluded. */
export function monthSummary(ledger: Ledger, month: string): MonthSummary {
  let income = 0;
  let expense = 0;
  for (const tx of ledger.transactions) {
    if (monthOf(tx.date) !== month) continue;
    if (tx.type === "income") income += baseAmount(ledger, tx);
    else if (tx.type === "expense") expense += baseAmount(ledger, tx);
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

/** Expense total per category id for a month, in the settings' currency; uncategorized expenses use the key "". */
export function spendingByCategory(ledger: Ledger, month: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const tx of ledger.transactions) {
    if (tx.type !== "expense" || monthOf(tx.date) !== month) continue;
    const key = tx.categoryId ?? "";
    out.set(key, (out.get(key) ?? 0) + baseAmount(ledger, tx));
  }
  return out;
}

/** Newest first; ties broken by id so the order is stable. */
export function sortTransactions(txs: Transaction[]): Transaction[] {
  return [...txs].sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
}

/** Max days between a rule's due date and the synced charge linked to it. */
const LINK_DAYS = 7;
/** How far a synced charge's amount may be from the rule's and still match without a matching description. */
const LINK_AMOUNT_TOLERANCE = 0.2;

/** Average cost of a rule per month, in cents (weekly × 52/12, yearly ÷ 12). */
export function monthlyAmount(r: Recurring): number {
  const factor = r.frequency === "weekly" ? 52 / 12 : r.frequency === "yearly" ? 1 / 12 : 1;
  return r.amount * factor;
}

/**
 * Whether a rule's transactions come from bank sync: it is on an account
 * Pluggy mirrors, so posting it too would count every charge twice.
 */
export function isSyncedRule(ledger: Ledger, r: Recurring): boolean {
  const synced = (id?: string) => !!ledger.accounts.find((a) => a.id === id)?.pluggyId;
  return !!ledger.pluggy && (synced(r.accountId) || (r.type === "transfer" && synced(r.toAccountId)));
}

/** Transactions posted by or linked to a rule, oldest first. */
/**
 * Make an existing transaction an occurrence of `rule`: link it, and move the
 * rule past its date so that occurrence is not posted (or matched) again.
 */
export function linkToRule(ledger: Ledger, rule: Recurring, txId: string) {
  const tx = ledger.transactions.find((x) => x.id === txId);
  if (!tx) return;
  tx.recurringId = rule.id;
  const anchorDay = Number(rule.startDate.slice(8, 10));
  for (let i = 0; i < 1000 && rule.nextDate <= tx.date; i++) rule.nextDate = nextOccurrence(rule.nextDate, rule.frequency, anchorDay);
}

export function ruleTransactions(ledger: Ledger, ruleId: string): Transaction[] {
  return ledger.transactions.filter((tx) => tx.recurringId === ruleId).sort((a, b) => (a.date < b.date ? -1 : 1));
}

function words(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

/** The imported transaction that best fits the rule's next occurrence, if any. */
function syncedCharge(ledger: Ledger, r: Recurring): Transaction | undefined {
  const ruleWords = words(r.description);
  let best: Transaction | undefined;
  let bestScore = Infinity;
  for (const tx of ledger.transactions) {
    if (!tx.pluggyIds?.length || tx.recurringId || tx.type !== r.type || tx.accountId !== r.accountId) continue;
    if (r.type === "transfer" && tx.toAccountId !== r.toAccountId) continue;
    const days = daysBetween(tx.date, r.nextDate);
    if (days > LINK_DAYS) continue;
    const named = words(tx.description).some((w) => ruleWords.includes(w));
    const drift = Math.abs(tx.amount - r.amount) / r.amount;
    if (!named && drift > LINK_AMOUNT_TOLERANCE) continue;
    // a matching name beats any amount; then the closest amount, then the closest date
    const score = (named ? 0 : 1000) + drift * 100 + days;
    if (score < bestScore) {
      best = tx;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Link a synced rule's occurrences to the charges bank sync imported. A rule
 * advances when its charge is found, or when sync has gone LINK_DAYS past the
 * due date without one (a month the service was not charged). The rule takes
 * the latest charge's amount, so a price change is matched next time too.
 */
function linkSyncedRule(ledger: Ledger, r: Recurring, anchorDay: number) {
  const syncedUpTo = ledger.pluggy?.lastSync?.slice(0, 10);
  for (let i = 0; i < 1000; i++) {
    if (r.endDate && r.nextDate > r.endDate) break;
    const tx = syncedCharge(ledger, r);
    if (tx) {
      tx.recurringId = r.id;
      if (r.categoryId && r.type !== "transfer") tx.categoryId = r.categoryId;
      r.amount = tx.amount;
    } else if (!syncedUpTo || r.nextDate >= syncedUpTo || daysBetween(r.nextDate, syncedUpTo) <= LINK_DAYS) {
      break;
    }
    r.nextDate = nextOccurrence(r.nextDate, r.frequency, anchorDay);
  }
}

/**
 * Post every recurring occurrence due on or before `today`, advancing each
 * rule's nextDate. Rules on synced accounts are linked to the imported charges
 * instead of posted. Mutates the ledger; returns how many transactions were added.
 */
export function postDueRecurring(ledger: Ledger, today: string): number {
  let posted = 0;
  for (const r of ledger.recurring) {
    const anchorDay = Number(r.startDate.slice(8, 10));
    if (isSyncedRule(ledger, r)) {
      linkSyncedRule(ledger, r, anchorDay);
      continue;
    }
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

// ---- obligations ----

/** Days from `from` to `to`, negative when `to` is earlier. */
export function daysUntil(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/**
 * The period an occurrence belongs to: its month for monthly obligations, its
 * year for yearly ones. Settlements match by period, so moving the due day of
 * an obligation does not reopen the occurrences already dealt with.
 */
function periodOf(date: string, frequency: Frequency): string {
  return frequency === "monthly" ? date.slice(0, 7) : frequency === "yearly" ? date.slice(0, 4) : date;
}

export function settlementFor(o: Obligation, due: string): Settlement | undefined {
  const period = periodOf(due, o.frequency);
  return o.settled.find((s) => periodOf(s.due, o.frequency) === period);
}

function dayIn(year: number, month: number, day: number): string {
  return toISODate(new Date(year, month - 1, Math.min(day, daysInMonth(year, month - 1))));
}

/** Due dates (deadlines, for documents) from the period of `since` on, skipping those before it. */
function* dueDates(o: Obligation): Generator<string> {
  const [y, m] = o.since.split("-").map(Number);
  // guard against a corrupted obligation looping forever
  for (let i = 0; i < 1000; i++) {
    const due =
      o.frequency === "yearly"
        ? dayIn(y + i, o.endMonth ?? o.month ?? 1, o.endDay ?? o.day)
        : dayIn(y + Math.floor((m - 1 + i) / 12), ((m - 1 + i) % 12) + 1, o.endDay ?? o.day);
    if (due >= o.since) yield due;
  }
}

/** Day the window to send a document opens, for its occurrence due on `due`. */
export function windowStart(o: Obligation, due: string): string {
  const [y, m] = due.split("-").map(Number);
  return dayIn(y, o.frequency === "yearly" ? (o.month ?? 1) : m, o.day);
}

/** Due dates of an obligation on or before `until` not dealt with yet, oldest first. */
export function openOccurrences(o: Obligation, until: string): string[] {
  const out: string[] = [];
  if (o.archived) return out;
  for (const due of dueDates(o)) {
    if (due > until) break;
    if (!settlementFor(o, due)) out.push(due);
  }
  return out;
}

/** First due date after `after` (exclusive), or undefined once the obligation has ended. */
export function nextDue(o: Obligation, after: string): string | undefined {
  if (o.archived) return undefined;
  for (const due of dueDates(o)) if (due > after) return due;
  return undefined;
}

/**
 * Settlement for marking a payment done on `date`: on a day banks are closed
 * the payment is only scheduled, for the next business day.
 */
export function paidOn(o: Obligation, due: string, date: string, transactionId?: string): Settlement {
  const s: Settlement = { due, status: "done", date: o.kind === "payment" ? businessDayFrom(date) : date };
  if (transactionId) s.transactionId = transactionId;
  return s;
}

export interface DueObligation {
  obligation: Obligation;
  due: string;
}

/** Open occurrences of every obligation due on or before `until`, soonest first. */
export function dueObligations(ledger: Ledger, until: string): DueObligation[] {
  return ledger.obligations
    .flatMap((obligation) => openOccurrences(obligation, until).map((due) => ({ obligation, due })))
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.obligation.name.localeCompare(b.obligation.name)));
}

/** Open occurrences inside their reminder window on `today`, overdue ones included. */
export function obligationReminders(ledger: Ledger, today: string): DueObligation[] {
  const horizon = Math.max(0, ...ledger.obligations.map((o) => o.remindDays));
  const until = toISODate(new Date(Date.parse(`${today}T12:00:00`) + horizon * 86_400_000));
  return dueObligations(ledger, until).filter((d) => daysUntil(today, d.due) <= d.obligation.remindDays);
}

/** Mark one occurrence as done or skipped, replacing an earlier mark for the same period. */
export function settleObligation(o: Obligation, s: Settlement) {
  const period = periodOf(s.due, o.frequency);
  o.settled = o.settled.filter((x) => periodOf(x.due, o.frequency) !== period);
  o.settled.push(s);
}

export function unsettleObligation(o: Obligation, due: string) {
  const period = periodOf(due, o.frequency);
  o.settled = o.settled.filter((x) => periodOf(x.due, o.frequency) !== period);
}

/** Days around a due date searched for the payment of an obligation. */
const PAYMENT_SEARCH_DAYS = 15;

/**
 * Transactions that may be the payment of an occurrence: money going out
 * (expenses and transfers, e.g. paying a card bill) near the due date and not
 * linked to another obligation yet. Likeliest first: same name, then closest
 * amount, then closest date.
 */
export function paymentCandidates(ledger: Ledger, o: Obligation, due: string): Transaction[] {
  const taken = new Set(ledger.obligations.flatMap((x) => x.settled.map((s) => s.transactionId)));
  const own = settlementFor(o, due)?.transactionId;
  const nameWords = words(o.name);
  const score = (tx: Transaction) =>
    (words(tx.description).some((w) => nameWords.includes(w)) ? 0 : 1000) +
    (o.amount ? (Math.abs(tx.amount - o.amount) / o.amount) * 100 : 0) +
    daysBetween(tx.date, due);
  return ledger.transactions
    .filter((tx) => tx.type !== "income" && daysBetween(tx.date, due) <= PAYMENT_SEARCH_DAYS && (tx.id === own || !taken.has(tx.id)))
    .sort((a, b) => score(a) - score(b));
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
