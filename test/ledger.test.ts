import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountBalance,
  applyCategory,
  fillDefaultCategories,
  setDefaultCategory,
  budgetFor,
  editBudget,
  ruleCategory,
  contributionsInMonth,
  fixedMonthlyIncome,
  monthPlan,
  formatMoney,
  linkToRule,
  localeForCurrency,
  monthSummary,
  netWorth,
  nextOccurrence,
  parseAmount,
  parseLedger,
  pendingRecurringIncome,
  postDueRecurring,
  removeCategory,
  removeRecurring,
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

test("a salary not yet received still counts toward the month it is due, so the overview isn't negative until payday", () => {
  const l = ledger();
  l.recurring.push({ id: "sal", description: "Salary", type: "income", amount: 6000_00, accountId: "bank", frequency: "monthly", startDate: "2026-09-30", nextDate: "2026-10-30" });
  l.recurring.push({ id: "rent", description: "Rent", type: "expense", amount: 2000_00, accountId: "bank", frequency: "monthly", startDate: "2026-09-05", nextDate: "2026-11-05" });
  assert.equal(pendingRecurringIncome(l, "2026-10"), 6000_00);
  assert.equal(pendingRecurringIncome(l, "2026-11"), 6000_00); // next payday, once October's is in
  assert.equal(pendingRecurringIncome(l, "2026-09"), 0); // past months show only what happened
  // once received, the rule moves on and the month's income is no longer counted twice
  postDueRecurring(l, "2026-10-30");
  assert.equal(pendingRecurringIncome(l, "2026-10"), 0);
});

test("pending income stops at the rule's end date and counts every weekly occurrence left", () => {
  const l = ledger();
  l.recurring.push({ id: "w", description: "Gig", type: "income", amount: 100_00, accountId: "bank", frequency: "weekly", startDate: "2026-10-02", nextDate: "2026-10-09", endDate: "2026-10-23" });
  assert.equal(pendingRecurringIncome(l, "2026-10"), 300_00); // 9, 16, 23; 30 is past endDate
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

test("a default category takes in uncategorized items of its kind only, so nothing reads 'Sem categoria'", () => {
  const l = ledger();
  l.categories.push({ id: "other", name: "Other", kind: "expense", color: "#000" });
  l.transactions.push(
    { id: "u1", date: "2026-03-05", type: "expense", amount: 10_00, accountId: "bank", description: "?" },
    { id: "u2", date: "2026-03-06", type: "income", amount: 10_00, accountId: "bank", description: "?" }
  );
  // no default yet: stays uncategorized
  assert.equal(fillDefaultCategories(l), 0);
  setDefaultCategory(l, "other");
  assert.ok(fillDefaultCategories(l) >= 1);
  assert.equal(l.transactions.find((tx) => tx.id === "u1")?.categoryId, "other");
  // income has no default, and transfers never get a category
  assert.equal(l.transactions.find((tx) => tx.id === "u2")?.categoryId, undefined);
  for (const tx of l.transactions) if (tx.type === "transfer") assert.equal(tx.categoryId, undefined);
});

test("only one default category per kind", () => {
  const l = ledger();
  l.categories.push({ id: "other", name: "Other", kind: "expense", color: "#000" });
  setDefaultCategory(l, "food");
  setDefaultCategory(l, "pay");
  setDefaultCategory(l, "other");
  assert.deepEqual(l.categories.filter((c) => c.isDefault).map((c) => c.id).sort(), ["other", "pay"]);
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

test("deleting a rule keeps its transactions but unlinks them", () => {
  // a wrongly linked transaction is fixed by deleting the rule; a dangling link would keep the
  // repeat icon and hide it from the rule made again
  const l = ledger();
  const rule = { id: "lunch", description: "Lunch", type: "expense" as const, amount: 25_00, accountId: "bank", frequency: "monthly" as const, startDate: "2026-10-03", nextDate: "2026-10-03" };
  l.recurring.push(rule);
  linkToRule(l, rule, "2");
  const before = l.transactions.length;
  removeRecurring(l, "lunch");
  assert.equal(l.recurring.length, 0);
  assert.equal(l.transactions.length, before);
  assert.ok(l.transactions.every((x) => !x.recurringId));
});

test("fixed income is what active income rules bring in per month, the budget's yardstick", () => {
  const l = ledger();
  l.recurring.push(
    { id: "s", description: "Salary", type: "income", amount: 6000_00, accountId: "bank", frequency: "monthly", startDate: "2026-01-05", nextDate: "2026-11-05" },
    { id: "b", description: "Bonus", type: "income", amount: 1200_00, accountId: "bank", frequency: "yearly", startDate: "2026-12-20", nextDate: "2026-12-20" },
    { id: "rent", description: "Rent", type: "expense", amount: 2000_00, accountId: "bank", frequency: "monthly", startDate: "2026-01-10", nextDate: "2026-11-10" },
    // an ended job no longer funds the budget
    { id: "old", description: "Old job", type: "income", amount: 3000_00, accountId: "bank", frequency: "monthly", startDate: "2025-01-05", nextDate: "2026-07-05", endDate: "2026-06-30" }
  );
  assert.equal(fixedMonthlyIncome(l), 6000_00 + 100_00);
});

test("investing toward the monthly goal counts aportes, never spending", () => {
  const l = ledger();
  l.investments.movements.push(
    { id: "a", assetId: "x", date: "2026-10-05", type: "buy", amount: 500_00 },
    { id: "b", assetId: "x", date: "2026-10-20", type: "buy", amount: 300_00 },
    { id: "c", assetId: "x", date: "2026-10-25", type: "sell", amount: 100_00 },
    { id: "d", assetId: "x", date: "2026-09-30", type: "buy", amount: 999_00 }
  );
  assert.equal(contributionsInMonth(l, "2026-10"), 800_00);
  // the budget's spending total is untouched by aportes
  assert.equal([...spendingByCategory(l, "2026-10").values()].reduce((s, v) => s + v, 0), 50_00);
});

test("each month keeps its own plan: a new month starts from the last one, and editing it leaves history alone", () => {
  const l = ledger();
  // limits from before plans were per month are where every month starts
  l.budgets.push({ categoryId: "food", limit: 500_00 });
  editBudget(l, "2026-09", (b) => (b.investmentGoal = 1000_00));
  assert.deepEqual(budgetFor(l, "2026-09"), { budgets: [{ categoryId: "food", limit: 500_00 }], investmentGoal: 1000_00 });
  // October has no plan yet: it is September's
  assert.deepEqual(budgetFor(l, "2026-10"), budgetFor(l, "2026-09"));
  editBudget(l, "2026-10", (b) => {
    b.budgets = [{ categoryId: "food", limit: 700_00 }];
    b.investmentGoal = 1500_00;
  });
  // September is history: it keeps what was planned then
  assert.deepEqual(budgetFor(l, "2026-09"), { budgets: [{ categoryId: "food", limit: 500_00 }], investmentGoal: 1000_00 });
  assert.equal(budgetFor(l, "2026-12").investmentGoal, 1500_00);
  assert.equal(budgetFor(l, "2026-08").investmentGoal, undefined);
  // a plan survives a save and load
  assert.deepEqual(parseLedger(JSON.stringify(l)).plans, l.plans);
  // a deleted category leaves every month's plan
  removeCategory(l, "food");
  assert.deepEqual(budgetFor(l, "2026-09").budgets, []);
  assert.deepEqual(budgetFor(l, "2026-10").budgets, []);
});

test("the month's plan keeps fixed costs out of the category limits, so a health plan is not double counted", () => {
  const l = ledger();
  l.categories.push({ id: "health", name: "Health", kind: "expense", color: "#000" });
  l.recurring.push(
    { id: "s", description: "Salary", type: "income", amount: 5000_00, accountId: "bank", categoryId: "pay", frequency: "monthly", startDate: "2026-01-01", nextDate: "2026-11-01" },
    { id: "hp", description: "Health plan", type: "expense", amount: 500_00, accountId: "bank", categoryId: "health", frequency: "monthly", startDate: "2026-01-15", nextDate: "2026-11-15" }
  );
  l.transactions.push(
    { id: "hp-oct", date: "2026-10-15", type: "expense", amount: 500_00, accountId: "bank", categoryId: "health", description: "Health plan", recurringId: "hp" },
    { id: "pharm", date: "2026-10-18", type: "expense", amount: 80_00, accountId: "bank", categoryId: "health", description: "Pharmacy" },
    { id: "water", date: "2026-10-20", type: "expense", amount: 90_00, accountId: "bank", description: "Water" }
  );
  l.obligations.push({ id: "w", name: "Water", kind: "payment", frequency: "monthly", day: 20, since: "2026-01-01", amount: 100_00, remindDays: 3, settled: [{ due: "2026-10-20", status: "done", date: "2026-10-20", transactionId: "water" }] });
  editBudget(l, "2026-10", (b) => {
    b.budgets = [{ categoryId: "health", limit: 100_00 }, { categoryId: "food", limit: 600_00 }];
    b.investmentGoal = 1500_00;
  });
  l.investments.movements.push({ id: "a", assetId: "x", date: "2026-10-06", type: "buy", amount: 1000_00 });

  const p = monthPlan(l, "2026-10");
  assert.deepEqual(pa(p.income), { planned: 5000_00, actual: 5000_00 });
  assert.deepEqual(pa(p.fixed), { planned: 500_00, actual: 500_00 });
  assert.equal(p.fixedByCategory.get("health"), 500_00);
  assert.equal(p.bills.actual, 90_00); // settles an obligation: a bill, not day-to-day spending
  // the pharmacy and lunch are what the limits cover; the health plan is not
  assert.deepEqual(pa(p.spending), { planned: 700_00, actual: 80_00 + 50_00 });
  assert.deepEqual(pa(p.invest), { planned: 1500_00, actual: 1000_00 });
});

test("a fixed-amount bill with a category counts with fixed costs and in its category, not against the limit", () => {
  const l = ledger();
  l.categories.push({ id: "health", name: "Health", kind: "expense", color: "#000" });
  l.obligations.push(
    { id: "hp", name: "Health plan", kind: "payment", frequency: "monthly", day: 15, since: "2026-01-01", amount: 500_00, remindDays: 3, fixed: true, categoryId: "health", settled: [{ due: "2026-10-15", status: "done", date: "2026-10-15", transactionId: "hp-oct" }] },
    { id: "light", name: "Light", kind: "payment", frequency: "monthly", day: 10, since: "2026-01-01", amount: 150_00, remindDays: 3, settled: [] }
  );
  l.transactions.push({ id: "hp-oct", date: "2026-10-15", type: "expense", amount: 500_00, accountId: "bank", categoryId: "health", description: "Health plan" });
  const p = monthPlan(l, "2026-10");
  assert.deepEqual(pa(p.fixed), { planned: 500_00, actual: 500_00 });
  assert.equal(p.bills.planned, 150_00);
  assert.equal(p.fixedByCategory.get("health"), 500_00);
  assert.equal(p.spending.actual, 50_00); // only the lunch
});

test("changing a transaction's category moves its look-alikes and the next ones, but not generic bank wording", () => {
  const l = ledger();
  l.categories.push({ id: "transport", name: "Transport", kind: "expense", color: "#000" });
  l.transactions.push(
    { id: "u1", date: "2026-09-02", type: "expense", amount: 20_00, accountId: "card", categoryId: "food", description: "UBER *TRIP 1234" },
    { id: "u2", date: "2026-10-04", type: "expense", amount: 25_00, accountId: "card", description: "Uber Trip 5678" },
    { id: "pix", date: "2026-10-05", type: "expense", amount: 30_00, accountId: "bank", description: "Pix enviado" }
  );
  const u2 = l.transactions.find((x) => x.id === "u2")!;
  u2.categoryId = "transport";
  assert.equal(applyCategory(l, u2, "transport"), 1);
  assert.equal(l.transactions.find((x) => x.id === "u1")?.categoryId, "transport");
  // a ride synced later lands in the same category
  assert.equal(ruleCategory(l, { type: "expense", description: "UBER *TRIP 9999" }), "transport");
  // income with the same words is not an expense category's
  assert.equal(ruleCategory(l, { type: "income", description: "Uber Trip" }), undefined);
  // "Pix enviado" names nobody: no rule, nothing else changes
  const pix = l.transactions.find((x) => x.id === "pix")!;
  assert.equal(applyCategory(l, pix, "food"), 0);
  assert.equal(ruleCategory(l, { type: "expense", description: "Pix enviado" }), undefined);
  // deleting the category forgets its rule
  removeCategory(l, "transport");
  assert.equal(ruleCategory(l, { type: "expense", description: "UBER *TRIP 1" }), undefined);
});

test("a bill payment from before the bill was registered counts with its bill in that month's plan", () => {
  const l = ledger();
  l.obligations.push({ id: "hp", name: "Health plan", kind: "payment", frequency: "monthly", day: 15, since: "2026-11-01", amount: 500_00, remindDays: 3, fixed: true, payee: "UNIMED", settled: [] });
  l.transactions.push({ id: "hp-oct", date: "2026-10-15", type: "expense", amount: 500_00, accountId: "bank", description: "UNIMED", obligationId: "hp" });
  const p = monthPlan(l, "2026-10");
  assert.equal(p.fixed.actual, 500_00);
  assert.equal(p.spending.actual, 50_00);
});

/** A plan line without its projection, for checks about what was planned and what happened. */
function pa(l: { planned: number; actual: number }) {
  return { planned: l.planned, actual: l.actual };
}

test("the forecast tells how much is really left to invest once what is still due this month is paid", () => {
  const l = ledger();
  l.categories.push({ id: "health", name: "Health", kind: "expense", color: "#000" });
  l.recurring.push(
    // payday still to come this month
    { id: "s", description: "Salary", type: "income", amount: 5000_00, accountId: "bank", frequency: "monthly", startDate: "2026-01-28", nextDate: "2026-10-28" },
    { id: "rent", description: "Rent", type: "expense", amount: 2000_00, accountId: "bank", frequency: "monthly", startDate: "2026-01-25", nextDate: "2026-10-25" }
  );
  // electricity not paid yet this month, at its usual amount
  l.obligations.push({ id: "light", name: "Light", kind: "payment", frequency: "monthly", day: 26, since: "2026-01-01", amount: 150_00, remindDays: 3, settled: [] });
  editBudget(l, "2026-10", (b) => {
    b.budgets = [{ categoryId: "food", limit: 600_00 }];
    b.investmentGoal = 3000_00;
  });
  const p = monthPlan(l, "2026-10", "2026-10-20");
  // the October salary already in plus the payday to come
  assert.equal(p.income.projected, 5000_00 + 5000_00);
  assert.equal(p.fixed.projected, 2000_00);
  assert.equal(p.bills.projected, 150_00);
  // 50 spent on food, and what is left of its 600 limit is assumed spent too
  assert.equal(p.spending.projected, 600_00);
  assert.equal(p.invest.projected, 3000_00);

  // once the month is over, nothing more is assumed for the limits
  assert.equal(monthPlan(l, "2026-10", "2026-11-05").spending.projected, 50_00);
});

test("category spending splits by category, so the bars show which categories grow past their limit", () => {
  const l = ledger();
  l.categories.push({ id: "fun", name: "Fun", kind: "expense", color: "#000" });
  l.transactions.push({ id: "bar", date: "2026-10-12", type: "expense", amount: 300_00, accountId: "card", categoryId: "fun", description: "Bar" });
  editBudget(l, "2026-10", (b) => (b.budgets = [{ categoryId: "food", limit: 200_00 }]));
  const p = monthPlan(l, "2026-10", "2026-10-20");
  // food: 50 of its 200 spent, the rest still expected
  assert.deepEqual(p.spendingByCategory.get("food"), { planned: 200_00, actual: 50_00, projected: 200_00 });
  // fun has no limit (zero): what was spent is all of it
  assert.deepEqual(p.spendingByCategory.get("fun"), { planned: 0, actual: 300_00, projected: 300_00 });
  // the split adds up to the category spending line
  const sum = [...p.spendingByCategory.values()].reduce((s, x) => s + x.projected, 0);
  assert.equal(sum, p.spending.projected);
});
