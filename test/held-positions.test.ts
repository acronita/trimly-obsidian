import { test } from "node:test";
import assert from "node:assert/strict";
import { applyInvestments } from "../src/investment-sync.ts";
import type { PluggyInvestment } from "../src/investment-sync.ts";
import { defaultLedger, portfolioValue } from "../src/ledger.ts";
import type { Ledger } from "../src/ledger.ts";
import { manualTreasuryPositions } from "../src/treasury.ts";

const DAY = "2026-11-20";
const NEXT = "2026-11-24";

const selic = (extra: Partial<PluggyInvestment> = {}): PluggyInvestment => ({
  id: "selic",
  itemId: "item-1",
  name: "LFT",
  type: "FIXED_INCOME",
  subtype: "TREASURY",
  balance: 6480,
  quantity: 0.33,
  dueDate: "2031-03-01T00:00:00.000Z",
  status: "ACTIVE",
  date: `${DAY}T00:00:00.000Z`,
  ...extra,
});
const fii = (extra: Partial<PluggyInvestment> = {}): PluggyInvestment => ({
  id: "xpml",
  itemId: "item-1",
  name: "XPML11",
  code: "XPML11",
  type: "EQUITY",
  subtype: "REAL_ESTATE_FUND",
  balance: 490,
  status: "ACTIVE",
  date: `${DAY}T00:00:00.000Z`,
  ...extra,
});
const fresh = { date: `${NEXT}T00:00:00.000Z` };

function synced(): Ledger {
  const l = defaultLedger();
  applyInvestments(l, [selic(), fii()], ["item-1"], DAY);
  return l;
}

const bond = (l: Ledger) => l.investments.assets.find((a) => a.pluggyId === "selic")!;

test("a Tesouro bond the bank reports zeroed, with no redemption, stays open at its last value", () => {
  const l = synced();
  // seen in the wild, with a current date: the stale-report guard can't catch it
  const r = applyInvestments(l, [selic({ ...fresh, balance: 0, quantity: 0, status: "TOTAL_WITHDRAWAL" }), fii(fresh)], ["item-1"], NEXT);
  assert.equal(r.closed, 0);
  assert.equal(r.held, 1);
  assert.equal(bond(l).closed, undefined);
  assert.equal(bond(l).value, 6480_00);
  assert.equal(bond(l).missingSince, NEXT);
  assert.equal(portfolioValue(l), 6480_00 + 490_00);
});

test("a Tesouro bond missing from the report stays open, while a FII missing still closes", () => {
  const l = synced();
  const r = applyInvestments(l, [], ["item-1"], NEXT);
  assert.equal(bond(l).closed, undefined);
  assert.equal(bond(l).missingSince, NEXT);
  // stocks and FIIs come with their sales; only the classes the bank fails on are held
  assert.equal(l.investments.assets.find((a) => a.pluggyId === "xpml")?.closed, true);
  assert.equal(r.held, 1);
});

test("a held bond is counted once, and goes back to the bank's numbers when reported with a value", () => {
  const l = synced();
  applyInvestments(l, [fii(fresh)], ["item-1"], NEXT);
  const again = applyInvestments(l, [fii(fresh)], ["item-1"], "2026-11-25");
  assert.equal(again.held, 0);
  assert.equal(bond(l).missingSince, NEXT);
  applyInvestments(l, [selic({ date: "2026-11-26T00:00:00.000Z", balance: 6500 }), fii(fresh)], ["item-1"], "2026-11-26");
  assert.equal(bond(l).missingSince, undefined);
  assert.equal(bond(l).value, 6500_00);
});

test("while held, a synced Tesouro bond is priced by Trimly like a manual one", () => {
  const l = synced();
  assert.equal(manualTreasuryPositions(l).length, 0);
  applyInvestments(l, [fii(fresh)], ["item-1"], NEXT);
  assert.deepEqual(manualTreasuryPositions(l).map((a) => a.pluggyId), ["selic"]);
});

const sellTx = (date: string) => ({ id: `s-${date}`, type: "SELL", date: `${date}T00:00:00.000Z`, amount: 6480, quantity: 0.33 });

test("a bond the bank reports withdrawn with its sale closes as before", () => {
  const l = synced();
  const r = applyInvestments(l, [selic({ ...fresh, balance: 0, status: "TOTAL_WITHDRAWAL", transactions: [sellTx("2026-11-23")] }), fii(fresh)], ["item-1"], NEXT);
  assert.equal(r.held, 0);
  // the sale is imported once, though the held check merged it first
  assert.equal(l.investments.movements.filter((m) => m.type === "sell").length, 1);
  assert.equal(bond(l).closed, true);
  assert.equal(bond(l).missingSince, undefined);
});

test("a matured bond missing from the report closes: it paid out", () => {
  const l = synced();
  applyInvestments(l, [fii(fresh)], ["item-1"], "2031-03-02");
  assert.equal(bond(l).closed, true);
});

test("a sale older than the last purchase, or than a month, is no proof the position ended", () => {
  const l = synced();
  const buy = { id: "b1", type: "BUY", date: "2026-11-10T00:00:00.000Z", amount: 1000, quantity: 0.05 };
  // sold before buying again: the bond was still held after the sale
  applyInvestments(l, [selic({ ...fresh, balance: 0, status: "TOTAL_WITHDRAWAL", transactions: [sellTx("2026-11-05"), buy] }), fii(fresh)], ["item-1"], NEXT);
  assert.equal(bond(l).closed, undefined);
  assert.equal(bond(l).missingSince, NEXT);
});
