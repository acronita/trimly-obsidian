import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountBalance,
  formatMoney,
  linkToRule,
  localeForCurrency,
  monthSummary,
  netWorth,
  nextOccurrence,
  parseAmount,
  parseLedger,
  postDueRecurring,
  removeCategory,
  spendingByCategory,
} from "../src/ledger.ts";
import type { Ledger } from "../src/ledger.ts";

function ledger(): Ledger {
  return {
    version: 1,
    accounts: [
      { id: "bank", name: "Bank", type: "checking", openingBalance: 100_00 },
      { id: "card", name: "Card", type: "credit", openingBalance: 0 },
    ],
    categories: [
      { id: "food", name: "Food", kind: "expense", color: "#000" },
      { id: "pay", name: "Salary", kind: "income", color: "#000" },
    ],
    transactions: [
      { id: "1", date: "2026-10-01", type: "income", amount: 5000_00, accountId: "bank", categoryId: "pay", description: "Salary" },
      { id: "2", date: "2026-10-03", type: "expense", amount: 50_00, accountId: "card", categoryId: "food", description: "Lunch" },
      { id: "3", date: "2026-10-10", type: "transfer", amount: 50_00, accountId: "bank", toAccountId: "card", description: "Pay card" },
      { id: "4", date: "2026-11-02", type: "expense", amount: 20_00, accountId: "bank", description: "Misc" },
    ],
    budgets: [],
    recurring: [],
    obligations: [],
    investments: { assets: [], snapshots: [], movements: [], targets: [] },
  };
}

test("parseAmount accepts both Brazilian and US formats", () => {
  assert.equal(parseAmount("1.234,56"), 123456);
  assert.equal(parseAmount("1,234.56"), 123456);
  assert.equal(parseAmount("12,5"), 1250);
  assert.equal(parseAmount("R$ 10"), 1000);
  assert.equal(parseAmount("1.000"), 100000);
  assert.equal(parseAmount("-3.10"), -310);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount(""), null);
});

test("balances follow transactions, transfers move money between accounts", () => {
  const l = ledger();
  assert.equal(accountBalance(l, "bank"), 100_00 + 5000_00 - 50_00 - 20_00);
  assert.equal(accountBalance(l, "card"), -50_00 + 50_00);
  assert.equal(accountBalance(l, "bank", "2026-10-31"), 100_00 + 5000_00 - 50_00);
  assert.equal(netWorth(l), 100_00 + 5000_00 - 50_00 - 20_00);
});

test("monthly summary excludes transfers, which are not income or spending", () => {
  assert.deepEqual(monthSummary(ledger(), "2026-10"), { income: 5000_00, expense: 50_00, net: 4950_00 });
});

test("spending groups by category, uncategorized under empty key", () => {
  const l = ledger();
  assert.deepEqual([...spendingByCategory(l, "2026-10")], [["food", 50_00]]);
  assert.deepEqual([...spendingByCategory(l, "2026-11")], [["", 20_00]]);
});

test("monthly rules keep their day, clamped to short months", () => {
  assert.equal(nextOccurrence("2026-01-31", "monthly", 31), "2026-02-28");
  assert.equal(nextOccurrence("2026-02-28", "monthly", 31), "2026-03-31");
  assert.equal(nextOccurrence("2026-12-15", "monthly", 15), "2027-01-15");
  assert.equal(nextOccurrence("2026-10-28", "weekly", 28), "2026-11-04");
  assert.equal(nextOccurrence("2024-02-29", "yearly", 29), "2025-02-28");
});

test("due recurring transactions post once each and advance", () => {
  const l = ledger();
  l.recurring.push({
    id: "rent",
    description: "Rent",
    type: "expense",
    amount: 1500_00,
    accountId: "bank",
    categoryId: "food",
    frequency: "monthly",
    startDate: "2026-08-05",
    nextDate: "2026-08-05",
    endDate: "2026-09-30",
  });
  const before = l.transactions.length;
  assert.equal(postDueRecurring(l, "2026-10-24"), 2); // Aug + Sep; Oct is past endDate
  assert.equal(l.transactions.length, before + 2);
  assert.equal(postDueRecurring(l, "2026-10-24"), 0); // running again must not duplicate
});

test("deleting a category uncategorizes its transactions instead of losing them", () => {
  const l = ledger();
  l.budgets.push({ categoryId: "food", limit: 100 });
  removeCategory(l, "food");
  assert.equal(l.transactions.length, 4);
  assert.equal(l.transactions[1].categoryId, undefined);
  assert.equal(l.budgets.length, 0);
});

test("parseLedger fills missing collections and refuses newer versions", () => {
  assert.deepEqual(parseLedger('{"version":1}').transactions, []);
  assert.throws(() => parseLedger('{"version":999}'));
});

test("ledgers from before category icons get default icons back, custom ones stay untouched", () => {
  const l = parseLedger(
    JSON.stringify({ version: 1, categories: [
      { id: "a", name: "Groceries", kind: "expense", color: "#000" },
      { id: "b", name: "Pets", kind: "expense", color: "#000" },
    ] })
  );
  assert.equal(l.categories[0].icon, "shopping-cart");
  assert.equal(l.categories[1].icon, undefined);
});

test("money uses the currency's own format, not the UI language's", () => {
  const brl = formatMoney(123456, "BRL", localeForCurrency("BRL", "en"));
  assert.match(brl, /1\.234,56/);
  assert.equal(localeForCurrency("XYZ", "en"), "en");
});

test("turning a transaction into a recurring rule links it and does not post it again", () => {
  const l = ledger();
  // "Lunch" on 2026-10-03 becomes a monthly rule starting that day
  const rule = {
    id: "lunch",
    description: "Lunch",
    type: "expense" as const,
    amount: 50_00,
    accountId: "card",
    categoryId: "food",
    frequency: "monthly" as const,
    startDate: "2026-10-03",
    nextDate: "2026-10-03",
  };
  l.recurring.push(rule);
  linkToRule(l, rule, "2");
  assert.equal(l.transactions.find((x) => x.id === "2")?.recurringId, "lunch");
  assert.equal(rule.nextDate, "2026-11-03");
  const before = l.transactions.length;
  assert.equal(postDueRecurring(l, "2026-10-24"), 0);
  assert.equal(l.transactions.length, before);
});
