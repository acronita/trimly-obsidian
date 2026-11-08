import { test } from "node:test";
import assert from "node:assert/strict";
import { calculatorDefaults, compareCdbLci, compound, fixedIncomeTax, monthlyToReach, monthsToReach, wealthForIncome } from "../src/calculators.ts";
import { defaultLedger } from "../src/ledger.ts";

const near = (actual: number, expected: number, tolerance: number) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not near ${expected}`);

test("a yearly rate compounds to itself over 12 months, not to a simple division by 12", () => {
  near(compound(1000_00, 0, 12, 12).final, 1120_00, 1);
});

test("contributions at a zero rate just add up, with no interest invented", () => {
  assert.deepEqual(compound(1000_00, 100_00, 0, 10), { final: 2000_00, invested: 2000_00, interest: 0 });
});

test("contributions earn from the month after they are made", () => {
  // 100 a month at 1% a month for 2 months: 100 × 1.01 + 100
  const annual = (1.01 ** 12 - 1) * 100;
  near(compound(0, 100_00, annual, 2).final, 201_00, 1);
});

test("the months to reach a target agree with what the same months compound to", () => {
  const months = monthsToReach(1000_00, 500_00, 10, 100_000_00);
  assert.ok(months);
  assert.ok(compound(1000_00, 500_00, 10, months).final >= 100_000_00 - 1);
  assert.ok(compound(1000_00, 500_00, 10, months - 1).final < 100_000_00);
});

test("already at the target takes no time, and a target out of reach says so instead of looping forever", () => {
  assert.equal(monthsToReach(1000_00, 0, 5, 1000_00), 0);
  assert.equal(monthsToReach(0, 0, 0, 1000_00), null);
});

test("the contribution asked for really reaches the target, and is 0 when compounding alone gets there", () => {
  const monthly = monthlyToReach(1000_00, 10, 60, 50_000_00);
  assert.ok(compound(1000_00, monthly, 10, 60).final >= 50_000_00);
  assert.ok(compound(1000_00, monthly - 100, 10, 60).final < 50_000_00);
  assert.equal(monthlyToReach(0, 0, 10, 1000_00), 100_00);
  assert.equal(monthlyToReach(100_000_00, 10, 120, 1000_00), 0);
});

test("the wealth for an income comes from a yearly withdrawal", () => {
  // 5,000 a month is 60,000 a year; at 4% that takes 1.5 million
  assert.equal(wealthForIncome(5000_00, 4), 1_500_000_00);
});

test("the tax falls at each legal step of the holding period", () => {
  assert.equal(fixedIncomeTax(180), 22.5);
  assert.equal(fixedIncomeTax(181), 20);
  assert.equal(fixedIncomeTax(360), 20);
  assert.equal(fixedIncomeTax(361), 17.5);
  assert.equal(fixedIncomeTax(720), 17.5);
  assert.equal(fixedIncomeTax(721), 15);
});

test("a CDB paying more can still lose to a tax-free LCI once the tax is out", () => {
  const r = compareCdbLci(10, 110, 95, 365);
  // tax 17.5% at 365 days: the CDB's 11% nets 9.075%, the LCI's 9.5% is whole
  near(r.cdbNet, 9.075, 0.001);
  near(r.lciNet, 9.5, 0.001);
  assert.ok(r.lciNet > r.cdbNet);
});

test("the break-even CDB really matches the LCI after tax", () => {
  const r = compareCdbLci(10, 100, 90, 800);
  const matched = compareCdbLci(10, r.breakEvenCdb, 90, 800);
  near(matched.cdbNet, matched.lciNet, 0.000001);
  // over a year there is nothing to compound, so it is the plain gross-up: 90 ÷ (1 − 17.5%)
  near(compareCdbLci(10, 100, 90, 365).breakEvenCdb, 90 / 0.825, 0.000001);
});

test("fields start from real averages of closed months, so a half-spent month doesn't drag them down", () => {
  const l = defaultLedger();
  l.accounts = [
    { id: "main", name: "Corrente", type: "checking", openingBalance: 1000_00 },
    { id: "card", name: "Cartão", type: "credit", openingBalance: -500_00 },
    { id: "old", name: "Antiga", type: "checking", openingBalance: 9000_00, archived: true },
  ];
  l.transactions = [
    { id: "a", date: "2026-10-10", type: "expense", amount: 600_00, accountId: "card", description: "x" },
    { id: "b", date: "2026-11-02", type: "expense", amount: 900_00, accountId: "card", description: "this month" },
    { id: "c", date: "2026-03-10", type: "expense", amount: 900_00, accountId: "card", description: "too old" },
  ];
  l.investments.assets = [{ id: "fii", name: "FII", assetClass: "reit", value: 5000_00, updatedAt: "2026-11-01" }];
  l.investments.movements = [
    { id: "m1", assetId: "fii", date: "2026-10-05", type: "buy", amount: 1200_00 },
    { id: "m2", assetId: "fii", date: "2026-11-01", type: "buy", amount: 9999_00 },
    { id: "m3", assetId: "fii", date: "2026-09-15", type: "income", amount: 120_00 },
    { id: "m4", assetId: "fii", date: "2025-09-15", type: "income", amount: 9999_00 },
  ];
  assert.deepEqual(calculatorDefaults(l, "2026-11-05"), { wealth: 5000_00, contribution: 100_00, passiveIncome: 10_00, expense: 100_00, cash: 1000_00 });
});
