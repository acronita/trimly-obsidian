import { test } from "node:test";
import assert from "node:assert/strict";
import { applyInvestments } from "../src/investment-sync.ts";
import { defaultLedger, newId, portfolioValue, removeManualAsset, removeManualMovement, saveAsset, saveManualMovement } from "../src/ledger.ts";
import type { Asset, Ledger, Movement } from "../src/ledger.ts";
import { periodReturn, portfolioIndex } from "../src/returns.ts";

const D1 = "2026-10-01";
const D2 = "2026-10-02";

function manual(value: number, extra: Partial<Asset> = {}): Asset {
  return { id: newId(), name: "Bitcoin", assetClass: "other", value, updatedAt: D1, ...extra };
}

function move(assetId: string, type: Movement["type"], date: string, amount: number, extra: Partial<Movement> = {}): Movement {
  return { id: newId(), assetId, type, date, amount, ...extra };
}

/** Return between the first and last snapshot. */
function totalReturn(l: Ledger): number {
  const idx = portfolioIndex(l.investments.snapshots);
  const r = periodReturn(idx, idx[0].date, idx[idx.length - 1].date);
  assert.ok(r !== null);
  return r;
}

function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);
}

/** A ledger with one manual position worth R$ 1,000 recorded on D1. */
function withPosition(): { l: Ledger; a: Asset } {
  const l = defaultLedger();
  const a = manual(1000_00, { invested: 1000_00 });
  saveAsset(l, a, D1);
  return { l, a };
}

test("adding a manual position later is money in, not gain", () => {
  const { l } = withPosition();
  saveAsset(l, manual(5000_00), D2);
  near(totalReturn(l), 0);
  assert.equal(portfolioValue(l), 6000_00);
});

test("updating a manual position's value is gain or loss", () => {
  const { l, a } = withPosition();
  saveAsset(l, { ...a, value: 1100_00 }, D2);
  near(totalReturn(l), 0.1);
});

test("a contribution raises value and cost without counting as return", () => {
  const { l, a } = withPosition();
  saveManualMovement(l, move(a.id, "buy", D2, 500_00, { quantity: 2 }), D2);
  const pos = l.investments.assets[0];
  assert.equal(pos.value, 1500_00);
  assert.equal(pos.invested, 1500_00);
  assert.equal(pos.quantity, 2);
  near(totalReturn(l), 0);
});

test("a backdated contribution still counts as money in today", () => {
  const { l, a } = withPosition();
  saveAsset(l, { ...a }, D2); // a snapshot on D2 so D1 is the window start
  saveManualMovement(l, move(a.id, "buy", "2026-09-01", 500_00), D2);
  near(totalReturn(l), 0);
});

test("a withdrawal takes cost off at average cost and is not a loss", () => {
  const { l, a } = withPosition();
  saveAsset(l, { ...a, value: 2000_00 }, D2); // doubled: +100%
  saveManualMovement(l, move(a.id, "sell", D2, 1000_00), D2);
  const pos = l.investments.assets[0];
  assert.equal(pos.value, 1000_00);
  // half the position sold, half the cost gone
  assert.equal(pos.invested, 500_00);
  near(totalReturn(l), 1);
});

test("tax lowers the value as a cost; income is a gain without changing the value", () => {
  const { l, a } = withPosition();
  saveManualMovement(l, move(a.id, "tax", D2, 10_00), D2);
  saveManualMovement(l, move(a.id, "income", D2, 30_00), D2);
  assert.equal(l.investments.assets[0].value, 990_00);
  near(totalReturn(l), 0.02);
});

test("deleting a movement undoes its effect exactly", () => {
  const { l, a } = withPosition();
  const sell = move(a.id, "sell", D2, 400_00);
  saveManualMovement(l, sell, D2);
  removeManualMovement(l, sell.id, D2);
  const pos = l.investments.assets[0];
  assert.equal(pos.value, 1000_00);
  assert.equal(pos.invested, 1000_00);
  assert.equal(l.investments.movements.length, 0);
  near(totalReturn(l), 0);
});

test("editing a movement replaces its effect instead of adding to it", () => {
  const { l, a } = withPosition();
  const buy = move(a.id, "buy", D2, 500_00);
  saveManualMovement(l, buy, D2);
  saveManualMovement(l, { ...buy, amount: 200_00 }, D2);
  assert.equal(l.investments.assets[0].value, 1200_00);
  assert.equal(l.investments.movements.length, 1);
  near(totalReturn(l), 0);
});

test("closing a manual position counts as withdrawing it", () => {
  const { l, a } = withPosition();
  saveAsset(l, manual(500_00), D1);
  saveAsset(l, { ...a, closed: true }, D2);
  assert.equal(portfolioValue(l), 500_00);
  near(totalReturn(l), 0);
});

test("deleting a manual position removes it and its movements without a loss", () => {
  const { l, a } = withPosition();
  saveAsset(l, manual(500_00), D1);
  saveManualMovement(l, move(a.id, "income", "2026-09-15", 5_00), D2);
  removeManualAsset(l, a.id, D2);
  assert.equal(l.investments.assets.length, 1);
  assert.equal(l.investments.movements.length, 0);
  near(totalReturn(l), 0);
});

test("a bank sync later the same day keeps the manual contribution's flow", () => {
  const { l, a } = withPosition();
  saveManualMovement(l, move(a.id, "buy", D2, 500_00), D2);
  applyInvestments(l, [], [], D2);
  near(totalReturn(l), 0);
  assert.equal(l.investments.snapshots[l.investments.snapshots.length - 1].flow, 500_00);
});

test("movements can't be added to synced positions", () => {
  const l = defaultLedger();
  const synced = manual(1000_00, { pluggyId: "p1" });
  l.investments.assets.push(synced);
  saveManualMovement(l, move(synced.id, "buy", D1, 100_00), D1);
  assert.equal(l.investments.movements.length, 0);
  assert.equal(synced.value, 1000_00);
});
