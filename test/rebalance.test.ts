import { test } from "node:test";
import assert from "node:assert/strict";
import { taxKind } from "../src/income-tax.ts";
import { assetTargets, classAssets, defaultLedger, investableByClass, investableTotal, newId, parseLedger, portfolioValue, rebalance, reservedByAsset, reserveStatus } from "../src/ledger.ts";
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

function withReserve(amount: number, ...assets: [string, AssetClass, number][]): Ledger {
  const l = defaultLedger();
  for (const [id, assetClass, value] of assets) l.investments.assets.push({ id, name: id, assetClass, value, updatedAt: "2026-10-25" });
  l.investments.reserve = { amount, assetIds: ["selic"] };
  return l;
}

test("targets are shares of the portfolio without the reserve", () => {
  // with the 6,000 reserve counted, fixed income would look far above its 50%
  const l = withReserve(6000_00, ["selic", "treasury", 6000_00], ["cdb", "fixed_income", 2000_00], ["stock", "stock", 2000_00]);
  l.investments.targets = [{ assetClass: "fixed_income", pct: 50 }, { assetClass: "stock", pct: 50 }];
  const lines = rebalance(l, 0);
  assert.equal(line(lines, "fixed_income").pct, 50);
  assert.equal(line(lines, "stock").gap, 0);
  assert.equal(lines.some((x) => x.assetClass === "treasury"), false);
  assert.equal(investableTotal(l), 4000_00);
  assert.equal(portfolioValue(l), 10000_00, "the reserve is still the user's money");
});

test("what a marked position holds above the reserve's amount stays in the portfolio", () => {
  const l = withReserve(3000_00, ["selic", "treasury", 5000_00]);
  const status = reserveStatus(l);
  assert.deepEqual([status?.held, status?.missing, status?.surplus], [3000_00, 0, 2000_00]);
  assert.deepEqual(investableByClass(l), [["treasury", 2000_00]]);
});

test("a reserve bigger than what is marked says what is missing and leaves nothing in the portfolio", () => {
  const l = withReserve(5000_00, ["selic", "treasury", 3000_00]);
  const status = reserveStatus(l);
  assert.deepEqual([status?.held, status?.missing, status?.surplus], [3000_00, 2000_00, 0]);
  assert.deepEqual(investableByClass(l), []);
});

test("several marked positions give up the same proportion, to the cent", () => {
  const l = withReserve(1000_00, ["selic", "treasury", 3000_00], ["cdb", "fixed_income", 1000_00]);
  l.investments.reserve = { amount: 1000_01, assetIds: ["selic", "cdb"] };
  const reserved = reservedByAsset(l);
  assert.equal((reserved.get("selic") ?? 0) + (reserved.get("cdb") ?? 0), 1000_01);
  assert.equal(reserved.get("selic"), 750_01);
});

test("a closed position stops counting for the reserve", () => {
  const l = withReserve(1000_00, ["selic", "treasury", 1000_00]);
  l.investments.assets[0].closed = true;
  assert.equal(reserveStatus(l)?.missing, 1000_00);
});

test("a position entirely in the reserve gets no share of a contribution, a partial one counts what is left", () => {
  const whole = withReserve(1000_00, ["selic", "treasury", 1000_00], ["other", "treasury", 1000_00]);
  whole.investments.assets.forEach((a) => (a.weight = 1));
  assert.deepEqual(assetTargets(whole, "treasury", 100_00).map((x) => x.asset.id), ["other"]);

  const partial = withReserve(500_00, ["selic", "treasury", 1000_00], ["other", "treasury", 500_00]);
  partial.investments.assets.forEach((a) => (a.weight = 1));
  assert.deepEqual(assetTargets(partial, "treasury", 0).map((x) => x.pct), [50, 50]);
});

test("the reserve survives a reload, and a ledger without one stays without the field", () => {
  const l = withReserve(1000_00, ["selic", "treasury", 1000_00]);
  assert.deepEqual(parseLedger(JSON.stringify(l)).investments.reserve, { amount: 1000_00, assetIds: ["selic"] });
  assert.equal("reserve" in parseLedger(JSON.stringify(defaultLedger())).investments, false);
});

test("a ledger from the first 1.2.0 builds moves dollars into international and loses the ETF target", () => {
  const l = defaultLedger();
  l.investments.assets.push({ id: "d", name: "d", assetClass: "dollar" as AssetClass, value: 100_00, updatedAt: "2026-10-25" });
  l.investments.assets.push({ id: "e", name: "e", assetClass: "etf", targetClass: "dollar" as AssetClass, value: 100_00, updatedAt: "2026-10-25" });
  l.investments.assets.push({ id: "f", name: "f", assetClass: "fund", targetClass: "etf", value: 100_00, updatedAt: "2026-10-25" });
  l.investments.targets = [{ assetClass: "international", pct: 5 }, { assetClass: "dollar" as AssetClass, pct: 1 }, { assetClass: "etf", pct: 20 }, { assetClass: "stock", pct: 74 }];
  const { assets, targets } = parseLedger(JSON.stringify(l)).investments;
  assert.deepEqual(assets.map((a) => [a.assetClass, a.targetClass]), [["international", undefined], ["etf", "international"], ["fund", undefined]]);
  // the etf class must stay on the position, or income tax loses it
  assert.deepEqual(targets, [{ assetClass: "international", pct: 6 }, { assetClass: "stock", pct: 74 }]);
});

test("an ETF counted as international moves in the targets but stays an ETF for income tax", () => {
  const l = defaultLedger();
  l.investments.assets.push({ id: "i", name: "IVVB11", code: "IVVB11", assetClass: "etf", targetClass: "international", value: 1000_00, weight: 1, updatedAt: "2026-10-25" });
  l.investments.targets = [{ assetClass: "international", pct: 100 }];
  assert.equal(line(rebalance(l, 0), "international").value, 1000_00);
  assert.deepEqual(classAssets(l, "etf"), []);
  assert.equal(classAssets(l, "international").length, 1);
  assert.equal(taxKind(l.investments.assets[0]), "etf");
});
