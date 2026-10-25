import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultLedger, newId, rebalance } from "../src/ledger.ts";
import type { AllocationTarget, AssetClass, Ledger } from "../src/ledger.ts";

function ledger(values: Partial<Record<AssetClass, number>>, targets: AllocationTarget[]): Ledger {
  const l = defaultLedger();
  for (const [assetClass, value] of Object.entries(values)) {
    l.investments.assets.push({ id: newId(), name: assetClass, assetClass: assetClass as AssetClass, value: value ?? 0, updatedAt: "2026-10-25" });
  }
  l.investments.targets = targets;
  return l;
}

const line = (lines: ReturnType<typeof rebalance>, c: AssetClass) => {
  const l = lines.find((x) => x.assetClass === c);
  assert.ok(l, c);
  return l;
};

test("no targets, no plan", () => {
  assert.deepEqual(rebalance(ledger({ stock: 1000_00 }, []), 500_00), []);
});

test("the gap says how far each class is from its target today", () => {
  const lines = rebalance(ledger({ fixed_income: 7000_00, stock: 3000_00 }, [
    { assetClass: "fixed_income", pct: 50 },
    { assetClass: "stock", pct: 50 },
  ]), 0);
  assert.equal(line(lines, "fixed_income").gap, -2000_00);
  assert.equal(line(lines, "stock").gap, 2000_00);
  assert.equal(line(lines, "stock").pct, 30);
});

test("a contribution goes to underweight classes first, never asking to sell", () => {
  const lines = rebalance(ledger({ fixed_income: 7000_00, stock: 3000_00 }, [
    { assetClass: "fixed_income", pct: 50 },
    { assetClass: "stock", pct: 50 },
  ]), 1000_00);
  // stocks are 2,500 behind the target after the contribution: all of it goes there
  assert.equal(line(lines, "stock").contribute, 1000_00);
  assert.equal(line(lines, "fixed_income").contribute, 0);
});

test("once every class is on target, the rest is split by target weight", () => {
  const lines = rebalance(ledger({ fixed_income: 5000_00, stock: 4000_00 }, [
    { assetClass: "fixed_income", pct: 50 },
    { assetClass: "stock", pct: 50 },
  ]), 3000_00);
  // after: 12,000 → 6,000 each; deficits 1,000 and 2,000 use it all
  assert.equal(line(lines, "fixed_income").contribute, 1000_00);
  assert.equal(line(lines, "stock").contribute, 2000_00);
  const total = lines.reduce((s, l) => s + l.contribute, 0);
  assert.equal(total, 3000_00);
});

test("contributions always add up to the cent, even with uneven splits", () => {
  const lines = rebalance(ledger({}, [
    { assetClass: "fixed_income", pct: 1 },
    { assetClass: "stock", pct: 1 },
    { assetClass: "reit", pct: 1 },
  ]), 100_00);
  assert.equal(lines.reduce((s, l) => s + l.contribute, 0), 100_00);
});

test("targets that don't add up to 100% are scaled, and untargeted classes count as 0%", () => {
  const lines = rebalance(ledger({ fixed_income: 1000_00, other: 1000_00 }, [{ assetClass: "fixed_income", pct: 40 }]), 0);
  assert.equal(line(lines, "fixed_income").target, 100);
  assert.equal(line(lines, "other").target, 0);
  assert.equal(line(lines, "other").gap, -1000_00);
});
