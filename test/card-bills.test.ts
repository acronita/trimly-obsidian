import { test } from "node:test";
import assert from "node:assert/strict";
import { cardBill, cardBillObligations, cardBills, dueObligations, monthPayments, obligationReminders } from "../src/ledger.ts";
import type { Account, Ledger, Transaction } from "../src/ledger.ts";

/** Card closing on the 3rd, due on the 10th, with a checking account paying it. */
function ledger(transactions: Transaction[], card: Partial<Account> = { closingDay: 3, dueDay: 10 }): Ledger {
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
  assert.deepEqual([closed.start, closed.end, closed.close, closed.due, closed.total], ["2026-09-03", "2026-10-02", "2026-10-03", "2026-10-10", 100_00]);
  assert.deepEqual([open.start, open.end, open.close, open.due, open.total], ["2026-10-03", "2026-11-02", "2026-11-03", "2026-11-10", 40_00]);
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

test("a bill closes on its closing day, and that day's purchases go to the next bill", () => {
  // like Brazilian banks: the closing day is the best day to buy
  const l = ledger([buy("before", "2026-11-02", 30_00), buy("close-day", "2026-11-03", 10_00)]);
  const { closed, open } = cardBills(l, "card", "2026-11-03");
  assert.deepEqual([closed.close, closed.total], ["2026-11-03", 30_00]);
  assert.deepEqual([open.start, open.close, open.total], ["2026-11-03", "2026-12-03", 10_00]);
  assert.deepEqual(obligationReminders(l, "2026-11-08").map((d) => [d.due, d.obligation.amount]), [["2026-11-10", 30_00]]);
});

test("without a closing day the cycle is the calendar month; without a due day there is no due date", () => {
  const l = ledger([buy("oct", "2026-10-15", 40_00)], {});
  const { closed, open } = cardBills(l, "card", "2026-10-25");
  assert.deepEqual([closed.end, open.start, open.end, open.due], ["2026-09-30", "2026-10-01", "2026-10-31", undefined]);
  assert.equal(open.total, 40_00);
});

test("the bank's own bill dates win over the card's days, which still cover the other months", () => {
  // a bank that moves its closing: October's bill closed on the 22nd and is due Nov 1
  const card = { closingDay: 3, dueDay: 10, billDates: [{ close: "2026-10-22", due: "2026-11-01" }] };
  const l = ledger([buy("before", "2026-10-21", 30_00), buy("close-day", "2026-10-22", 10_00)], card);
  const { closed, open } = cardBills(l, "card", "2026-10-25");
  assert.deepEqual([closed.start, closed.close, closed.due, closed.total], ["2026-09-03", "2026-10-22", "2026-11-01", 30_00]);
  assert.deepEqual([open.start, open.close, open.due, open.total], ["2026-10-22", "2026-11-03", "2026-11-10", 10_00]);
});

test("a closing day past the end of a short month falls on its last day", () => {
  const l = ledger([], { closingDay: 31, dueDay: 8 });
  const { closed, open } = cardBills(l, "card", "2026-02-15");
  assert.deepEqual([closed.close, open.close, open.due], ["2026-01-31", "2026-02-28", "2026-03-08"]);
});

test("an older bill counts the payments made in the cycle after it closed", () => {
  const l = ledger([buy("aug", "2026-08-20", 300_00), pay("p-aug", "2026-09-08", 300_00), buy("sep", "2026-09-20", 100_00)]);
  const aug = cardBill(l, "card", "2026-10-25", -2);
  assert.deepEqual([aug.start, aug.close, aug.total, aug.paid, aug.remaining], ["2026-08-03", "2026-09-03", 300_00, 300_00, 0]);
  // the August payment does not leak into the September bill
  assert.equal(cardBill(l, "card", "2026-10-25", -1).remaining, 100_00);
});

test("an unpaid closed bill is an obligation due on the card's due day, for what is left to pay", () => {
  // closed on Oct 3, due Oct 10; on Oct 5 only part of it is paid
  const l = ledger([buy("market", "2026-09-20", 300_00), pay("part", "2026-10-04", 100_00)]);
  const [bill] = cardBillObligations(l, "2026-10-05");
  assert.equal(bill.cardId, "card");
  assert.equal(bill.due, "2026-10-10");
  assert.equal(bill.obligation.amount, 200_00);
  assert.deepEqual(dueObligations(l, "2026-10-31", "2026-10-05").map((d) => d.cardId), ["card"]);
  // reminded a few days before it is due, like any obligation
  assert.deepEqual(obligationReminders(l, "2026-10-05"), []);
  assert.equal(obligationReminders(l, "2026-10-07").length, 1);
});

test("paying the whole bill takes it off the obligations, with nothing to mark by hand", () => {
  const l = ledger([buy("market", "2026-09-20", 300_00), pay("full", "2026-10-06", 300_00)]);
  assert.deepEqual(cardBillObligations(l, "2026-10-07"), []);
});

test("the open bill is projected at what was charged so far, and never reminded of before it closes", () => {
  // open bill: Oct 4 to Nov 3, due Nov 10; the closed one is paid
  const l = ledger([buy("market", "2026-09-20", 300_00), pay("full", "2026-10-06", 300_00), buy("gas", "2026-10-20", 80_00)]);
  const [bill] = cardBillObligations(l, "2026-10-25");
  assert.equal(bill.projected, true);
  assert.equal(bill.due, "2026-11-10");
  assert.equal(bill.obligation.amount, 80_00);
  assert.deepEqual(dueObligations(l, "2026-11-24", "2026-10-25").map((d) => d.due), ["2026-11-10"]);
  assert.deepEqual(obligationReminders(l, "2026-10-25"), []);
});

test("cards without a due day, and empty bills, are not obligations", () => {
  assert.deepEqual(cardBillObligations(ledger([buy("market", "2026-09-20", 300_00)], { closingDay: 3 }), "2026-10-05"), []);
  assert.deepEqual(cardBillObligations(ledger([]), "2026-10-05"), []);
});

test("this month's total: what is left of the bills due in it, and what was already paid of them", () => {
  // card bill closed Oct 3, due Oct 10, partly paid; a light bill due Oct 15 paid by a linked transaction;
  // water due Oct 20 still open at its usual amount; a bill due in November is not this month's
  const l = ledger([buy("market", "2026-09-20", 300_00), pay("part", "2026-10-04", 100_00), buy("enel", "2026-10-14", 90_00)]);
  const base = { kind: "payment" as const, frequency: "monthly" as const, since: "2026-10-01", remindDays: 3 };
  l.obligations = [
    { ...base, id: "light", name: "Luz", day: 15, settled: [{ due: "2026-10-15", status: "done", date: "2026-10-14", transactionId: "enel" }] },
    { ...base, id: "water", name: "Água", day: 20, amount: 60_00, settled: [] },
    { ...base, id: "rent", name: "Aluguel", day: 5, amount: 2000_00, since: "2026-11-01", settled: [] },
  ];
  const month = monthPayments(l, "2026-10-08");
  assert.equal(month.toPay, 200_00 + 60_00);
  assert.equal(month.paid, 100_00 + 90_00);
  assert.deepEqual(month.open.map((d) => d.cardId ?? d.obligation.id), ["card", "water"]);
});
