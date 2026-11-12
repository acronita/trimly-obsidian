/**
 * Merges bank data fetched from Pluggy into the ledger.
 *
 * Pluggy re-creates credit card transactions with a new id when a bill closes,
 * so its ids are not permanent keys. Each sync instead treats Pluggy as the
 * source of truth for a recent window: transactions it no longer returns are
 * removed, and ones that came back with a new id are re-linked to the existing
 * entry so the user's category and notes survive.
 *
 * Kept free of Obsidian imports so it can be unit tested in Node.
 */
import { accountBalance, convert, daysBetween, defaultCategoryKey, installmentFromDescription, newId, ruleCategory, shiftMonth } from "./ledger.ts";
import type { Account, AccountType, DefaultCategory, Ledger, Transaction, TxType } from "./ledger.ts";

/** How far back each sync reconciles: synced transactions in it that Pluggy no longer returns are removed. */
export const SYNC_WINDOW_DAYS = 90;
/** How far back each sync fetches, so older history is imported too (Open Finance keeps 12 months). */
export const SYNC_HISTORY_DAYS = 365;
/** Max days between the two legs of a transfer between own accounts. */
const TRANSFER_MATCH_DAYS = 5;
/** Max date drift when re-linking a transaction that came back with a new id. */
const RELINK_DAYS = 7;

export interface PluggyAccount {
  id: string;
  type: "BANK" | "CREDIT";
  subtype?: string;
  name: string;
  marketingName?: string | null;
  /** bank: signed balance; credit card: amount owed */
  balance: number;
  /** ISO 4217 code of the balance and of transactions without amountInAccountCurrency */
  currencyCode?: string | null;
  /** credit cards: ISO dates of the current bill's closing and due day, and the limit */
  creditData?: { balanceCloseDate?: string | null; balanceDueDate?: string | null; creditLimit?: number | null } | null;
}

export interface PluggyTransaction {
  id: string;
  accountId: string;
  /** ISO timestamp, midnight UTC of the transaction day */
  date: string;
  description: string;
  /** bank: sign varies, use `type`; credit card: purchases positive, payments negative */
  amount: number;
  type: "DEBIT" | "CREDIT";
  status?: "PENDING" | "POSTED";
  /** ISO 4217 code of `amount` */
  currencyCode?: string | null;
  /** `amount` converted to the account's currency, when the transaction was made in another one */
  amountInAccountCurrency?: number | null;
  categoryId?: string | null;
  /** credit cards: installment purchases carry which installment this charge is */
  creditCardMetadata?: {
    installmentNumber?: number | null;
    totalInstallments?: number | null;
    /** "YYYY-MM": month the charge's bill closes in; some banks (Rico) give an installment the 1st installment's */
    billForecastDate?: string | null;
    purchaseDate?: string | null;
  } | null;
}

export interface PluggyBill {
  id: string;
  /** set by the client: Pluggy lists bills per account */
  accountId: string;
  /** ISO timestamps */
  dueDate: string;
  billClosingDate?: string | null;
}

export interface PluggyCategory {
  id: string;
  description: string;
  parentId?: string | null;
}

export interface BankData {
  accounts: PluggyAccount[];
  transactions: PluggyTransaction[];
  /** credit card bills; missing for cards whose bank does not report them */
  bills?: PluggyBill[];
  /** empty when the Pluggy plan has no categorization */
  categories: PluggyCategory[];
}

export interface SyncResult {
  accountsCreated: number;
  added: number;
  updated: number;
  removed: number;
}

/** Pluggy category (any level, Pluggy's English description) -> Trimly starter category. */
const CATEGORY_MAP: Record<string, DefaultCategory> = {
  Salary: "salary",
  "Entrepreneurial activities": "freelance",
  "Proceeds interests and dividends": "investments",
  Income: "otherIncome",
  Utilities: "utilities",
  Telecommunications: "utilities",
  Education: "education",
  "Wellness and fitness": "health",
  Tickets: "entertainment",
  Housing: "housing",
  Groceries: "groceries",
  "Food and drinks": "dining",
  Transportation: "transport",
  Healthcare: "health",
  Shopping: "shopping",
  "Digital services": "entertainment",
};

/** Categories marking money moved between the user's own accounts. */
const OWN_TRANSFER = ["Same person transfer", "Credit card payment"];

/** One side of a bank movement, from the Trimly account's point of view. */
interface Leg {
  pid: string;
  accountId: string;
  onCard: boolean;
  date: string;
  /** signed cents: positive = money into the account */
  cents: number;
  /** what was spent in another currency, when it differs from the account's */
  original?: Transaction["original"];
  description: string;
  pending: boolean;
  /** category descriptions, leaf first; empty when uncategorized */
  path: string[];
  installment?: Transaction["installment"];
  billMonth?: string;
}

/** What the ledger should contain for one or two legs. */
interface Rec {
  pids: string[];
  type: TxType;
  amount: number;
  accountId: string;
  toAccountId?: string;
  date: string;
  description: string;
  pending: boolean;
  path: string[];
  original?: Transaction["original"];
  installment?: Transaction["installment"];
  billMonth?: string;
}

function cents(value: number): number {
  return Math.round(Math.abs(value) * 100);
}

function accountType(p: PluggyAccount): AccountType {
  if (p.type === "CREDIT") return "credit";
  return p.subtype === "SAVINGS_ACCOUNT" ? "savings" : "checking";
}

function categoryPath(categories: Map<string, PluggyCategory>, id?: string | null): string[] {
  const path: string[] = [];
  // bounded walk in case of a cycle in the category tree
  for (let c = id ? categories.get(id) : undefined; c && path.length < 5; c = c.parentId ? categories.get(c.parentId) : undefined) {
    path.push(c.description);
  }
  return path;
}

/** Which installment a card purchase is: Pluggy's metadata, else the mark in its description. */
function installmentOf(t: PluggyTransaction): Transaction["installment"] {
  const number = t.creditCardMetadata?.installmentNumber;
  const total = t.creditCardMetadata?.totalInstallments;
  if (number && total && total > 1 && number <= total) return { number, total };
  return installmentFromDescription(t.description);
}

function isOwnTransfer(leg: Leg): boolean {
  return leg.path.some((d) => OWN_TRANSFER.includes(d));
}

/**
 * Pair a bank debit with the matching credit on another own account into one
 * transfer. Without this, paying the card bill counts every purchase twice.
 * A card payment pairs when neither side is categorized, one side says it is
 * a transfer, or the card's side is under Transfers at all (C6 reports only its
 * own copy, "Inclusao de Pagamento Ciclo Corrente", there); a bank-to-bank move only pairs when Pluggy says it is a
 * same-person transfer, since equal amounts between banks are often unrelated.
 * Some banks (C6, Nubank) report a paid bill on the card a second time, under
 * another name and any category; that copy is dropped, or it would count as income.
 * Debits with the fewest possible credits pair first: when money passes through
 * an account (A -> B -> C), A's debit could also take C's credit, which would
 * leave B's debit, barred from B's own credit, with no partner.
 */
function pairTransfers(legs: Leg[]): Rec[] {
  const ins = legs.filter((l) => l.cents > 0);
  const canPair = (out: Leg, inn: Leg): boolean => {
    if (inn.accountId === out.accountId || inn.cents !== -out.cents) return false;
    if (daysBetween(inn.date, out.date) > TRANSFER_MATCH_DAYS) return false;
    const ownTransfer = isOwnTransfer(out) || isOwnTransfer(inn);
    return inn.onCard
      ? ownTransfer || inn.path.includes("Transfers") || (out.path.length === 0 && inn.path.length === 0)
      : ownTransfer;
  };
  const debits = legs
    .filter((l) => l.cents < 0 && !l.onCard)
    .map((out) => ({ out, options: ins.filter((inn) => canPair(out, inn)) }))
    .sort((a, b) => a.options.length - b.options.length);
  const used = new Set<Leg>();
  const payments: Leg[] = [];
  const recs: Rec[] = [];
  for (const { out, options } of debits) {
    let best: Leg | null = null;
    for (const inn of options) {
      if (used.has(inn)) continue;
      if (!best || daysBetween(inn.date, out.date) < daysBetween(best.date, out.date)) best = inn;
    }
    if (!best) continue;
    used.add(out).add(best);
    if (best.onCard) payments.push(best);
    recs.push({
      pids: [out.pid, best.pid],
      type: "transfer",
      amount: best.cents,
      accountId: out.accountId,
      toAccountId: best.accountId,
      date: out.date,
      description: out.description,
      pending: out.pending || best.pending,
      path: [],
    });
  }
  const copied = new Set<Leg>();
  for (const l of legs) {
    if (used.has(l)) continue;
    if (l.onCard && l.cents > 0) {
      const paid = payments.find(
        (p) => !copied.has(p) && p.accountId === l.accountId && p.cents === l.cents && daysBetween(p.date, l.date) <= TRANSFER_MATCH_DAYS
      );
      if (paid) {
        copied.add(paid);
        continue;
      }
    }
    recs.push({
      pids: [l.pid],
      type: l.cents > 0 ? "income" : "expense",
      amount: Math.abs(l.cents),
      accountId: l.accountId,
      date: l.date,
      description: l.description,
      pending: l.pending,
      path: l.path,
      original: l.original,
      installment: l.installment,
      billMonth: l.billMonth,
    });
  }
  return recs;
}

function mapCategory(ledger: Ledger, rec: Rec): string | undefined {
  if (rec.type === "transfer") return undefined;
  const kind = rec.type === "income" ? "income" : "expense";
  for (const d of rec.path) {
    const key = CATEGORY_MAP[d];
    const cat = key && ledger.categories.find((c) => c.kind === kind && defaultCategoryKey(c) === key);
    if (cat) return cat.id;
  }
  return undefined;
}

/** Point an existing transaction at `rec`. Description, category and notes stay the user's. */
function relink(tx: Transaction, rec: Rec): boolean {
  const before = JSON.stringify(tx);
  tx.date = rec.date;
  tx.amount = rec.amount;
  tx.pluggyIds = rec.pids;
  if (rec.pending) tx.pending = true;
  else delete tx.pending;
  if (rec.original) tx.original = rec.original;
  else delete tx.original;
  if (rec.installment) tx.installment = rec.installment;
  else delete tx.installment;
  if (rec.billMonth) tx.billMonth = rec.billMonth;
  else delete tx.billMonth;
  if (tx.type !== rec.type || tx.accountId !== rec.accountId || tx.toAccountId !== rec.toAccountId) {
    tx.type = rec.type;
    tx.accountId = rec.accountId;
    if (rec.toAccountId) tx.toAccountId = rec.toAccountId;
    else delete tx.toAccountId;
    // a category of the other kind would be wrong now
    delete tx.categoryId;
  }
  return JSON.stringify(tx) !== before;
}

/**
 * Merge `data` into the ledger: create Trimly accounts for new Pluggy accounts,
 * add or re-link every fetched transaction, remove the synced ones dated
 * `windowStart` or later that Pluggy no longer returns, and
 * set each synced account's opening balance so its balance today matches the bank.
 * Mutates the ledger.
 */
export function applyBankData(ledger: Ledger, data: BankData, windowStart: string, today: string): SyncResult {
  const result: SyncResult = { accountsCreated: 0, added: 0, updated: 0, removed: 0 };

  const byPluggyId = new Map<string, Account>();
  for (const p of data.accounts) {
    let acc = ledger.accounts.find((a) => a.pluggyId === p.id);
    if (!acc) {
      acc = { id: newId(), name: p.marketingName || p.name, type: accountType(p), openingBalance: 0, pluggyId: p.id };
      ledger.accounts.push(acc);
      result.accountsCreated++;
    }
    // the bank's days only fill in blanks, so a day the user set by hand stays
    const closeDay = Number(p.creditData?.balanceCloseDate?.slice(8, 10));
    const dueDay = Number(p.creditData?.balanceDueDate?.slice(8, 10));
    if (acc.type === "credit" && !acc.closingDay && closeDay) acc.closingDay = closeDay;
    if (acc.type === "credit" && !acc.dueDay && dueDay) acc.dueDay = dueDay;
    // the limit changes on the bank's side (raises), so the bank's value always wins
    if (acc.type === "credit" && p.creditData?.creditLimit) acc.creditLimit = cents(p.creditData.creditLimit);
    if (p.currencyCode) acc.currency = p.currencyCode;
    byPluggyId.set(p.id, acc);
  }

  // the bank's bill dates: past bills from the bills list, the open one from the card;
  // a bill seen again (same due date) takes its latest closing date
  const billDates = (acc: Account | undefined, close?: string | null, due?: string | null) => {
    if (acc?.type !== "credit" || !close || !due) return;
    const bill = { close: close.slice(0, 10), due: due.slice(0, 10) };
    acc.billDates = [...(acc.billDates ?? []).filter((d) => d.due !== bill.due), bill].sort((x, y) => (x.close < y.close ? -1 : 1));
  };
  for (const b of data.bills ?? []) billDates(byPluggyId.get(b.accountId), b.billClosingDate, b.dueDate);
  for (const p of data.accounts) billDates(byPluggyId.get(p.id), p.creditData?.balanceCloseDate, p.creditData?.balanceDueDate);

  const categories = new Map(data.categories.map((c) => [c.id, c]));
  const legs: Leg[] = [];
  for (const t of data.transactions) {
    const acc = byPluggyId.get(t.accountId);
    if (!acc) continue;
    const onCard = acc.type === "credit";
    const moneyIn = onCard ? t.amount < 0 : t.type === "CREDIT";
    // a purchase abroad: Pluggy's amount is in the purchase's currency, the account was charged the converted one
    const foreign = !!t.currencyCode && !!acc.currency && t.currencyCode !== acc.currency;
    // without Pluggy's conversion, fall back to the stored rates
    const charged = !foreign
      ? cents(t.amount)
      : t.amountInAccountCurrency != null
        ? cents(t.amountInAccountCurrency)
        : convert(ledger, cents(t.amount), t.currencyCode!, acc.currency!);
    const installment = onCard && !moneyIn ? installmentOf(t) : undefined;
    // the bill the bank put the charge on, since some banks date installments on the purchase day; banks that
    // give a later installment the purchase's month (Rico) mean the 1st installment's bill, a month per installment back
    const meta = t.creditCardMetadata;
    const forecast = meta?.billForecastDate?.slice(0, 7);
    const back = installment && installment.number > 1 && meta?.purchaseDate?.slice(0, 7) === forecast ? installment.number - 1 : 0;
    const billMonth = onCard && forecast && /^\d{4}-\d{2}$/.test(forecast) ? shiftMonth(forecast, back) : undefined;
    legs.push({
      pid: t.id,
      accountId: acc.id,
      onCard,
      date: t.date.slice(0, 10),
      billMonth,
      cents: moneyIn ? charged : -charged,
      original: foreign ? { currency: t.currencyCode!, amount: cents(t.amount) } : undefined,
      description: t.description,
      pending: t.status === "PENDING",
      path: categoryPath(categories, t.categoryId),
      installment,
    });
  }
  const recs = pairTransfers(legs);

  const synced = new Set([...byPluggyId.values()].map((a) => a.id));
  const byPid = new Map<string, Transaction>();
  for (const tx of ledger.transactions) for (const pid of tx.pluggyIds ?? []) byPid.set(pid, tx);
  const matched = new Set<Transaction>();

  const unmatched: Rec[] = [];
  for (const rec of recs) {
    const tx = rec.pids.map((pid) => byPid.get(pid)).find((t) => t && !matched.has(t));
    if (!tx) {
      unmatched.push(rec);
      continue;
    }
    matched.add(tx);
    if (relink(tx, rec)) result.updated++;
  }

  // any date may be re-linked, since the fetch reaches further back than the window
  const stale = ledger.transactions.filter(
    (t) => t.pluggyIds?.length && !matched.has(t) && (synced.has(t.accountId) || synced.has(t.toAccountId ?? ""))
  );
  for (const rec of unmatched) {
    let best: Transaction | null = null;
    for (const t of stale) {
      if (matched.has(t) || t.type !== rec.type || t.amount !== rec.amount) continue;
      if (t.accountId !== rec.accountId || t.toAccountId !== rec.toAccountId) continue;
      if (daysBetween(t.date, rec.date) > RELINK_DAYS) continue;
      if (!best || daysBetween(t.date, rec.date) < daysBetween(best.date, rec.date)) best = t;
    }
    if (best) {
      matched.add(best);
      relink(best, rec);
      result.updated++;
      continue;
    }
    const tx: Transaction = {
      id: newId(),
      date: rec.date,
      type: rec.type,
      amount: rec.amount,
      accountId: rec.accountId,
      description: rec.description,
      pluggyIds: rec.pids,
    };
    if (rec.toAccountId) tx.toAccountId = rec.toAccountId;
    if (rec.original) tx.original = rec.original;
    if (rec.installment) tx.installment = rec.installment;
    if (rec.billMonth) tx.billMonth = rec.billMonth;
    const categoryId = ruleCategory(ledger, tx) ?? mapCategory(ledger, rec);
    if (categoryId) tx.categoryId = categoryId;
    if (rec.pending) tx.pending = true;
    ledger.transactions.push(tx);
    result.added++;
  }

  const gone = new Set(stale.filter((t) => !matched.has(t) && t.date >= windowStart));
  if (gone.size) {
    ledger.transactions = ledger.transactions.filter((t) => !gone.has(t));
    result.removed = gone.size;
  }

  for (const p of data.accounts) {
    const acc = byPluggyId.get(p.id);
    if (!acc) continue;
    const target = Math.round(p.balance * 100) * (acc.type === "credit" ? -1 : 1);
    acc.openingBalance = 0;
    acc.openingBalance = target - accountBalance(ledger, acc.id, today);
  }

  return result;
}
