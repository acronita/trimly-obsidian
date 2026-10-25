import { test } from "node:test";
import assert from "node:assert/strict";
import { cardBills } from "../src/ledger.ts";
import type { Ledger, Transaction } from "../src/ledger.ts";

/** Card closing on the 3rd, due on the 10th, with a checking account paying it. */
function ledger(transactions: Transaction[], card: { closingDay?: number; dueDay?: number } = { closingDay: 3, dueDay: 10 }): Ledger {
  return {
    version: 1,
    accounts: [
      { id: "bank", name: "Bank", type: "checking", openingBalance: 0 },
      { id: "card", name: "Card", type: "credit", openingBalance: -900_00, ...card },
    ],
    categories: [],
    transactions,
    budgets: [],
    recurring: [],
    obligations: [],
    investments: { assets: [], snapshots: [], movements: [], targets: [] },
  };
}

const buy = (id: string, date: string, amount: number): Transaction => ({ id, date, type: "expense", amount, accountId: "card", description: id });
const pay = (id: string, date: string, amount: number): Transaction => ({
  id,
  date,
  type: "transfer",
  amount,
  accountId: "bank",
  toAccountId: "card",
  description: id,
});

test("bills split card charges by cycle instead of adding up the whole history", () => {
  const l = ledger([buy("old", "2026-08-20", 300_00), buy("sep", "2026-09-20", 100_00), buy("oct", "2026-10-15", 40_00)]);
  const { closed, open } = cardBills(l, "card", "2026-10-25");
  // the September bill closed on Oct 3rd; the August purchase belongs to an older bill
  assert.deepEqual([closed.start, closed.close, closed.due, closed.total], ["2026-09-04", "2026-10-03", "2026-10-10", 100_00]);
  assert.deepEqual([open.start, open.close, open.due, open.total], ["2026-10-04", "2026-11-03", "2026-11-10", 40_00]);
});

test("a payment after the closing pays the closed bill, not the open one", () => {
  const l = ledger([buy("sep", "2026-09-20", 100_00), buy("oct", "2026-10-15", 40_00), pay("p", "2026-10-08", 100_00)]);
  const { closed, open } = cardBills(l, "card", "2026-10-25");
  assert.equal(closed.remaining, 0);
  assert.equal(open.remaining, 40_00);
});

test("a partial payment leaves the rest of the closed bill unpaid", () => {
  const l = ledger([buy("sep", "2026-09-20", 100_00), pay("p", "2026-10-08", 30_00)]);
  assert.equal(cardBills(l, "card", "2026-10-25").closed.remaining, 70_00);
});

test("paying more than the closed bill lowers the open one", () => {
  const l = ledger([buy("sep", "2026-09-20", 100_00), buy("oct", "2026-10-15", 40_00), pay("p", "2026-10-08", 120_00)]);
  assert.equal(cardBills(l, "card", "2026-10-25").open.remaining, 20_00);
});

test("a refund lowers the bill of its own cycle", () => {
  const refund: Transaction = { id: "r", date: "2026-10-16", type: "income", amount: 15_00, accountId: "card", description: "refund" };
  const l = ledger([buy("oct", "2026-10-15", 40_00), refund]);
  assert.equal(cardBills(l, "card", "2026-10-25").open.total, 25_00);
});

test("the bill closing today is still open, its purchases included", () => {
  const l = ledger([buy("close-day", "2026-11-03", 10_00)]);
  const { open } = cardBills(l, "card", "2026-11-03");
  assert.equal(open.close, "2026-11-03");
  assert.equal(open.total, 10_00);
});

test("without a closing day the cycle is the calendar month; without a due day there is no due date", () => {
  const l = ledger([buy("oct", "2026-10-15", 40_00)], {});
  const { closed, open } = cardBills(l, "card", "2026-10-25");
  assert.deepEqual([closed.close, open.start, open.close, open.due], ["2026-09-30", "2026-10-01", "2026-10-31", undefined]);
  assert.equal(open.total, 40_00);
});

test("a closing day past the end of a short month falls on its last day", () => {
  const l = ledger([], { closingDay: 31, dueDay: 8 });
  const { closed, open } = cardBills(l, "card", "2026-02-15");
  assert.deepEqual([closed.close, open.close, open.due], ["2026-01-31", "2026-02-28", "2026-03-08"]);
});
