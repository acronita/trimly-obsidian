import { test } from "node:test";
import assert from "node:assert/strict";
import { assetCode, darfDue, taxKind, taxMonths, taxPosition, taxPositions } from "../src/income-tax.ts";
import { defaultLedger } from "../src/ledger.ts";
import type { Asset, Movement, MovementType } from "../src/ledger.ts";

function asset(extra: Partial<Asset> = {}): Asset {
  return { id: "petr", name: "Petrobras", code: "PETR4", assetClass: "stock", quantity: 0, invested: 0, value: 0, updatedAt: "2026-01-01", ...extra };
}

let nextId = 0;
function mov(date: string, type: MovementType, amount: number, quantity?: number, extra: Partial<Movement> = {}): Movement {
  return { id: `m${nextId++}`, assetId: "petr", date, type, amount, quantity, cost: type === "sell" ? 0 : undefined, ...extra };
}

/** Bought 100 at R$ 10 and sells them in `sells`, in a manual-free position so nothing else adds to the cost. */
function bought(...sells: Movement[]) {
  return taxPosition(asset({ quantity: 100 - sells.reduce((s, m) => s + (m.quantity ?? 0), 0) }), "stock", [mov("2026-01-05", "buy", 1000_00, 100), ...sells]);
}

test("the gain of a sale is measured against the average cost of all buys, not the last one", () => {
  const p = taxPosition(asset({ quantity: 150 }), "stock", [mov("2026-01-05", "buy", 1000_00, 100), mov("2026-02-05", "buy", 2000_00, 100), mov("2026-03-05", "sell", 1000_00, 50)]);
  // average R$ 15, so 50 shares cost R$ 750
  assert.equal(p.sales[0].gain, 250_00);
  assert.equal(p.quantity, 150);
  assert.equal(p.cost, 2250_00);
});

test("selling doesn't change the average cost of what is left", () => {
  const p = bought(mov("2026-03-05", "sell", 900_00, 40));
  assert.equal(p.cost / p.quantity, 10_00);
});

test("stock sales up to R$ 20.000 in a month pay nothing, however large the gain", () => {
  const [m] = taxMonths([bought(mov("2026-03-05", "sell", 20_000_00, 100))]);
  assert.equal(m.exempt, true);
  assert.equal(m.exemptGain, 19_000_00);
  assert.equal(m.darf, 0);
});

test("one real above R$ 20.000 taxes the whole gain at 15%, not just the excess", () => {
  const [m] = taxMonths([bought(mov("2026-03-05", "sell", 20_001_00, 100))]);
  assert.equal(m.exempt, false);
  assert.equal(m.common.tax, Math.round(19_001_00 * 0.15));
  assert.equal(m.darf, m.common.tax);
});

test("the exemption looks at the month's total stock sales across positions", () => {
  const other = taxPosition(asset({ id: "vale", code: "VALE3", quantity: 0 }), "stock", [
    mov("2026-01-05", "buy", 1000_00, 100, { assetId: "vale" }),
    mov("2026-03-20", "sell", 12_000_00, 100, { assetId: "vale" }),
  ]);
  const [m] = taxMonths([bought(mov("2026-03-05", "sell", 12_000_00, 100)), other]);
  assert.equal(m.stockSales, 24_000_00);
  assert.equal(m.exempt, false);
});

test("FIIs pay 20% with no exemption, even on a small sale", () => {
  const p = taxPosition(asset({ assetClass: "reit", code: "HGLG11" }), "fii", [mov("2026-01-05", "buy", 1000_00, 10), mov("2026-03-05", "sell", 1500_00, 10)]);
  const [m] = taxMonths([p]);
  assert.equal(m.fii.tax, 100_00);
  assert.equal(m.darf, 100_00);
});

test("ETFs and BDRs pay 15% and get no exemption, and don't use up the stock limit", () => {
  const etf = taxPosition(asset({ assetClass: "etf", code: "BOVA11" }), "etf", [mov("2026-01-05", "buy", 1000_00, 10), mov("2026-03-05", "sell", 1500_00, 10)]);
  const [m] = taxMonths([etf]);
  assert.equal(m.common.tax, 75_00);
  assert.equal(m.stockSales, 0);
  assert.equal(taxKind({ assetClass: "stock", code: "AAPL34" }), "bdr");
  assert.equal(taxKind({ assetClass: "stock", code: "TAEE11" }), "stock");
  assert.equal(taxKind({ assetClass: "fixed_income", code: "PETR4" }), null);
});

test("a loss lowers later gains of its group and is used only once", () => {
  const loss = taxPosition(asset({ assetClass: "etf", code: "BOVA11", id: "loss" }), "etf", [
    mov("2026-01-05", "buy", 1000_00, 10, { assetId: "loss" }),
    mov("2026-02-05", "sell", 800_00, 10, { assetId: "loss" }),
  ]);
  const gain = taxPosition(asset({ assetClass: "etf", code: "IVVB11", id: "gain" }), "etf", [
    mov("2026-01-05", "buy", 1000_00, 10, { assetId: "gain" }),
    mov("2026-03-05", "sell", 1500_00, 10, { assetId: "gain" }),
    mov("2026-03-06", "buy", 1000_00, 10, { assetId: "gain" }),
    mov("2026-04-05", "sell", 1500_00, 10, { assetId: "gain" }),
  ]);
  const [feb, mar, apr] = taxMonths([loss, gain]);
  assert.equal(feb.common.lossCarry, 200_00);
  assert.equal(mar.common.lossUsed, 200_00);
  assert.equal(mar.common.tax, Math.round(300_00 * 0.15));
  assert.equal(apr.common.lossUsed, 0);
  assert.equal(apr.common.tax, 75_00);
});

test("a FII loss never lowers a stock gain, and the other way around", () => {
  const fii = taxPosition(asset({ id: "fii", assetClass: "reit", code: "HGLG11" }), "fii", [
    mov("2026-01-05", "buy", 1000_00, 10, { assetId: "fii" }),
    mov("2026-02-05", "sell", 500_00, 10, { assetId: "fii" }),
  ]);
  const [feb, mar] = taxMonths([fii, bought(mov("2026-03-05", "sell", 30_000_00, 100))]);
  assert.equal(feb.fii.lossCarry, 500_00);
  assert.equal(mar.common.lossUsed, 0);
  assert.equal(mar.common.tax, Math.round(29_000_00 * 0.15));
  assert.equal(mar.fii.lossCarry, 500_00);
});

test("a stock loss in an exempt month still counts against later gains", () => {
  const [jan, feb] = taxMonths([
    taxPosition(asset({ quantity: 0 }), "stock", [
      mov("2026-01-02", "buy", 10_000_00, 100),
      mov("2026-01-20", "sell", 8000_00, 100),
      mov("2026-02-02", "buy", 10_000_00, 100),
      mov("2026-02-20", "sell", 30_000_00, 100),
    ]),
  ]);
  assert.equal(jan.exempt, true);
  assert.equal(jan.common.lossCarry, 2000_00);
  assert.equal(feb.common.lossUsed, 2000_00);
  assert.equal(feb.common.tax, Math.round(18_000_00 * 0.15));
});

test("a tax under R$ 10 waits and adds to the next month's DARF", () => {
  const [small, next] = taxMonths([
    taxPosition(asset({ assetClass: "reit", code: "HGLG11", quantity: 0 }), "fii", [
      mov("2026-01-02", "buy", 100_00, 10),
      mov("2026-01-20", "sell", 80_00, 5),
      mov("2026-02-20", "sell", 80_00, 5),
    ]),
  ]);
  assert.equal(small.fii.tax, 6_00);
  assert.equal(small.darf, 0);
  assert.equal(small.due, undefined);
  assert.equal(next.darf, 12_00);
});

test("the DARF is due on the last business day of the next month", () => {
  // January 2026 ends on a Saturday
  assert.equal(darfDue("2025-12"), "2026-01-30");
  assert.equal(darfDue("2026-02"), "2026-03-31");
});

test("a sale without quantity has no gain, is flagged, and marks its month incomplete instead of inventing a tax", () => {
  const p = taxPosition(asset({ quantity: 50 }), "stock", [mov("2026-01-05", "buy", 1000_00, 100), mov("2026-03-05", "sell", 30_000_00)]);
  assert.equal(p.sales[0].gain, null);
  assert.ok(p.issues.includes("missingQuantity"));
  const [m] = taxMonths([p]);
  assert.equal(m.incomplete, true);
  assert.equal(m.stockSales, 30_000_00);
});

test("shares held before the movements start: a synced position takes the bank's average, flagged as an estimate", () => {
  const p = taxPosition(asset({ pluggyId: "x", movementsSynced: true, quantity: 100, invested: 1000_00 }), "stock", [mov("2026-03-05", "sell", 750_00, 50, { cost: undefined })]);
  // 150 held before, at the R$ 10 the bank reports now
  assert.equal(p.sales[0].gain, 250_00);
  assert.ok(p.issues.includes("openingEstimated"));
});

test("a manual position's starting cost is exact from what its withdrawals took off", () => {
  // started with 100 costing R$ 1.000, bought 100 for R$ 2.000
  const p = taxPosition(asset({ quantity: 200, invested: 3000_00 }), "stock", [mov("2026-02-05", "buy", 2000_00, 100)]);
  assert.equal(p.cost, 3000_00);
  assert.deepEqual(p.at("2026-01-31"), { quantity: 100, cost: 1000_00 });
  assert.ok(!p.issues.includes("openingEstimated"));
});

test("shares held before the movements with no known cost leave the sale without a gain", () => {
  const p = taxPosition(asset({ closed: true, invested: undefined }), "stock", [mov("2026-03-05", "sell", 750_00, 50, { cost: undefined })]);
  assert.equal(p.sales[0].gain, null);
  assert.ok(p.issues.includes("missingCost"));
});

test("a sale dated before the buy that covers it has no gain to show", () => {
  const p = taxPosition(asset({ quantity: 0 }), "stock", [mov("2026-03-05", "sell", 750_00, 50), mov("2026-04-05", "buy", 500_00, 50)]);
  assert.equal(p.sales[0].gain, null);
  assert.ok(p.issues.includes("missingHistory"));
});

test("a purchase and a sale of the same asset on one day is flagged as a possible day trade", () => {
  const p = bought(mov("2026-01-05", "sell", 1200_00, 100));
  assert.ok(p.issues.includes("dayTrade"));
});

test("year-end cost for the yearly return follows the cost at that date, not today's", () => {
  const p = bought(mov("2027-02-05", "sell", 900_00, 50));
  assert.deepEqual(p.at("2026-12-31"), { quantity: 100, cost: 1000_00 });
  assert.deepEqual(p.at("2027-12-31"), { quantity: 50, cost: 500_00 });
});

test("only stocks, BDRs, ETFs and FIIs are in, with a code only where it is confirmed", () => {
  const l = defaultLedger();
  l.investments.assets = [asset(), asset({ id: "cdb", assetClass: "fixed_income", code: undefined })];
  assert.deepEqual(taxPositions(l).map((p) => p.asset.id), ["petr"]);
  assert.equal(assetCode("stock"), "03-01");
  assert.equal(assetCode("fii"), "07-03");
  assert.equal(assetCode("etf"), null);
});

test("with no cost known the position says so, instead of a cost of zero", () => {
  const p = taxPosition(asset({ assetClass: "reit", code: "KNCR11", pluggyId: "x", movementsSynced: true, quantity: 10, invested: undefined }), "fii", []);
  assert.equal(p.costKnown, false);
  assert.ok(p.issues.includes("missingCost"));
});

test("an average price the user typed counts as the cost, with nothing left to check", () => {
  const p = taxPosition(asset({ assetClass: "reit", code: "KNCR11", pluggyId: "x", movementsSynced: true, quantity: 10, invested: 1000_00, costEdited: true }), "fii", [mov("2026-03-05", "sell", 300_00, 2, { cost: undefined })]);
  assert.equal(p.costKnown, true);
  assert.equal(p.sales[0].gain, 300_00 - 2 * 100_00);
  assert.ok(!p.issues.includes("openingEstimated"));
});
