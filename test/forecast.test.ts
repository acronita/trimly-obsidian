import { test } from "node:test";
import assert from "node:assert/strict";
import { balanceForecast, defaultLedger, mainAccount } from "../src/ledger.ts";
import type { Account, Ledger, Obligation, Recurring } from "../src/ledger.ts";

const TODAY = "2026-11-05";

function setup(balance = 1000_00): Ledger {
  const l = defaultLedger();
  l.accounts = [{ id: "main", name: "Corrente", type: "checking", openingBalance: balance }];
  return l;
}

function rule(extra: Partial<Recurring> = {}): Recurring {
  return { id: "r", description: "Salário", type: "income", amount: 500_00, accountId: "main", frequency: "monthly", startDate: "2026-01-10", nextDate: "2026-11-10", ...extra };
}

function bill(extra: Partial<Obligation> = {}): Obligation {
  return { id: "o", name: "Luz", kind: "payment", frequency: "monthly", day: 20, since: "2026-11-01", amount: 100_00, remindDays: 3, settled: [], ...extra };
}

const card = (extra: Partial<Account> = {}): Account => ({ id: "card", name: "Cartão", type: "credit", openingBalance: 0, closingDay: 1, dueDay: 8, ...extra });

test("a monthly rule repeats inside the period, so the salary counts each time it falls", () => {
  const l = setup();
  l.recurring = [rule()];
  const f = balanceForecast(l, "main", TODAY, 60);
  assert.deepEqual(f.events.map((e) => e.date), ["2026-11-10", "2026-12-10"]);
  assert.equal(f.end, 2000_00);
});

test("a rule that ended, or belongs to another account, doesn't move this balance", () => {
  const l = setup();
  l.accounts.push({ id: "other", name: "Outra", type: "checking", openingBalance: 0 });
  l.recurring = [rule({ id: "a", endDate: "2026-11-30" }), rule({ id: "b", accountId: "other" })];
  assert.equal(balanceForecast(l, "main", TODAY, 60).end, 1500_00);
});

test("a recurring transfer leaves one account and enters the other", () => {
  const l = setup();
  l.accounts.push({ id: "savings", name: "Poupança", type: "savings", openingBalance: 0 });
  l.recurring = [rule({ type: "transfer", amount: 200_00, toAccountId: "savings", endDate: "2026-11-30" })];
  assert.equal(balanceForecast(l, "main", TODAY).end, 800_00);
  assert.equal(balanceForecast(l, "savings", TODAY).end, 200_00);
});

test("a charge the bank is about to bring counts today, but a rule long past doesn't pile up", () => {
  const l = setup();
  l.recurring = [rule({ id: "soon", type: "expense", amount: 50_00, nextDate: "2026-11-02", endDate: "2026-11-30" }), rule({ id: "old", type: "expense", amount: 900_00, nextDate: "2026-06-01", endDate: "2026-06-30" })];
  const f = balanceForecast(l, "main", TODAY);
  assert.deepEqual(f.events.map((e) => [e.date, e.amount]), [[TODAY, -50_00]]);
});

test("future transactions count on their dates, and today's balance doesn't count them twice", () => {
  const l = setup();
  l.transactions = [{ id: "t", date: "2026-11-20", type: "expense", amount: 300_00, accountId: "main", description: "Boleto" }];
  const f = balanceForecast(l, "main", TODAY);
  assert.equal(f.start, 1000_00);
  assert.equal(f.end, 700_00);
});

test("a bill goes out on its due date, an overdue one today, and each month it falls", () => {
  const l = setup();
  l.obligations = [bill({ since: "2026-10-01" })];
  const f = balanceForecast(l, "main", TODAY, 60);
  // October's is overdue; then November and December
  assert.deepEqual(f.events.map((e) => e.date), [TODAY, "2026-11-20", "2026-12-20"]);
  assert.equal(f.end, 700_00);
});

test("a settled bill or a document costs nothing more", () => {
  const l = setup();
  l.obligations = [
    bill({ settled: [{ due: "2026-11-20", status: "done", date: "2026-11-03" }], archived: true }),
    bill({ id: "doc", name: "IRPF", kind: "document", amount: undefined }),
  ];
  const f = balanceForecast(l, "main", TODAY, 10);
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.unpriced, []);
});

test("a bill with no known amount is named instead of silently counting as zero", () => {
  const l = setup();
  l.obligations = [bill({ amount: undefined })];
  const f = balanceForecast(l, "main", TODAY, 20);
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.unpriced, ["Luz"]);
});

test("a bill already paid by a recurring rule isn't counted a second time", () => {
  const l = setup();
  l.recurring = [rule({ type: "expense", amount: 100_00, description: "Luz", nextDate: "2026-11-20", endDate: "2026-11-30" })];
  l.transactions = [{ id: "paid", date: "2026-10-20", type: "expense", amount: 100_00, accountId: "main", description: "Luz", recurringId: "r" }];
  l.obligations = [bill({ settled: [{ due: "2026-10-20", status: "done", date: "2026-10-20", transactionId: "paid" }] })];
  const f = balanceForecast(l, "main", TODAY, 20);
  assert.deepEqual(f.events.map((e) => e.amount), [-100_00]);
  assert.equal(f.start, 900_00);
});

test("a card's bills leave the forecast account, the open one marked as still growing", () => {
  const l = setup();
  l.accounts.push(card());
  l.transactions = [
    { id: "closed", date: "2026-10-20", type: "expense", amount: 200_00, accountId: "card", description: "Mercado" },
    { id: "open", date: "2026-11-03", type: "expense", amount: 50_00, accountId: "card", description: "Café" },
  ];
  const f = balanceForecast(l, "main", TODAY, 60);
  assert.deepEqual(f.events.map((e) => [e.amount, !!e.projected]), [[-200_00, false], [-50_00, true]]);
  assert.equal(f.end, 750_00);
});

test("a card paid by a recurring transfer doesn't lose its bill twice", () => {
  const l = setup();
  l.accounts.push(card());
  l.transactions = [{ id: "closed", date: "2026-10-20", type: "expense", amount: 200_00, accountId: "card", description: "Mercado" }];
  l.recurring = [rule({ type: "transfer", amount: 200_00, toAccountId: "card", nextDate: "2026-11-08", endDate: "2026-11-30" })];
  assert.equal(balanceForecast(l, "main", TODAY, 10).end, 800_00);
});

test("the lowest point and first negative day warn before the salary arrives, even if the period ends well", () => {
  const l = setup(100_00);
  l.recurring = [rule({ nextDate: "2026-11-15", amount: 5000_00, endDate: "2026-11-30" })];
  l.obligations = [bill({ day: 10, amount: 300_00, frequency: "yearly", month: 11 })];
  const f = balanceForecast(l, "main", TODAY, 20);
  assert.deepEqual(f.lowest, { date: "2026-11-10", balance: -200_00 });
  assert.equal(f.negativeOn, "2026-11-10");
  assert.equal(f.end, 4800_00);
});

test("on one day money comes in first, so a salary and a bill on the same date don't fake a negative", () => {
  const l = setup(0);
  l.recurring = [rule({ id: "in", nextDate: "2026-11-10", endDate: "2026-11-30" }), rule({ id: "out", type: "expense", amount: 400_00, nextDate: "2026-11-10", endDate: "2026-11-30" })];
  assert.equal(balanceForecast(l, "main", TODAY).negativeOn, undefined);
});

test("a bill in the settings' currency is converted for an account in another one", () => {
  const l = setup();
  l.accounts[0].currency = "USD";
  l.fx = { base: "BRL", date: TODAY, rates: { USD: 0.2 } };
  l.obligations = [bill({ amount: 100_00, frequency: "yearly", month: 11 })];
  assert.equal(balanceForecast(l, "main", TODAY, 20).events[0].amount, -20_00);
});

test("the forecast opens on the most used checking account, never a card or an archived one", () => {
  const l = setup();
  l.accounts = [
    { id: "savings", name: "Poupança", type: "savings", openingBalance: 0 },
    { id: "quiet", name: "Parada", type: "checking", openingBalance: 0 },
    { id: "busy", name: "Principal", type: "checking", openingBalance: 0 },
    { id: "gone", name: "Antiga", type: "checking", openingBalance: 0, archived: true },
    card(),
  ];
  const spent = (id: string, accountId: string) => ({ id, date: TODAY, type: "expense" as const, amount: 1, accountId, description: "x" });
  l.transactions = [spent("1", "busy"), spent("2", "busy"), spent("3", "gone"), spent("4", "gone"), spent("5", "gone"), spent("6", "card")];
  assert.equal(mainAccount(l)?.id, "busy");
  l.accounts = l.accounts.filter((a) => a.id === "savings" || a.id === "card");
  assert.equal(mainAccount(l)?.id, "savings");
});
