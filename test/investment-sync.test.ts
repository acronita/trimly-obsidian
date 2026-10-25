import { test } from "node:test";
import assert from "node:assert/strict";
import { applyInvestments, assetClass } from "../src/investment-sync.ts";
import type { PluggyInvestment, PluggyInvestmentTransaction } from "../src/investment-sync.ts";
import { allocationByClass, defaultLedger, netWorth, parseLedger, portfolioInvested, portfolioValue } from "../src/ledger.ts";
import type { Ledger } from "../src/ledger.ts";
import { periodReturn, portfolioIndex } from "../src/returns.ts";

const TODAY = "2026-10-25";

function inv(id: string, extra: Partial<PluggyInvestment> = {}): PluggyInvestment {
  return {
    id,
    itemId: "item-1",
    name: id,
    type: "FIXED_INCOME",
    subtype: "CDB",
    balance: 1000,
    amount: 1050,
    amountOriginal: 900,
    status: "ACTIVE",
    date: `${TODAY}T00:00:00.000Z`,
    ...extra,
  };
}

function asset(l: Ledger, pluggyId: string) {
  const a = l.investments.assets.find((x) => x.pluggyId === pluggyId);
  assert.ok(a, `asset for ${pluggyId}`);
  return a;
}

test("first sync creates one position per Pluggy investment, valued net of taxes", () => {
  const l = defaultLedger();
  const r = applyInvestments(l, [inv("cdb", { rate: 110, rateType: "CDI", dueDate: "2028-01-15T00:00:00.000Z" })], ["item-1"], TODAY);
  assert.equal(r.added, 1);
  const a = asset(l, "cdb");
  // net balance is what the user would get, so it is what counts in net worth
  assert.equal(a.value, 1000_00);
  assert.equal(a.grossValue, 1050_00);
  assert.equal(a.invested, 900_00);
  assert.equal(a.rate, 110);
  assert.equal(a.rateType, "CDI");
  assert.equal(a.dueDate, "2028-01-15");
  assert.equal(a.assetClass, "fixed_income");
});

test("syncing again updates values in place without duplicating, keeping the user's name", () => {
  const l = defaultLedger();
  applyInvestments(l, [inv("cdb")], ["item-1"], "2026-10-24");
  asset(l, "cdb").name = "Emergency fund";
  const r = applyInvestments(l, [inv("cdb", { balance: 1010 })], ["item-1"], TODAY);
  assert.equal(r.added, 0);
  assert.equal(r.updated, 1);
  assert.equal(l.investments.assets.length, 1);
  assert.equal(asset(l, "cdb").value, 1010_00);
  assert.equal(asset(l, "cdb").name, "Emergency fund");
});

test("a position the item no longer reports is closed and drops out of totals", () => {
  const l = defaultLedger();
  applyInvestments(l, [inv("a"), inv("b")], ["item-1"], "2026-10-24");
  const r = applyInvestments(l, [inv("a")], ["item-1"], TODAY);
  assert.equal(r.closed, 1);
  assert.equal(asset(l, "b").closed, true);
  assert.equal(portfolioValue(l), 1000_00);
});

test("positions of an item whose investments failed to load are not closed", () => {
  const l = defaultLedger();
  applyInvestments(l, [inv("a"), inv("x", { itemId: "item-2" })], ["item-1", "item-2"], "2026-10-24");
  // item-2 failed this time: missing data must not look like a withdrawal
  applyInvestments(l, [inv("a")], ["item-1"], TODAY);
  assert.equal(asset(l, "x").closed, undefined);
  assert.equal(portfolioValue(l), 2000_00);
});

test("a total withdrawal closes the position; it reopens if reported active again", () => {
  const l = defaultLedger();
  applyInvestments(l, [inv("a", { status: "TOTAL_WITHDRAWAL" })], ["item-1"], TODAY);
  assert.equal(asset(l, "a").closed, true);
  applyInvestments(l, [inv("a")], ["item-1"], TODAY);
  assert.equal(asset(l, "a").closed, undefined);
});

test("unknown cost (0 from Pluggy) is not treated as all profit", () => {
  const l = defaultLedger();
  applyInvestments(l, [inv("a", { amountOriginal: 0 })], ["item-1"], TODAY);
  assert.equal(asset(l, "a").invested, undefined);
  assert.equal(portfolioInvested(l), 1000_00);
});

test("Pluggy types map to asset classes", () => {
  assert.equal(assetClass({ type: "FIXED_INCOME", subtype: "TREASURY" }), "treasury");
  assert.equal(assetClass({ type: "EQUITY", subtype: "STOCK" }), "stock");
  assert.equal(assetClass({ type: "EQUITY", subtype: "REAL_ESTATE_FUND" }), "reit");
  assert.equal(assetClass({ type: "ETF" }), "etf");
  assert.equal(assetClass({ type: "SECURITY", subtype: "VGBL" }), "retirement");
  assert.equal(assetClass({ type: "MUTUAL_FUND", subtype: "MULTIMARKET_FUND" }), "fund");
  assert.equal(assetClass({ type: "COE" }), "other");
});

test("each sync records one snapshot per day, so history builds up over time", () => {
  const l = defaultLedger();
  applyInvestments(l, [inv("a")], ["item-1"], "2026-10-24");
  applyInvestments(l, [inv("a", { balance: 1100 })], ["item-1"], TODAY);
  applyInvestments(l, [inv("a", { balance: 1200 })], ["item-1"], TODAY);
  assert.deepEqual(
    l.investments.snapshots.map((s) => [s.date, s.value]),
    [
      ["2026-10-24", 1000_00],
      [TODAY, 1200_00],
    ]
  );
});

test("net worth includes investments, using the snapshot for past dates", () => {
  const l = defaultLedger();
  applyInvestments(l, [inv("a")], ["item-1"], "2026-09-15");
  applyInvestments(l, [inv("a", { balance: 1500 })], ["item-1"], TODAY);
  assert.equal(netWorth(l), 1500_00);
  assert.equal(netWorth(l, "2026-09-30"), 1000_00);
  // before the first snapshot nothing is known about the portfolio
  assert.equal(netWorth(l, "2026-08-31"), 0);
  // month end in the future still shows today's value
  assert.equal(netWorth(l, "2026-10-31"), 1500_00);
});

test("allocation groups open positions by class, largest first", () => {
  const l = defaultLedger();
  applyInvestments(
    l,
    [inv("cdb"), inv("petr", { type: "EQUITY", subtype: "STOCK", balance: 3000 }), inv("old", { status: "TOTAL_WITHDRAWAL", balance: 9999 })],
    ["item-1"],
    TODAY
  );
  assert.deepEqual(allocationByClass(l), [
    ["stock", 3000_00],
    ["fixed_income", 1000_00],
  ]);
});

test("ledgers from before investments existed load with an empty portfolio", () => {
  const l = parseLedger(JSON.stringify({ version: 2, accounts: [], categories: [], transactions: [], budgets: [], recurring: [] }));
  assert.deepEqual(l.investments, { assets: [], snapshots: [], movements: [] });
  assert.equal(l.version, 3);
});

// ---- movements and flows ----

function mov(id: string, type: string, date: string, amount: number, extra: Partial<PluggyInvestmentTransaction> = {}): PluggyInvestmentTransaction {
  return { id, type, date: `${date}T00:00:00.000Z`, amount, ...extra };
}

test("movements are imported once per Pluggy id and mapped to Trimly types", () => {
  const l = defaultLedger();
  const txs = [mov("b", "BUY", "2026-01-10", 900), mov("d", "INTEREST", "2026-09-15", 12.5), mov("t", "TRANSFER", "2026-09-20", 100, { movementType: "DEBIT" })];
  const r = applyInvestments(l, [inv("a", { transactions: txs })], ["item-1"], "2026-10-24");
  assert.equal(r.movements, 3);
  applyInvestments(l, [inv("a", { transactions: txs })], ["item-1"], TODAY);
  const ms = l.investments.movements;
  assert.equal(ms.length, 3);
  assert.deepEqual(ms.map((m) => [m.type, m.amount, m.direction]), [
    ["buy", 900_00, undefined],
    ["income", 12_50, undefined],
    ["transfer", 100_00, "out"],
  ]);
  assert.ok(ms.every((m) => m.assetId === asset(l, "a").id));
});

test("a movement that comes back with a new id is re-linked, not duplicated", () => {
  const l = defaultLedger();
  applyInvestments(l, [inv("a", { transactions: [mov("old", "BUY", "2026-10-20", 500)] })], ["item-1"], "2026-10-24");
  applyInvestments(l, [inv("a", { transactions: [mov("new", "BUY", "2026-10-21", 500)] })], ["item-1"], TODAY);
  assert.equal(l.investments.movements.length, 1);
  assert.equal(l.investments.movements[0].pluggyId, "new");
});

test("fees in netAmount are part of the money moved", () => {
  const l = defaultLedger();
  applyInvestments(l, [inv("a", { transactions: [mov("b", "BUY", "2026-10-20", 1000, { netAmount: 1002.5 })] })], ["item-1"], TODAY);
  assert.equal(l.investments.movements[0].amount, 1002_50);
});

test("a contribution recorded as a movement is not counted as return", () => {
  const l = defaultLedger();
  applyInvestments(l, [inv("a", { balance: 1000, amountOriginal: 1000, transactions: [] })], ["item-1"], "2026-10-01");
  // +500 bought and the position grew 10 on top
  applyInvestments(
    l,
    [inv("a", { balance: 1510, amountOriginal: 1500, transactions: [mov("b", "BUY", "2026-10-02", 500)] })],
    ["item-1"],
    "2026-10-02"
  );
  const snap = l.investments.snapshots[1];
  assert.equal(snap.flow, 500_00);
  assert.equal(snap.estimated, 0);
  const idx = portfolioIndex(l.investments.snapshots);
  assert.ok(Math.abs((periodReturn(idx, "2026-10-01", "2026-10-02") ?? 0) - 0.01) < 1e-9);
});

test("dividends paid out count as return even though the position's value doesn't grow", () => {
  const l = defaultLedger();
  const stock = { type: "EQUITY", subtype: "STOCK", balance: 1000, amountOriginal: 1000 };
  applyInvestments(l, [inv("s", { ...stock, transactions: [] })], ["item-1"], "2026-10-01");
  applyInvestments(l, [inv("s", { ...stock, transactions: [mov("d", "INTEREST", "2026-10-15", 20)] })], ["item-1"], "2026-10-31");
  assert.equal(l.investments.snapshots[1].income, 20_00);
  const idx = portfolioIndex(l.investments.snapshots);
  assert.ok(Math.abs((periodReturn(idx, "2026-10-01", "2026-10-31") ?? 0) - 0.02) < 1e-9);
});

test("a second sync on the same day measures flows from the previous day, without double counting", () => {
  const l = defaultLedger();
  applyInvestments(l, [inv("a", { balance: 1000, amountOriginal: 1000 })], ["item-1"], "2026-10-01");
  // no movements for this position: estimated from the amount invested, twice on the same day
  applyInvestments(l, [inv("a", { balance: 1200, amountOriginal: 1200 })], ["item-1"], "2026-10-02");
  applyInvestments(l, [inv("a", { balance: 1500, amountOriginal: 1500 })], ["item-1"], "2026-10-02");
  const snap = l.investments.snapshots[1];
  assert.equal(l.investments.snapshots.length, 2);
  assert.equal(snap.flow, 500_00);
  assert.equal(snap.estimated, 500_00);
});

test("a position first seen after history started arrives as money in, not as gain", () => {
  const l = defaultLedger();
  applyInvestments(l, [inv("a")], ["item-1", "item-2"], "2026-10-01");
  // a second bank linked later reports a position bought long ago
  applyInvestments(
    l,
    [inv("a"), inv("x", { itemId: "item-2", balance: 5000, transactions: [mov("old", "BUY", "2024-01-01", 4000)] })],
    ["item-1", "item-2"],
    "2026-10-02"
  );
  const idx = portfolioIndex(l.investments.snapshots);
  assert.ok(Math.abs(periodReturn(idx, "2026-10-01", "2026-10-02") ?? 1) < 1e-9);
});

test("a position that disappears is treated as withdrawn at its value", () => {
  const l = defaultLedger();
  applyInvestments(l, [inv("a"), inv("b")], ["item-1"], "2026-10-01");
  applyInvestments(l, [inv("a")], ["item-1"], "2026-10-02");
  assert.equal(l.investments.snapshots[1].flow, -1000_00);
  const idx = portfolioIndex(l.investments.snapshots);
  assert.ok(Math.abs(periodReturn(idx, "2026-10-01", "2026-10-02") ?? 1) < 1e-9);
});
