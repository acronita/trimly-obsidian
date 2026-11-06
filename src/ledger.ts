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
  /** credit cards: day of month the bill closes, its charges going to the next bill; calendar month when unset */
  closingDay?: number;
  /** synced credit cards: the bank's own closing and due dates (ISO) of each bill, which win over the days */
  billDates?: BillDates[];
  /** credit cards: day of month the closed bill is due */
  dueDay?: number;
  /** credit cards: credit limit, in cents */
  creditLimit?: number;
  /** ISO 4217 code of the account's money; missing = the currency set in the settings */
  currency?: string;
}

export interface BillDates {
  close: string;
  due: string;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  color: string;
  /** Lucide icon name; missing = "tag" */
  icon?: string;
  /** receives this kind's uncategorized transactions; at most one per kind */
  isDefault?: boolean;
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
  /**
   * payment obligation (bill) this transaction pays, whatever month it was, even before the bill
   * was registered; null = the user unlinked it, so it is not matched again. Which occurrence it
   * paid, if any, is in the obligation's `settled`.
   */
  obligationId?: string | null;
  /** Pluggy transaction ids this one was imported from (two for a paired transfer) */
  pluggyIds?: string[];
  /** imported while the bank still listed it as pending */
  pending?: boolean;
  /** made in another currency than the account's (e.g. a card purchase in USD); `amount` is what the account was charged */
  original?: { currency: string; amount: number };
  /** card purchases in installments: this charge is installment `number` of `total` */
  installment?: { number: number; total: number };
  /** synced card charges: month ("YYYY-MM") the bill holding this charge closes in, as the bank reports it */
  billMonth?: string;
}

export interface CategoryRule {
  /** `descriptionKey()` of the descriptions it covers */
  key: string;
  categoryId: string;
}

/** What the user planned for one month in Planning. */
export interface MonthBudget {
  /** day-to-day limit per category, on top of its bills */
  budgets: Budget[];
  /** cents to invest that month; aportes toward it are not expenses */
  investmentGoal?: number;
}

export interface Budget {
  categoryId: string;
  /** monthly spending limit, in cents */
  limit: number;
}

/** A loan or financing being paid off in monthly payments. Tracked apart: it doesn't touch accounts or net worth. */
export interface Debt {
  id: string;
  name: string;
  /** owed on `asOf`, in cents, in the settings' currency */
  balance: number;
  /** ISO date of `balance` */
  asOf: string;
  /** interest, percent a month */
  monthlyRate: number;
  /** cents a month */
  payment: number;
}

/** Money to have by a date (emergency fund, a trip), measured by what one account or position holds. */
export interface SavingsGoal {
  id: string;
  name: string;
  /** in cents, in the settings' currency */
  target: number;
  /** ISO date to reach it by */
  date: string;
  /** what it is measured by: an account, or else a position */
  accountId?: string;
  assetId?: string;
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
  /** payments: description of the last transaction linked as its payment; later ones like it are linked automatically */
  payee?: string;
  /** payments: same amount every time (a health plan), so Planning counts it with fixed costs; unset = varies (electricity) */
  fixed?: boolean;
  /** payments: category its cost belongs to in Planning; taken from the first linked payment when unset */
  categoryId?: string;
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
  /** the user's weight or score inside its class, any scale; with any set in a class, contributions split by them */
  weight?: number;
  /** portfolio it belongs to; missing = the main one */
  portfolioId?: string;
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
  /** the main portfolio's: positions in no other portfolio */
  targets: AllocationTarget[];
  /** other portfolios, by objective; without any, there is just the main one */
  portfolios?: Portfolio[];
}

/** Positions set apart for an objective (retirement, emergency fund), with allocation targets of their own. */
export interface Portfolio {
  id: string;
  name: string;
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
  /** category limits from before plans were kept per month: the plan of any month before the first in `plans` */
  budgets: Budget[];
  recurring: Recurring[];
  obligations: Obligation[];
  investments: Investments;
  /** each month's plan ("YYYY-MM"), saved once that month is edited; a month without one uses the latest before it */
  plans?: Record<string, MonthBudget>;
  goals?: SavingsGoal[];
  debts?: Debt[];
  /** categories learned from the user: transactions whose description has this key get this category */
  categoryRules?: CategoryRule[];
  /** set when bank sync is configured */
  pluggy?: PluggyConfig;
  /** set when quotes are configured */
  brapi?: BrapiConfig;
  /** day the Tesouro Direto prices were last fetched; the file is big, so once a day */
  treasuryCheckedOn?: string;
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
      ...(raw.investments?.portfolios ? { portfolios: raw.investments.portfolios } : {}),
    },
    plans: raw.plans,
    goals: raw.goals,
    debts: raw.debts,
    categoryRules: raw.categoryRules,
    pluggy: raw.pluggy,
    brapi: raw.brapi,
    treasuryCheckedOn: raw.treasuryCheckedOn,
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
  /** first day of the cycle: the previous bill's closing date */
  start: string;
  /** last day of the cycle, the day before closing */
  end: string;
  /** closing date: from it on, charges go to the next bill */
  close: string;
  /** undefined when the card has no due day */
  due?: string;
  /** charges minus refunds in the cycle, in cents (positive = owed) */
  total: number;
  /** payments counted toward this bill */
  paid: number;
  /** part of `total` not paid yet */
  remaining: number;
  /** installments expected in this cycle that the bank did not charge (yet), included in `total` */
  planned: number;
}

/**
 * The card's closing date in a month (0-based), clamped to short months. With
 * no closing day the bill is the calendar month, closing on the next month's 1st.
 */
function closingIn(year: number, month: number, closingDay?: number): string {
  if (closingDay === undefined) return toISODate(new Date(year, month + 1, 1));
  const d = new Date(year, month, 1);
  const last = daysInMonth(d.getFullYear(), d.getMonth());
  return toISODate(new Date(d.getFullYear(), d.getMonth(), Math.min(closingDay, last)));
}

/**
 * The card's closing date in a month (0-based): the bank's own date when sync
 * brought that bill, otherwise the one its closing day gives.
 */
function closeIn(acc: Account | undefined, year: number, month: number): string {
  const fallback = closingIn(year, month, acc?.closingDay);
  return acc?.billDates?.find((b) => monthOf(b.close) === monthOf(fallback))?.close ?? fallback;
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

/** The first closing date of a card after `date`: the day the next bill opens. */
function closingAfter(acc: Account | undefined, date: string): string {
  const [y, m] = date.split("-").map(Number);
  let month = m - 1;
  let close = closeIn(acc, y, month);
  for (let i = 0; i < 3 && close <= date; i++) close = closeIn(acc, y, ++month);
  return close;
}

/**
 * Month ("YYYY-MM") the bill holding a card charge closes in: the bank's own
 * when sync brought it, otherwise the first closing after the charge's date.
 */
export function chargeBillMonth(ledger: Ledger, tx: Transaction): string {
  return tx.billMonth ?? monthOf(closingAfter(ledger.accounts.find((a) => a.id === tx.accountId), tx.date));
}

/** An installment of a card purchase that is not charged yet. */
export interface PlannedInstallment {
  /** the purchase's latest charged installment */
  last: Transaction;
  number: number;
  total: number;
  /** month the bill it is expected on closes in */
  month: string;
  /** the day that bill opens */
  date: string;
  amount: number;
}

/** Strips an installment mark ("3/10", "PARC 03/10", "Parcela 3 de 10") from a description. */
const INSTALLMENT_MARK = /\s*(?:-\s*)?(?:parc(?:ela)?\.?\s*)?(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\s*$/i;

/**
 * The installment a card charge's description names, when the bank writes it
 * there ("LOJA 03/10", "LOJA PARC 3/10") instead of sending it apart.
 */
export function installmentFromDescription(description: string): Transaction["installment"] {
  const m = INSTALLMENT_MARK.exec(description);
  if (!m) return undefined;
  const [number, total] = [Number(m[1]), Number(m[2])];
  return number >= 1 && total >= 2 && number <= total ? { number, total } : undefined;
}

/**
 * The installments of each purchase on a card still to be charged, one per bill
 * after the latest charged one's, soonest first.
 */
export function futureInstallments(ledger: Ledger, accountId: string): PlannedInstallment[] {
  const acc = ledger.accounts.find((a) => a.id === accountId);
  const month = new Map<Transaction, string>();
  const charges = ledger.transactions.filter((tx) => tx.installment && tx.accountId === accountId && tx.type === "expense");
  for (const tx of charges) month.set(tx, chargeBillMonth(ledger, tx));
  // a purchase's installments share the description (without the mark) and the count; oldest bill first, each
  // charge continues the purchase whose latest installment comes closest before it, else starts a new one
  charges.sort((a, b) => (month.get(a)! < month.get(b)! ? -1 : month.get(a)! > month.get(b)! ? 1 : a.installment!.number - b.installment!.number));
  const series = new Map<string, Transaction[]>();
  for (const tx of charges) {
    const inst = tx.installment!;
    const key = `${tx.description.replace(INSTALLMENT_MARK, "").trim().toLowerCase()}|${inst.total}`;
    const open = series.get(key) ?? [];
    series.set(key, open);
    let best = -1;
    open.forEach((last, i) => {
      const n = last.installment!.number;
      if (n < inst.number && (best < 0 || n > open[best].installment!.number)) best = i;
    });
    if (best >= 0) open[best] = tx;
    else open.push(tx);
  }
  const out: PlannedInstallment[] = [];
  for (const last of [...series.values()].flat()) {
    const { number, total } = last.installment!;
    // each installment goes to the bill after the previous one's
    for (let n = number + 1; n <= total; n++) {
      const m = shiftMonth(month.get(last)!, n - number);
      const [y, mm] = shiftMonth(m, -1).split("-").map(Number);
      out.push({ last, number: n, total, month: m, date: closeIn(acc, y, mm - 1), amount: last.amount });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Charge the installments due on or before `today` of purchases on cards bank
 * sync does not mirror; on synced cards the bank charges them. Mutates the
 * ledger; returns how many transactions were added.
 */
export function postDueInstallments(ledger: Ledger, today: string): number {
  let posted = 0;
  for (const acc of ledger.accounts) {
    if (acc.type !== "credit" || (ledger.pluggy && acc.pluggyId)) continue;
    for (const p of futureInstallments(ledger, acc.id)) {
      if (p.date > today) continue;
      const tx: Transaction = { ...p.last, id: newId(), date: p.date, installment: { number: p.number, total: p.total } };
      delete tx.recurringId;
      delete tx.notes;
      ledger.transactions.push(tx);
      posted++;
    }
  }
  return posted;
}

/**
 * A credit card bill on `today`: offset 0 is the open one, -1 the last closed,
 * -2 the one before, and so on. A card's balance adds up its whole history;
 * bills split it by cycle instead. A bill closes at the start of its closing
 * day, so that day's charges go to the next one, as at Brazilian banks.
 * Payments (transfers into the card) made from a bill's closing day until the
 * next closing pay that bill; what exceeds it
 * goes to the following one. Refunds and other credits lower the bill of their
 * own cycle.
 */
export function cardBill(ledger: Ledger, accountId: string, today: string, offset = 0): CardBill {
  const acc = ledger.accounts.find((a) => a.id === accountId);
  const [y, m] = today.split("-").map(Number);
  // the cycle ends the day before closing, so a bill closing today is closed
  let k = 0;
  while (closeIn(acc, y, m - 1 + k) <= today) k++;
  const closeAt = (j: number) => closeIn(acc, y, m - 1 + k + offset + j);
  const [before, prev, close, next] = [closeAt(-2), closeAt(-1), closeAt(0), closeAt(1)];

  let total = 0;
  let prevTotal = 0;
  let paid = 0;
  let prevPaid = 0;
  // payments count by date; charges by the bill the bank put them on (installments carry the purchase date)
  const [month, prevMonth] = [monthOf(close), monthOf(prev)];
  for (const tx of ledger.transactions) {
    const v = effectOn(tx, accountId);
    if (v === 0) continue;
    if (isCardPayment(tx, accountId)) {
      if (tx.date < before || tx.date >= next) continue;
      if (tx.date >= close) paid += v;
      else if (tx.date >= prev) prevPaid += v;
      continue;
    }
    const bill = chargeBillMonth(ledger, tx);
    if (bill === month) total -= v;
    else if (bill === prevMonth) prevTotal -= v;
  }
  paid += Math.max(0, prevPaid - Math.max(0, prevTotal));
  // some banks only report a purchase's first installment, so the rest count in their bills even once closed
  const planned = futureInstallments(ledger, accountId)
    .filter((p) => p.month === month)
    .reduce((s, p) => s + p.amount, 0);
  total += planned;
  return {
    start: prev,
    end: toISODate(new Date(Date.parse(`${close}T12:00:00`) - 86_400_000)),
    close,
    due: acc?.billDates?.find((b) => b.close === close)?.due ?? (acc?.dueDay ? dueAfter(close, acc.dueDay) : undefined),
    total,
    paid,
    remaining: Math.max(0, total - paid),
    planned,
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

// ---- savings goals ----

export interface GoalProgress {
  /** what the linked account or position holds now, in the settings' currency; never negative */
  saved: number;
  left: number;
  /** to save per month to reach the target by the date; 0 once done or late */
  monthly: number;
  status: "active" | "done" | "late";
  /** false when the account was deleted or the position closed */
  linked: boolean;
  /** another goal counts the same account or position, so the balance counts in full in both */
  shared: boolean;
}

export function goalProgress(ledger: Ledger, goal: SavingsGoal, today: string): GoalProgress {
  const account = goal.accountId ? ledger.accounts.find((a) => a.id === goal.accountId) : undefined;
  const asset = goal.assetId ? openAssets(ledger).find((a) => a.id === goal.assetId) : undefined;
  const balance = account ? toBase(ledger, accountBalance(ledger, account.id), account.currency) : (asset?.value ?? 0);
  const saved = Math.max(0, Math.round(balance));
  const left = Math.max(0, goal.target - saved);
  const status = left === 0 ? "done" : goal.date < today ? "late" : "active";
  const [fromYear, fromMonth] = today.split("-").map(Number);
  const [toYear, toMonth] = goal.date.split("-").map(Number);
  // a goal due this month still has this month to save in
  const months = Math.max(1, (toYear - fromYear) * 12 + toMonth - fromMonth);
  return {
    saved,
    left,
    monthly: status === "active" ? Math.ceil(left / months) : 0,
    status,
    linked: !!account || !!asset,
    shared: (ledger.goals ?? []).some(
      (g) => g.id !== goal.id && (goal.accountId ? g.accountId === goal.accountId : !!goal.assetId && g.assetId === goal.assetId)
    ),
  };
}

export function saveGoal(ledger: Ledger, goal: SavingsGoal) {
  const goals = ledger.goals ?? [];
  const i = goals.findIndex((g) => g.id === goal.id);
  if (i >= 0) goals[i] = goal;
  else goals.push(goal);
  ledger.goals = goals;
}

export function removeGoal(ledger: Ledger, id: string) {
  const goals = (ledger.goals ?? []).filter((g) => g.id !== id);
  ledger.goals = goals.length ? goals : undefined;
}

// ---- debts ----

/** Past this, a debt has no useful payoff date. */
const MAX_DEBT_MONTHS = 1200;
const DEBT_ROUNDING_LEFT = 1_00;

export interface DebtPayoff {
  /** payments left; null when the payment doesn't cover the interest, so it never ends */
  months: number | null;
  /** interest still to pay, cents; 0 when it never ends */
  interest: number;
}

/** Paying `payment` a month on `balance`, interest charged first each month. */
export function debtPayoff(balance: number, monthlyRate: number, payment: number): DebtPayoff {
  const rate = monthlyRate / 100;
  let left = balance;
  let interest = 0;
  for (let months = 0; months < MAX_DEBT_MONTHS; months++) {
    // a bank's payment is rounded to the cent, which leaves cents at the end, not one more month
    if (left < DEBT_ROUNDING_LEFT) return { months, interest: Math.round(interest) };
    const charged = left * rate;
    if (payment <= charged) return { months: null, interest: 0 };
    interest += charged;
    left = left + charged - payment;
  }
  return { months: null, interest: 0 };
}

/** What is owed today, assuming each month's payment since `asOf` was made. */
export function debtBalance(debt: Debt, today: string): number {
  const [fy, fm, fd] = debt.asOf.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const months = (ty - fy) * 12 + tm - fm - (td < fd ? 1 : 0);
  let left = debt.balance;
  for (let i = 0; i < Math.min(months, MAX_DEBT_MONTHS) && left > 0; i++) left = left * (1 + debt.monthlyRate / 100) - debt.payment;
  return Math.max(0, Math.round(left));
}

export function saveDebt(ledger: Ledger, debt: Debt) {
  const debts = ledger.debts ?? [];
  const i = debts.findIndex((d) => d.id === debt.id);
  if (i >= 0) debts[i] = debt;
  else debts.push(debt);
  ledger.debts = debts;
}

export function removeDebt(ledger: Ledger, id: string) {
  const debts = (ledger.debts ?? []).filter((d) => d.id !== id);
  ledger.debts = debts.length ? debts : undefined;
}

/** Aportes (buy movements) made in `month`, in cents. */
export function contributionsInMonth(ledger: Ledger, month: string): number {
  return ledger.investments.movements.filter((m) => m.type === "buy" && monthOf(m.date) === month).reduce((s, m) => s + m.amount, 0);
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

// ---- portfolios ----

/**
 * The ledger as seen from one portfolio ("" = the main one): only its positions and
 * its targets, so allocation and rebalancing work on it unchanged. For reading: it
 * shares its objects with the real ledger, and history stays that of the whole.
 */
export function portfolioLedger(ledger: Ledger, portfolioId: string): Ledger {
  const portfolios = ledger.investments.portfolios ?? [];
  const portfolio = portfolios.find((p) => p.id === portfolioId);
  // a position whose portfolio is gone falls back to the main one, so it never disappears
  const inPortfolio = (a: Asset) => (portfolios.some((p) => p.id === a.portfolioId) ? a.portfolioId : "") === (portfolio?.id ?? "");
  return {
    ...ledger,
    investments: { ...ledger.investments, assets: ledger.investments.assets.filter(inPortfolio), targets: portfolio?.targets ?? ledger.investments.targets },
  };
}

export function savePortfolio(ledger: Ledger, portfolio: Portfolio) {
  const portfolios = ledger.investments.portfolios ?? [];
  const i = portfolios.findIndex((p) => p.id === portfolio.id);
  if (i >= 0) portfolios[i] = portfolio;
  else portfolios.push(portfolio);
  ledger.investments.portfolios = portfolios;
}

/** Remove a portfolio; its positions go back to the main one, and its targets go with it. */
export function removePortfolio(ledger: Ledger, id: string) {
  const portfolios = (ledger.investments.portfolios ?? []).filter((p) => p.id !== id);
  ledger.investments.portfolios = portfolios.length ? portfolios : undefined;
  for (const a of ledger.investments.assets) if (a.portfolioId === id) delete a.portfolioId;
}

/** Set (or, at 0, clear) a class's target in one portfolio ("" = the main one). */
export function setPortfolioTarget(ledger: Ledger, portfolioId: string, assetClass: AssetClass, pct: number) {
  const owner = ledger.investments.portfolios?.find((p) => p.id === portfolioId) ?? ledger.investments;
  owner.targets = owner.targets.filter((x) => x.assetClass !== assetClass);
  if (pct > 0) owner.targets.push({ assetClass, pct });
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
  const split = splitContribution(Math.max(0, contribution), after, lines);
  lines.forEach((l, i) => (l.contribute = split[i]));
  return lines.sort((a, b) => b.target - a.target || b.value - a.value);
}

/** Split `cents` among parts with a current value and a target percent of `after`: furthest behind first, then any rest by target. */
function splitContribution(cents: number, after: number, parts: { value: number; target: number }[]): number[] {
  const deficits = parts.map((p) => Math.max(0, Math.round((after * p.target) / 100) - p.value));
  const behind = deficits.reduce((s, d) => s + d, 0);
  const first = splitCents(Math.min(cents, behind), deficits);
  const rest = splitCents(cents - Math.min(cents, behind), parts.map((p) => p.target));
  return parts.map((_, i) => first[i] + rest[i]);
}

export interface AssetTargetLine {
  asset: Asset;
  /** share of its class today, percent */
  pct: number;
  /** share of its class by weight, percent */
  target: number;
  /** cents of the class's contribution to put here */
  contribute: number;
}

/** A class's open positions: what the weights apply to. */
export function classAssets(ledger: Ledger, assetClass: AssetClass): Asset[] {
  return openAssets(ledger).filter((a) => a.assetClass === assetClass);
}

/**
 * How a class's share of a contribution splits among its positions, by the weights
 * the user gave them; a position without one counts as 0. Largest target first.
 * Empty until some position in the class has a weight, so the plan stops at the class.
 */
export function assetTargets(ledger: Ledger, assetClass: AssetClass, contribute: number): AssetTargetLine[] {
  const assets = classAssets(ledger, assetClass);
  const sum = assets.reduce((s, a) => s + (a.weight ?? 0), 0);
  if (sum <= 0) return [];
  const total = assets.reduce((s, a) => s + a.value, 0);
  const lines: AssetTargetLine[] = assets.map((asset) => ({
    asset,
    pct: total > 0 ? (asset.value / total) * 100 : 0,
    target: ((asset.weight ?? 0) / sum) * 100,
    contribute: 0,
  }));
  const split = splitContribution(contribute, total + contribute, lines.map((l) => ({ value: l.asset.value, target: l.target })));
  lines.forEach((l, i) => (l.contribute = split[i]));
  return lines.sort((a, b) => b.target - a.target || b.asset.value - a.asset.value);
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

/**
 * Income still expected in `month` from recurring rules, in the settings'
 * currency: occurrences in that month not yet posted (or linked to a synced
 * transaction). Lets the overview show how the month ends before a late payday.
 */
export function pendingRecurringIncome(ledger: Ledger, month: string): number {
  return pendingRecurring(ledger, month, "income");
}

/** Like `pendingRecurringIncome`, for rules of any type: occurrences in `month` not posted or linked yet. */
export function pendingRecurring(ledger: Ledger, month: string, type: TxType): number {
  let total = 0;
  for (const r of ledger.recurring) {
    if (r.type !== type) continue;
    const anchorDay = Number(r.startDate.slice(8, 10));
    let date = r.nextDate;
    // guard against a corrupted rule looping forever
    for (let i = 0; i < 1000 && monthOf(date) <= month; i++) {
      if (r.endDate && date > r.endDate) break;
      if (monthOf(date) === month) total += toBase(ledger, r.amount, accountCurrency(ledger, r.accountId));
      date = nextOccurrence(date, r.frequency, anchorDay);
    }
  }
  return total;
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
/** How far it may be even with a matching description: covers a price change, not another charge at the same place. */
const LINK_NAMED_AMOUNT_TOLERANCE = 0.5;

/** Income from active recurring rules per month, in the settings' currency. */
export function fixedMonthlyIncome(ledger: Ledger): number {
  let total = 0;
  for (const r of ledger.recurring) {
    if (r.type !== "income" || (r.endDate && r.nextDate > r.endDate)) continue;
    total += toBase(ledger, monthlyAmount(r), accountCurrency(ledger, r.accountId));
  }
  return total;
}

/**
 * The limits and investment goal planned for `month`: its own plan, else a
 * copy of the latest month before it that has one (so a new month starts from
 * the last), else the limits from before plans were kept per month.
 */
export function budgetFor(ledger: Ledger, month: string): MonthBudget {
  const plans = ledger.plans ?? {};
  const from = Object.keys(plans).filter((m) => m <= month).sort().pop();
  const b = from ? plans[from] : { budgets: ledger.budgets };
  return { budgets: b.budgets.map((x) => ({ ...x })), investmentGoal: b.investmentGoal };
}

/** Change `month`'s plan only: it gets its own copy first, so earlier months keep theirs as history. */
export function editBudget(ledger: Ledger, month: string, change: (b: MonthBudget) => void) {
  const b = budgetFor(ledger, month);
  change(b);
  if (!b.investmentGoal) delete b.investmentGoal;
  ledger.plans = { ...ledger.plans, [month]: b };
}

/** One line of the month's plan, in the settings' currency. */
export interface PlanLine {
  planned: number;
  /** what happened in the month so far */
  actual: number;
  /** where the month is headed: what happened plus what is still due (see `monthPlan`) */
  projected: number;
}

export interface MonthPlan {
  /** fixed income (income rules) against the income received in the month */
  income: PlanLine;
  /** expense rules (subscriptions included) and fixed-amount bills against the month's transactions posted by, linked to or paying them */
  fixed: PlanLine;
  /** bills paid by hand whose amount varies (`estimatedBills`) against the month's transactions paying them */
  bills: PlanLine;
  /** category limits against every other expense of the month, planned (limits) or not */
  spending: PlanLine;
  /** investment goal against the month's aportes; projected = the goal, or more when more was invested */
  invest: PlanLine;
  /** expense rules and bills per month by category id ("" = uncategorized): the part of a category already committed */
  fixedByCategory: Map<string, number>;
  /** `spending` split by category id ("" = uncategorized): its limit, what was spent outside bills, and the forecast */
  spendingByCategory: Map<string, PlanLine>;
}

/**
 * The month's plan: what fixed income pays for, what really happened, and
 * where the month is headed. A category's limit is spending on top of its
 * bills, so a health plan paid by a rule counts in `fixed`, not against the
 * health limit. The projection adds to what happened what is still due in the
 * month: recurring occurrences not posted yet, bill occurrences not paid yet,
 * and, until the month is over, what is left of each category's limit.
 */
export function monthPlan(ledger: Ledger, month: string, today = todayISO()): MonthPlan {
  const fixedByCategory = new Map<string, number>();
  let fixedPlanned = 0;
  for (const r of ledger.recurring) {
    if (r.type !== "expense" || (r.endDate && r.nextDate > r.endDate)) continue;
    const v = toBase(ledger, monthlyAmount(r), accountCurrency(ledger, r.accountId));
    fixedPlanned += v;
    const key = r.categoryId ?? "";
    fixedByCategory.set(key, (fixedByCategory.get(key) ?? 0) + v);
  }
  let billsPlanned = 0;
  for (const { obligation: o, monthly } of estimatedBills(ledger)) {
    if (o.fixed) fixedPlanned += monthly;
    else billsPlanned += monthly;
    const key = o.categoryId ?? "";
    fixedByCategory.set(key, (fixedByCategory.get(key) ?? 0) + monthly);
  }
  // transaction id -> whether the bill it pays has a fixed amount
  const billTxs = new Map<string, boolean>();
  for (const o of ledger.obligations) for (const st of o.settled) if (st.transactionId) billTxs.set(st.transactionId, !!o.fixed);
  for (const tx of ledger.transactions) {
    const o = billOf(ledger, tx);
    if (o) billTxs.set(tx.id, !!o.fixed);
  }

  const budget = budgetFor(ledger, month);
  const line = (planned: number): PlanLine => ({ planned, actual: 0, projected: 0 });
  const plan: MonthPlan = {
    income: line(fixedMonthlyIncome(ledger)),
    fixed: line(fixedPlanned),
    bills: line(billsPlanned),
    spending: line(budget.budgets.reduce((s, b) => s + b.limit, 0)),
    invest: line(budget.investmentGoal ?? 0),
    fixedByCategory,
    spendingByCategory: new Map(budget.budgets.map((b) => [b.categoryId, line(b.limit)])),
  };
  const spentByCategory = new Map<string, number>();
  for (const tx of ledger.transactions) {
    if (monthOf(tx.date) !== month) continue;
    const v = baseAmount(ledger, tx);
    if (tx.type === "income") plan.income.actual += v;
    else if (tx.type !== "expense") continue;
    else if (tx.recurringId || billTxs.get(tx.id)) plan.fixed.actual += v;
    else if (billTxs.has(tx.id)) plan.bills.actual += v;
    else {
      plan.spending.actual += v;
      const key = tx.categoryId ?? "";
      spentByCategory.set(key, (spentByCategory.get(key) ?? 0) + v);
    }
  }
  plan.invest.actual = contributionsInMonth(ledger, month);

  // still due in the month
  let fixedDue = pendingRecurring(ledger, month, "expense");
  let billsDue = 0;
  for (const { obligation: o } of estimatedBills(ledger)) {
    const due = openOccurrences(o, `${month}-31`).filter((d) => monthOf(d) === month).length * expectedAmount(ledger, o);
    if (o.fixed) fixedDue += due;
    else billsDue += due;
  }
  // until the month is over, what is left of a limit is still expected to be spent
  const open = month >= monthOf(today);
  for (const [key, spent] of spentByCategory) {
    if (!plan.spendingByCategory.has(key)) plan.spendingByCategory.set(key, line(0));
    plan.spendingByCategory.get(key)!.actual = spent;
  }
  let spendingLeft = 0;
  for (const l of plan.spendingByCategory.values()) {
    const left = open ? Math.max(0, l.planned - l.actual) : 0;
    l.projected = l.actual + left;
    spendingLeft += left;
  }
  plan.income.projected = plan.income.actual + pendingRecurring(ledger, month, "income");
  plan.fixed.projected = plan.fixed.actual + fixedDue;
  plan.bills.projected = plan.bills.actual + billsDue;
  plan.spending.projected = plan.spending.actual + spendingLeft;
  plan.invest.projected = Math.max(plan.invest.planned, plan.invest.actual);
  return plan;
}

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

/**
 * Delete a rule. Its transactions stay, unlinked: they are no longer occurrences
 * of anything, and a synced one is free to be matched by a rule made again.
 */
export function removeRecurring(ledger: Ledger, ruleId: string) {
  ledger.recurring = ledger.recurring.filter((r) => r.id !== ruleId);
  for (const tx of ledger.transactions) if (tx.recurringId === ruleId) delete tx.recurringId;
}

export function ruleTransactions(ledger: Ledger, ruleId: string): Transaction[] {
  return ledger.transactions.filter((tx) => tx.recurringId === ruleId).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Wording banks put on any entry of a kind ("Transferência Recebida", "Compra no débito"): it names nobody. */
const GENERIC_WORDS = new Set([
  "transferencia", "recebida", "recebido", "enviada", "enviado", "pix", "ted", "doc",
  "pagamento", "compra", "debito", "credito", "deposito", "boleto", "efetuado", "efetuada",
]);

function words(s: string): string[] {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));
}

/** What a transaction is expected to look like, to find it among the ledger's. */
export interface ExpectedTx {
  /** description or name; sharing a word with it is the strongest sign */
  text: string;
  /** expected amount in cents; unset = any */
  amount?: number;
  /** expected date */
  date: string;
  /** farthest a match may be from `date`, in days */
  maxDays: number;
  /** without a shared word, how far (as a fraction) the amount may drift; unset = any amount */
  amountTolerance?: number;
  /** only transactions sharing a word with `text` match */
  requireName?: boolean;
}

/**
 * How well a transaction fits an expected one, lower is better; undefined when
 * it does not fit. A shared word beats any amount; then the closest amount,
 * then the closest date.
 */
export function matchScore(tx: Transaction, e: ExpectedTx): number | undefined {
  const days = daysBetween(tx.date, e.date);
  if (days > e.maxDays) return undefined;
  const expected = words(e.text);
  const named = words(tx.description).some((w) => expected.includes(w));
  const drift = e.amount ? Math.abs(tx.amount - e.amount) / e.amount : 0;
  if (!named && (e.requireName || (e.amountTolerance !== undefined && drift > e.amountTolerance))) return undefined;
  return (named ? 0 : 1000) + drift * 100 + days;
}

/** The transaction among `txs` that best fits `e`, if any. */
export function bestMatch(txs: Transaction[], e: ExpectedTx): Transaction | undefined {
  let best: Transaction | undefined;
  let bestScore = Infinity;
  for (const tx of txs) {
    const score = matchScore(tx, e);
    if (score !== undefined && score < bestScore) {
      best = tx;
      bestScore = score;
    }
  }
  return best;
}

/** The imported transaction that best fits the rule's next occurrence, if any. */
function syncedCharge(ledger: Ledger, r: Recurring): Transaction | undefined {
  const pool = ledger.transactions.filter(
    (tx) =>
      tx.pluggyIds?.length &&
      !tx.recurringId &&
      tx.type === r.type &&
      tx.accountId === r.accountId &&
      (r.type !== "transfer" || tx.toAccountId === r.toAccountId) &&
      Math.abs(tx.amount - r.amount) <= r.amount * LINK_NAMED_AMOUNT_TOLERANCE
  );
  return bestMatch(pool, { text: r.description, amount: r.amount, date: r.nextDate, maxDays: LINK_DAYS, amountTolerance: LINK_AMOUNT_TOLERANCE });
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
  /** a credit card's bill, built from the card: paying it (a transfer into the card) settles it, not a mark */
  cardId?: string;
  /** a card bill not closed yet: its amount is what was charged so far */
  projected?: boolean;
}

/**
 * What a payment is expected to cost: its usual amount, else what its last
 * linked payment cost, else 0. Documents cost nothing.
 */
export function expectedAmount(ledger: Ledger, o: Obligation): number {
  if (o.kind !== "payment") return 0;
  if (o.amount) return o.amount;
  const last = [...o.settled]
    .filter((s) => s.transactionId)
    .sort((a, b) => (a.due < b.due ? 1 : -1))
    .map((s) => ledger.transactions.find((tx) => tx.id === s.transactionId))
    .find((tx) => tx);
  return last?.amount ?? 0;
}

/**
 * The bills paid by hand, each with what it costs per month on average, in
 * cents: expected amounts of active payment obligations (yearly ones ÷ 12),
 * costliest first. Card bills are not obligations (their purchases are already
 * transactions), and a bill paid by a recurring rule is left out, since the
 * recurring totals already count it.
 */
export function estimatedBills(ledger: Ledger): { obligation: Obligation; monthly: number }[] {
  const out = [];
  for (const o of ledger.obligations) {
    if (o.kind !== "payment" || o.archived) continue;
    const paidByRule = o.settled.some((s) => ledger.transactions.find((tx) => tx.id === s.transactionId)?.recurringId);
    if (paidByRule) continue;
    out.push({ obligation: o, monthly: expectedAmount(ledger, o) / (o.frequency === "yearly" ? 12 : 1) });
  }
  return out.sort((a, b) => b.monthly - a.monthly);
}

/** What an open occurrence will cost, in the settings' currency; documents cost nothing. */
export function dueAmount(ledger: Ledger, d: DueObligation): number {
  if (d.cardId) return toBase(ledger, d.obligation.amount ?? 0, accountCurrency(ledger, d.cardId));
  return expectedAmount(ledger, d.obligation);
}

/**
 * The payments of `today`'s month, in the settings' currency: what is still to
 * pay of what is due by the month's end (overdue ones from earlier months and
 * open card bills included), and what was already paid of what is due in it.
 * A bill paid without a linked transaction counts at its expected amount.
 */
export function monthPayments(ledger: Ledger, today: string): { toPay: number; paid: number; open: DueObligation[] } {
  const month = monthOf(today);
  const open = dueObligations(ledger, `${month}-31`, today);
  const toPay = open.reduce((sum, d) => sum + dueAmount(ledger, d), 0);
  let paid = 0;
  for (const o of ledger.obligations) {
    if (o.kind !== "payment") continue;
    for (const s of o.settled) {
      if (s.status !== "done" || monthOf(s.due) !== month) continue;
      const tx = s.transactionId ? ledger.transactions.find((x) => x.id === s.transactionId) : undefined;
      paid += tx ? baseAmount(ledger, tx) : expectedAmount(ledger, o);
    }
  }
  for (const a of ledger.accounts) {
    if (a.type !== "credit" || a.archived || !a.dueDay) continue;
    for (const offset of [-2, -1, 0]) {
      const bill = cardBill(ledger, a.id, today, offset);
      if (bill.due && monthOf(bill.due) === month && bill.total > 0) paid += toBase(ledger, bill.total - bill.remaining, a.currency);
    }
  }
  return { toPay, paid, open };
}

/** Days before a card bill's due date it is reminded of, like a new obligation's default. */
const CARD_BILL_REMIND_DAYS = 3;

/**
 * Credit card bills as obligations, for each card with a due day: the last
 * closed bill while part of it is unpaid, and the open bill as a projection of
 * what was charged so far. They are not stored; the amount is what is left to pay.
 */
export function cardBillObligations(ledger: Ledger, today: string): DueObligation[] {
  return ledger.accounts.flatMap((a) => {
    const dueDay = a.dueDay;
    if (a.type !== "credit" || a.archived || !dueDay) return [];
    const { closed, open } = cardBills(ledger, a.id, today);
    return [closed, open].flatMap((bill, i): DueObligation[] => {
      if (!bill.due || bill.remaining <= 0) return [];
      const projected = i === 1;
      const obligation: Obligation = {
        id: `card:${a.id}${projected ? ":open" : ""}`,
        name: t.obligations.cardBill(a.name),
        kind: "payment",
        frequency: "monthly",
        day: dueDay,
        since: bill.start,
        amount: bill.remaining,
        remindDays: CARD_BILL_REMIND_DAYS,
        settled: [],
      };
      return [projected ? { obligation, due: bill.due, cardId: a.id, projected } : { obligation, due: bill.due, cardId: a.id }];
    });
  });
}

/** Open occurrences of every obligation, card bills included, due on or before `until`, soonest first. */
export function dueObligations(ledger: Ledger, until: string, today: string): DueObligation[] {
  return [
    ...ledger.obligations.flatMap((obligation) => openOccurrences(obligation, until).map((due) => ({ obligation, due }))),
    ...cardBillObligations(ledger, today).filter((d) => d.due <= until),
  ].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.obligation.name.localeCompare(b.obligation.name)));
}

// ---- balance forecast ----

/** How far ahead an account's balance is forecast. */
export const FORECAST_DAYS = 60;

export interface ForecastEvent {
  /** overdue bills and rules still waiting for their bank charge count today */
  date: string;
  description: string;
  /** signed, in the account's currency */
  amount: number;
  /** the balance after this event */
  balance: number;
  /** a card bill not closed yet: what was charged so far */
  projected?: boolean;
}

export interface BalanceForecast {
  today: string;
  until: string;
  /** balance today */
  start: number;
  /** soonest first; on one day money comes in before it goes out */
  events: ForecastEvent[];
  end: number;
  /** lowest balance reached, and the first day it gets there */
  lowest: { date: string; balance: number };
  /** first day below zero */
  negativeOn?: string;
  /** open bills in the period with no amount known, left out of the sums */
  unpriced: string[];
}

/** The account a forecast opens on: the checking account with the most transactions, else any other that holds money. */
export function mainAccount(ledger: Ledger): Account | undefined {
  const used = (a: Account) => ledger.transactions.filter((tx) => tx.accountId === a.id || tx.toAccountId === a.id).length;
  const open = ledger.accounts.filter((a) => a.type !== "credit" && !a.archived);
  const pick = open.filter((a) => a.type === "checking");
  return (pick.length ? pick : open).reduce<Account | undefined>((best, a) => (!best || used(a) > used(best) ? a : best), undefined);
}

/**
 * An account's balance over the next days: today's, plus future transactions and
 * recurring occurrences on it. Bills and card bills say nothing about which account
 * pays them, so they all go out of the account being forecast. A card bill counts
 * as it is now, so later purchases and installments on later bills aren't in.
 */
export function balanceForecast(ledger: Ledger, accountId: string, today: string, days = FORECAST_DAYS): BalanceForecast {
  // no currency on an account or a bill means the settings' one
  const base = ledger.fx?.base ?? "";
  const currency = accountCurrency(ledger, accountId) ?? base;
  const until = toISODate(new Date(Date.parse(`${today}T12:00:00`) + days * 86_400_000));
  const events: Omit<ForecastEvent, "balance">[] = [];
  const unpriced: string[] = [];

  for (const tx of ledger.transactions) {
    const amount = effectOn(tx, accountId);
    if (amount !== 0 && tx.date > today && tx.date <= until) events.push({ date: tx.date, description: tx.description, amount });
  }

  // a rule on a synced account waits for the bank's charge, which stops being linked after LINK_DAYS
  const linkableFrom = toISODate(new Date(Date.parse(`${today}T12:00:00`) - LINK_DAYS * 86_400_000));
  for (const r of ledger.recurring) {
    const into = r.type === "transfer" && r.toAccountId === accountId;
    if (r.accountId !== accountId && !into) continue;
    const from = accountCurrency(ledger, r.accountId) ?? base;
    const amount = into ? convert(ledger, r.amount, from, currency) : r.type === "income" ? r.amount : -r.amount;
    const anchorDay = Number(r.startDate.slice(8, 10));
    let date = r.nextDate;
    // guard against a corrupted rule looping forever
    for (let i = 0; i < 1000 && date <= until; i++) {
      if (r.endDate && date > r.endDate) break;
      if (date >= linkableFrom) events.push({ date: date < today ? today : date, description: r.description, amount });
      date = nextOccurrence(date, r.frequency, anchorDay);
    }
  }

  const cardsPaidByRule = new Set(ledger.recurring.filter((r) => r.type === "transfer" && r.accountId === accountId).map((r) => r.toAccountId));
  const paidByRule = (o: Obligation) => o.settled.some((s) => ledger.transactions.find((tx) => tx.id === s.transactionId)?.recurringId);
  for (const d of dueObligations(ledger, until, today)) {
    if (d.obligation.kind !== "payment" || (d.cardId ? cardsPaidByRule.has(d.cardId) : paidByRule(d.obligation))) continue;
    const cost = dueAmount(ledger, d);
    if (cost <= 0) {
      unpriced.push(d.obligation.name);
      continue;
    }
    const event = { date: d.due < today ? today : d.due, description: d.obligation.name, amount: -convert(ledger, cost, base, currency) };
    events.push(d.projected ? { ...event, projected: true } : event);
  }

  events.sort((x, y) => (x.date === y.date ? y.amount - x.amount : x.date < y.date ? -1 : 1));
  const start = accountBalance(ledger, accountId, today);
  let balance = start;
  let lowest = { date: today, balance: start };
  let negativeOn = start < 0 ? today : undefined;
  const out = events.map((e): ForecastEvent => {
    balance += e.amount;
    if (balance < lowest.balance) lowest = { date: e.date, balance };
    if (balance < 0 && !negativeOn) negativeOn = e.date;
    return { ...e, balance };
  });
  return { today, until, start, events: out, end: balance, lowest, negativeOn, unpriced };
}

/** Open occurrences inside their reminder window on `today`, overdue ones included. */
export function obligationReminders(ledger: Ledger, today: string): DueObligation[] {
  const horizon = Math.max(CARD_BILL_REMIND_DAYS, ...ledger.obligations.map((o) => o.remindDays));
  const until = toISODate(new Date(Date.parse(`${today}T12:00:00`) + horizon * 86_400_000));
  // an open card bill is not reminded of: it closes, and is reminded of then
  return dueObligations(ledger, until, today).filter((d) => !d.projected && daysUntil(today, d.due) <= d.obligation.remindDays);
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

/** Ids of the transactions already linked to an obligation payment. */
function linkedPayments(ledger: Ledger): Set<string | undefined> {
  return new Set(ledger.obligations.flatMap((x) => x.settled.map((s) => s.transactionId)));
}

/** What the payment of an occurrence is expected to look like. */
function expectedPayment(o: Obligation, due: string): ExpectedTx {
  return { text: o.payee ? `${o.name} ${o.payee}` : o.name, amount: o.amount, date: due, maxDays: PAYMENT_SEARCH_DAYS };
}

/**
 * Transactions that may be the payment of an occurrence: money going out
 * (expenses and transfers, e.g. paying a card bill) near the due date and not
 * linked to another obligation yet. Likeliest first: same name, then closest
 * amount, then closest date.
 */
export function paymentCandidates(ledger: Ledger, o: Obligation, due: string): Transaction[] {
  const taken = linkedPayments(ledger);
  const own = settlementFor(o, due)?.transactionId;
  const expected = expectedPayment(o, due);
  return ledger.transactions
    .filter((tx) => tx.type !== "income" && (tx.id === own || !taken.has(tx.id)))
    .map((tx) => ({ tx, score: matchScore(tx, expected) }))
    .filter((x): x is { tx: Transaction; score: number } => x.score !== undefined)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.tx);
}

/**
 * Mark an occurrence paid by `tx`, on the day it happened, and remember it:
 * its description, so later payments that look like it are linked
 * automatically, and its amount as the usual one, to project the next.
 */
export function linkPayment(o: Obligation, due: string, tx: Transaction) {
  settleObligation(o, { due, status: "done", date: tx.date, transactionId: tx.id });
  tx.obligationId = o.id;
  learnPayment(o, tx);
}

/** Remember a payment's description and amount for the next ones. */
export function learnPayment(o: Obligation, tx: Transaction) {
  o.payee = tx.description;
  o.amount = tx.amount;
  if (!o.categoryId && tx.categoryId) o.categoryId = tx.categoryId;
}

/** The obligation occurrence a transaction paid, if it is linked to one. */
export function paymentOf(ledger: Ledger, txId: string): { obligation: Obligation; settlement: Settlement } | undefined {
  for (const obligation of ledger.obligations) {
    const settlement = obligation.settled.find((s) => s.transactionId === txId);
    if (settlement) return { obligation, settlement };
  }
  return undefined;
}

/** Days around a transaction searched for the bill it may have paid, when linking it by hand. */
const PAYABLE_DAYS = 45;

/**
 * For each payment obligation, the occurrence a transaction may have paid: the
 * one due closest to its date, within PAYABLE_DAYS, not linked to another
 * transaction yet. Likeliest first (same name, then amount, then date).
 */
export function payableOccurrences(ledger: Ledger, tx: Transaction): DueObligation[] {
  const out: { d: DueObligation; score: number }[] = [];
  if (tx.type === "income") return [];
  for (const obligation of ledger.obligations) {
    if (obligation.kind !== "payment" || obligation.archived) continue;
    let best: { d: DueObligation; score: number } | undefined;
    for (const due of dueDates(obligation)) {
      if (due > tx.date && daysBetween(due, tx.date) > PAYABLE_DAYS) break;
      const linked = settlementFor(obligation, due)?.transactionId;
      if (linked && linked !== tx.id) continue;
      const score = matchScore(tx, { ...expectedPayment(obligation, due), maxDays: PAYABLE_DAYS });
      if (score !== undefined && (!best || score < best.score)) best = { d: { obligation, due }, score };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => a.score - b.score).map((x) => x.d);
}

/**
 * Link the payments of obligations that were linked to a transaction before
 * (so they know what their payment looks like) to the transactions that look
 * like it: same words as that payment, near the due date, up to `today`.
 * Open occurrences are marked paid; ones already marked paid by hand, without
 * a transaction, get theirs too, so every month's payment is linked. Skipped
 * occurrences are left alone. Returns how many were linked.
 */
export function linkObligationPayments(ledger: Ledger, today: string): number {
  const taken = linkedPayments(ledger);
  const until = toISODate(new Date(Date.parse(`${today}T12:00:00`) + PAYMENT_SEARCH_DAYS * 86_400_000));
  let linked = 0;
  for (const o of ledger.obligations) {
    if (o.kind !== "payment" || o.archived) continue;
    // linked before descriptions were learned: learn the latest linked payment's
    if (!o.payee) {
      const last = [...o.settled].sort((a, b) => (a.due < b.due ? 1 : -1)).map((x) => ledger.transactions.find((tx) => tx.id === x.transactionId)).find((tx) => tx);
      if (!last) continue;
      o.payee = last.description;
    }
    for (const due of dueDates(o)) {
      if (due > until) break;
      const s = settlementFor(o, due);
      if (s && (s.status !== "done" || s.transactionId)) continue;
      const pool = ledger.transactions.filter((tx) => tx.type !== "income" && tx.date <= today && !taken.has(tx.id));
      const tx = bestMatch(pool, { ...expectedPayment(o, due), text: o.payee, requireName: true });
      if (!tx) continue;
      if (s) {
        // an older payment: link it without making it the one the next payments are expected to look like
        s.transactionId = tx.id;
        s.date = tx.date;
        tx.obligationId = o.id;
        if (!o.categoryId && tx.categoryId) o.categoryId = tx.categoryId;
      } else linkPayment(o, due, tx);
      taken.add(tx.id);
      linked++;
    }
  }
  tagBillPayments(ledger);
  return linked;
}

/**
 * Mark which bill each transaction pays, whatever month it was in: a payment
 * linked to an occurrence is that bill's, and an unmarked outgoing transaction
 * is the bill's it shares a word with (its name, its learned payment or the
 * payments linked to it) without a different category, at an amount within
 * LINK_NAMED_AMOUNT_TOLERANCE of the expected one, or, when no amount is
 * known, in the bill's own category. This covers payments from before the bill
 * was registered, which have no occurrence to settle. Returns how many were marked.
 */
export function tagBillPayments(ledger: Ledger): number {
  let tagged = 0;
  const byId = new Map(ledger.transactions.map((tx) => [tx.id, tx]));
  const bills: { o: Obligation; words: string[]; usual: number }[] = [];
  for (const o of ledger.obligations) {
    const texts = [o.name, o.payee ?? ""];
    for (const s of o.settled) {
      const tx = s.transactionId ? byId.get(s.transactionId) : undefined;
      if (!tx) continue;
      texts.push(tx.description);
      if (tx.obligationId === undefined) {
        tx.obligationId = o.id;
        tagged++;
      }
    }
    if (o.kind === "payment") bills.push({ o, words: texts.flatMap(words), usual: expectedAmount(ledger, o) });
  }
  for (const tx of ledger.transactions) {
    if (tx.obligationId !== undefined || tx.type === "income" || tx.recurringId) continue;
    const own = words(tx.description);
    let best: { o: Obligation; drift: number } | undefined;
    for (const { o, words: billWords, usual } of bills) {
      if (o.categoryId && tx.categoryId && o.categoryId !== tx.categoryId) continue;
      if (!billWords.some((w) => own.includes(w))) continue;
      if (!usual && (!o.categoryId || tx.categoryId !== o.categoryId)) continue;
      const drift = usual ? Math.abs(tx.amount - usual) / usual : 0;
      if (drift > LINK_NAMED_AMOUNT_TOLERANCE) continue;
      if (!best || drift < best.drift) best = { o, drift };
    }
    if (best) {
      tx.obligationId = best.o.id;
      tagged++;
    }
  }
  return tagged;
}

/** The bill a transaction pays, if any (see `Transaction.obligationId`). */
export function billOf(ledger: Ledger, tx: Transaction): Obligation | undefined {
  return tx.obligationId ? ledger.obligations.find((o) => o.id === tx.obligationId) : undefined;
}

/**
 * What identifies a description for learned categories: its words without
 * accents, digits or generic bank wording ("Pix", "Compra"), so "UBER *TRIP
 * 1234" and "Uber Trip 5678" share one. Undefined when nothing specific is left.
 */
export function descriptionKey(description: string): string | undefined {
  const key = words(description).filter((w) => !/\d/.test(w)).join(" ");
  return key || undefined;
}

/** The learned category for a new transaction, if its description has a rule of its kind. */
export function ruleCategory(ledger: Ledger, tx: Pick<Transaction, "type" | "description">): string | undefined {
  const key = descriptionKey(tx.description);
  if (!key || tx.type === "transfer") return undefined;
  const rule = ledger.categoryRules?.find((r) => r.key === key);
  const cat = rule && ledger.categories.find((c) => c.id === rule.categoryId);
  return cat && cat.kind === tx.type ? cat.id : undefined;
}

/**
 * The user put `tx` in `categoryId`: give every other transaction with the
 * same description key and kind that category too, past ones and, through a
 * learned rule, the ones still to come. Clearing the category only forgets
 * the rule. Returns how many other transactions changed.
 */
export function applyCategory(ledger: Ledger, tx: Transaction, categoryId: string | undefined): number {
  const key = descriptionKey(tx.description);
  if (!key || tx.type === "transfer") return 0;
  const rules = (ledger.categoryRules ?? []).filter((r) => r.key !== key);
  if (!categoryId) {
    ledger.categoryRules = rules.length ? rules : undefined;
    return 0;
  }
  ledger.categoryRules = [...rules, { key, categoryId }];
  let changed = 0;
  for (const other of ledger.transactions) {
    if (other.id === tx.id || other.type !== tx.type || other.categoryId === categoryId) continue;
    if (descriptionKey(other.description) !== key) continue;
    other.categoryId = categoryId;
    changed++;
  }
  return changed;
}

/** Forget a category's limits in every month's plan. */
export function dropBudgets(ledger: Ledger, categoryId: string) {
  ledger.budgets = ledger.budgets.filter((b) => b.categoryId !== categoryId);
  for (const p of Object.values(ledger.plans ?? {})) p.budgets = p.budgets.filter((b) => b.categoryId !== categoryId);
}

/** The category marked as default for `kind`, if any. */
export function defaultCategory(ledger: Ledger, kind: CategoryKind): Category | undefined {
  return ledger.categories.find((c) => c.kind === kind && c.isDefault);
}

/** Mark `categoryId` as its kind's default, unmarking the previous one. */
export function setDefaultCategory(ledger: Ledger, categoryId: string) {
  const cat = ledger.categories.find((c) => c.id === categoryId);
  if (!cat) return;
  for (const c of ledger.categories) if (c.kind === cat.kind) delete c.isDefault;
  cat.isDefault = true;
}

/**
 * Put uncategorized income/expense transactions and recurring rules in their kind's default
 * category, when there is one. Returns how many were changed.
 */
export function fillDefaultCategories(ledger: Ledger): number {
  const ids = { income: defaultCategory(ledger, "income")?.id, expense: defaultCategory(ledger, "expense")?.id };
  let changed = 0;
  for (const x of [...ledger.transactions, ...ledger.recurring]) {
    if (x.type === "transfer" || x.categoryId) continue;
    const id = ids[x.type];
    if (!id) continue;
    x.categoryId = id;
    changed++;
  }
  return changed;
}

/** Drop references to a deleted category so transactions show as uncategorized. */
export function removeCategory(ledger: Ledger, categoryId: string) {
  ledger.categories = ledger.categories.filter((c) => c.id !== categoryId);
  dropBudgets(ledger, categoryId);
  for (const tx of ledger.transactions) if (tx.categoryId === categoryId) delete tx.categoryId;
  for (const r of ledger.recurring) if (r.categoryId === categoryId) delete r.categoryId;
  for (const o of ledger.obligations) if (o.categoryId === categoryId) delete o.categoryId;
  if (ledger.categoryRules) ledger.categoryRules = ledger.categoryRules.filter((r) => r.categoryId !== categoryId);
}

export function accountInUse(ledger: Ledger, accountId: string): boolean {
  return (
    ledger.transactions.some((t) => t.accountId === accountId || t.toAccountId === accountId) ||
    ledger.recurring.some((r) => r.accountId === accountId || r.toAccountId === accountId)
  );
}
