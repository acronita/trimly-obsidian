import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultLedger } from "../src/ledger.ts";
import type { Ledger, Transaction } from "../src/ledger.ts";
import { buildReport, changePct, lastYearRange, presetRange, previousRange, seriesKeys } from "../src/reports.ts";

let nextId = 0;
function tx(date: string, type: Transaction["type"], amount: number, extra: Partial<Transaction> = {}): Transaction {
  return { id: `t${nextId++}`, date, type, amount, accountId: "main", description: "x", ...extra };
}

function setup(...transactions: Transaction[]): Ledger {
  const l = defaultLedger();
  l.accounts = [
    { id: "main", name: "Corrente", type: "checking", openingBalance: 0 },
    { id: "card", name: "Cartão", type: "credit", openingBalance: 0 },
  ];
  l.transactions = transactions;
  return l;
}

test("transfers stay out, so paying a card bill isn't counted on top of its purchases", () => {
  const r = buildReport(
    setup(tx("2026-03-05", "expense", 100_00, { accountId: "card" }), tx("2026-03-10", "transfer", 100_00, { toAccountId: "card" })),
    { from: "2026-03-01", to: "2026-03-31" }
  );
  assert.equal(r.expense, 100_00);
});

test("the period includes its first and last days and nothing around them", () => {
  const r = buildReport(
    setup(tx("2026-02-28", "expense", 1), tx("2026-03-01", "expense", 10), tx("2026-03-15", "expense", 100), tx("2026-03-16", "expense", 1000)),
    { from: "2026-03-01", to: "2026-03-15" }
  );
  assert.equal(r.expense, 110);
});

test("totals split by category and by account, in the settings' currency", () => {
  const l = setup(
    tx("2026-03-05", "expense", 100_00, { categoryId: "food" }),
    tx("2026-03-06", "expense", 50_00, { categoryId: "food", accountId: "card" }),
    tx("2026-03-07", "expense", 30_00),
    tx("2026-03-08", "income", 500_00, { categoryId: "salary" }),
    tx("2026-03-09", "expense", 10_00, { accountId: "usd" })
  );
  l.accounts.push({ id: "usd", name: "Dólar", type: "checking", openingBalance: 0, currency: "USD" });
  l.fx = { base: "BRL", date: "2026-03-01", rates: { USD: 0.2 } };
  const r = buildReport(l, { from: "2026-03-01", to: "2026-03-31" });
  assert.equal(r.expenseByCategory.get("food"), 150_00);
  assert.equal(r.expenseByCategory.get(""), 80_00);
  assert.equal(r.incomeByCategory.get("salary"), 500_00);
  assert.deepEqual(r.byAccount.get("card"), { income: 0, expense: 50_00 });
  assert.deepEqual(r.byAccount.get("main"), { income: 500_00, expense: 130_00 });
  assert.deepEqual(r.byAccount.get("usd"), { income: 0, expense: 50_00 });
});

test("filters narrow everything at once: one account, one category, or only the uncategorized", () => {
  const l = setup(tx("2026-03-05", "expense", 100_00, { categoryId: "food" }), tx("2026-03-06", "expense", 50_00, { categoryId: "food", accountId: "card" }), tx("2026-03-07", "expense", 30_00));
  const range = { from: "2026-03-01", to: "2026-03-31" };
  assert.equal(buildReport(l, { ...range, accountId: "card" }).expense, 50_00);
  assert.equal(buildReport(l, { ...range, categoryId: "food" }).expense, 150_00);
  assert.equal(buildReport(l, { ...range, categoryId: "" }).expense, 30_00);
  assert.equal(buildReport(l, { ...range, categoryId: "all", accountId: "" }).expense, 180_00);
});

test("a month compares with the whole month before, whatever their lengths", () => {
  assert.deepEqual(previousRange({ from: "2026-03-01", to: "2026-03-31" }), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(previousRange({ from: "2026-01-01", to: "2026-03-31" }), { from: "2025-10-01", to: "2025-12-31" });
});

test("a free period compares with the same number of days right before it", () => {
  assert.deepEqual(previousRange({ from: "2026-03-10", to: "2026-03-19" }), { from: "2026-02-28", to: "2026-03-09" });
});

test("a year earlier keeps the dates, and February keeps its real end across a leap year", () => {
  assert.deepEqual(lastYearRange({ from: "2026-01-01", to: "2026-11-05" }), { from: "2025-01-01", to: "2025-11-05" });
  assert.deepEqual(lastYearRange({ from: "2025-02-01", to: "2025-02-28" }), { from: "2024-02-01", to: "2024-02-29" });
  assert.deepEqual(lastYearRange({ from: "2024-02-29", to: "2024-03-10" }), { from: "2023-02-28", to: "2023-03-10" });
});

test("presets end today when the period is still running, and on the real last day when it is over", () => {
  const today = "2026-03-15";
  assert.deepEqual(presetRange("thisMonth", today), { from: "2026-03-01", to: today });
  assert.deepEqual(presetRange("lastMonth", today), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(presetRange("last3Months", today), { from: "2026-01-01", to: today });
  assert.deepEqual(presetRange("last12Months", today), { from: "2025-04-01", to: today });
  assert.deepEqual(presetRange("thisYear", today), { from: "2026-01-01", to: today });
  assert.deepEqual(presetRange("lastYear", today), { from: "2025-01-01", to: "2025-12-31" });
});

test("the chart has a bar per month, empty ones included, so a quiet month shows as a gap", () => {
  const f = { from: "2026-01-15", to: "2026-03-10" };
  assert.deepEqual(seriesKeys(f), ["2026-01", "2026-02", "2026-03"]);
  const r = buildReport(setup(tx("2026-01-20", "expense", 10), tx("2026-03-02", "income", 20)), f);
  assert.deepEqual([...r.series.keys()], ["2026-01", "2026-03"]);
});

test("a period too long for monthly bars is charted by year", () => {
  const f = { from: "2022-06-01", to: "2026-03-10" };
  assert.deepEqual(seriesKeys(f), ["2022", "2023", "2024", "2025", "2026"]);
  const r = buildReport(setup(tx("2024-05-01", "expense", 10), tx("2024-09-01", "expense", 5)), f);
  assert.deepEqual(r.series.get("2024"), { income: 0, expense: 15 });
});

test("a change is only a percentage when there is something to compare with", () => {
  assert.equal(changePct(150, 100), 50);
  assert.equal(changePct(50, 100), -50);
  assert.equal(changePct(50, 0), null);
});
