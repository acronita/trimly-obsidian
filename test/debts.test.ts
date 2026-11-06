import { test } from "node:test";
import assert from "node:assert/strict";
import { debtBalance, debtPayoff, defaultLedger, netWorth, parseLedger, removeDebt, saveDebt } from "../src/ledger.ts";
import type { Debt } from "../src/ledger.ts";

function debt(extra: Partial<Debt> = {}): Debt {
  return { id: "car", name: "Carro", balance: 1000_00, asOf: "2026-01-15", monthlyRate: 2, payment: 200_00, ...extra };
}

test("without interest, the payoff is a plain division, rounded up to the last partial payment", () => {
  assert.deepEqual(debtPayoff(1000_00, 0, 300_00), { months: 4, interest: 0 });
  assert.deepEqual(debtPayoff(900_00, 0, 300_00), { months: 3, interest: 0 });
});

test("interest is charged on what is left each month, so it falls as the debt does", () => {
  // 1,000 at 10% paying 600: 100 of interest, then 50 on the remaining 500, then the rest
  const p = debtPayoff(1000_00, 10, 600_00);
  assert.equal(p.months, 2);
  assert.equal(p.interest, 150_00);
});

test("agrees with the standard installment formula", () => {
  // Price table: 10,000 at 2% a month for 24 months pays 528.71 a month
  const p = debtPayoff(10_000_00, 2, 528_71);
  assert.equal(p.months, 24);
  assert.ok(Math.abs((p.interest ?? 0) - (528_71 * 24 - 10_000_00)) < 100);
});

test("a payment that doesn't cover the interest never ends, instead of showing a date far away", () => {
  assert.deepEqual(debtPayoff(10_000_00, 10, 1000_00), { months: null, interest: 0 });
  assert.deepEqual(debtPayoff(10_000_00, 10, 500_00), { months: null, interest: 0 });
});

test("paying more ends sooner and costs less interest", () => {
  const base = debtPayoff(10_000_00, 2, 400_00);
  const extra = debtPayoff(10_000_00, 2, 600_00);
  assert.ok((extra.months ?? 0) < (base.months ?? 0));
  assert.ok(extra.interest < base.interest);
});

test("an already paid debt has nothing left", () => {
  assert.deepEqual(debtPayoff(0, 2, 100_00), { months: 0, interest: 0 });
});

test("today's balance assumes each payment since the date given, and a month only counts once it has passed", () => {
  const d = debt();
  assert.equal(debtBalance(d, "2026-01-15"), 1000_00);
  assert.equal(debtBalance(d, "2026-02-14"), 1000_00);
  // 1,000 + 2% − 200
  assert.equal(debtBalance(d, "2026-02-15"), 820_00);
  // 820 + 2% − 200
  assert.equal(debtBalance(d, "2026-03-15"), Math.round(820_00 * 1.02 - 200_00));
});

test("a balance dated in the future isn't touched, and a paid-off debt doesn't go negative", () => {
  assert.equal(debtBalance(debt({ asOf: "2027-01-01" }), "2026-01-01"), 1000_00);
  assert.equal(debtBalance(debt(), "2030-01-15"), 0);
});

test("debts stay out of net worth, which the accounts already reflect", () => {
  const l = defaultLedger();
  l.accounts = [{ id: "a", name: "Corrente", type: "checking", openingBalance: 500_00 }];
  saveDebt(l, debt());
  assert.equal(netWorth(l), 500_00);
});

test("saving edits in place, removing the last one clears the field, and debts survive a reload", () => {
  const l = defaultLedger();
  saveDebt(l, debt());
  saveDebt(l, debt({ payment: 300_00 }));
  assert.equal(l.debts?.length, 1);
  assert.equal(l.debts?.[0].payment, 300_00);
  assert.deepEqual(parseLedger(JSON.stringify(l)).debts, l.debts);
  removeDebt(l, "car");
  assert.equal(l.debts, undefined);
  assert.equal(parseLedger(JSON.stringify(defaultLedger())).debts, undefined);
});
