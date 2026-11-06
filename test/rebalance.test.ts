import { test } from "node:test";
import assert from "node:assert/strict";
import { assetTargets, defaultLedger, newId, parseLedger, rebalance } from "../src/ledger.ts";
import type { AllocationTarget, Asset, AssetClass, Ledger } from "../src/ledger.ts";

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

function reits(...assets: [string, number, number?][]): Ledger {
  const l = defaultLedger();
  for (const [id, value, weight] of assets) {
    const a: Asset = { id, name: id, assetClass: "reit", value, updatedAt: "2026-10-25" };
    if (weight !== undefined) a.weight = weight;
    l.investments.assets.push(a);
  }
  return l;
}

const assetLine = (lines: ReturnType<typeof assetTargets>, id: string) => {
  const l = lines.find((x) => x.asset.id === id);
  assert.ok(l, id);
  return l;
};

test("without any weight in a class, the plan stops at the class", () => {
  assert.deepEqual(assetTargets(reits(["a", 1000_00], ["b", 1000_00]), "reit", 500_00), []);
});

test("a class's contribution goes to its most underweight position, never asking to sell", () => {
  const lines = assetTargets(reits(["a", 7000_00, 5], ["b", 3000_00, 5]), "reit", 1000_00);
  // after: 11,000 → 5,500 each; only b is behind
  assert.equal(assetLine(lines, "b").contribute, 1000_00);
  assert.equal(assetLine(lines, "a").contribute, 0);
  assert.equal(assetLine(lines, "b").pct, 30);
});

test("weights are relative, so a score from 1 to 10 works the same as percents", () => {
  const scores = assetTargets(reits(["a", 0, 8], ["b", 0, 2]), "reit", 1000_00);
  const percents = assetTargets(reits(["a", 0, 80], ["b", 0, 20]), "reit", 1000_00);
  assert.equal(assetLine(scores, "a").target, 80);
  assert.equal(assetLine(scores, "a").contribute, 800_00);
  assert.equal(assetLine(percents, "a").contribute, 800_00);
});

test("a position left without a weight gets nothing once others have one", () => {
  const lines = assetTargets(reits(["a", 1000_00, 1], ["b", 0]), "reit", 500_00);
  assert.equal(assetLine(lines, "b").target, 0);
  assert.equal(assetLine(lines, "b").contribute, 0);
  assert.equal(assetLine(lines, "a").contribute, 500_00);
});

test("a position with a weight and nothing in it yet can receive the first contribution", () => {
  const lines = assetTargets(reits(["a", 1000_00, 1], ["new", 0, 1]), "reit", 1000_00);
  assert.equal(assetLine(lines, "new").contribute, 1000_00);
});

test("the positions' contributions add up to the class's, to the cent", () => {
  const lines = assetTargets(reits(["a", 0, 1], ["b", 0, 1], ["c", 0, 1]), "reit", 100_00);
  assert.equal(lines.reduce((s, l) => s + l.contribute, 0), 100_00);
});

test("positions behind their weight share the contribution by how far behind each one is", () => {
  const lines = assetTargets(reits(["a", 900_00, 3], ["b", 100_00, 1]), "reit", 400_00);
  // after: 1,400 → 1,050 and 350; deficits 150 and 250 use it all
  assert.equal(assetLine(lines, "a").contribute, 150_00);
  assert.equal(assetLine(lines, "b").contribute, 250_00);
});

test("closed positions and other classes stay out, and a weight survives a reload", () => {
  const l = reits(["a", 1000_00, 1], ["gone", 5000_00, 9]);
  l.investments.assets[1].closed = true;
  l.investments.assets.push({ id: "s", name: "s", assetClass: "stock", value: 1000_00, weight: 9, updatedAt: "2026-10-25" });
  assert.deepEqual(assetTargets(l, "reit", 100_00).map((x) => x.asset.id), ["a"]);
  assert.equal(parseLedger(JSON.stringify(l)).investments.assets[0].weight, 1);
});
