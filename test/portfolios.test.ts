import { test } from "node:test";
import assert from "node:assert/strict";
import { applyInvestments } from "../src/investment-sync.ts";
import { defaultLedger, netWorth, parseLedger, portfolioLedger, portfolioValue, rebalance, removePortfolio, savePortfolio, setPortfolioTarget } from "../src/ledger.ts";
import type { Asset, AssetClass, Ledger } from "../src/ledger.ts";

function position(id: string, assetClass: AssetClass, value: number, portfolioId?: string): Asset {
  const a: Asset = { id, name: id, assetClass, value, updatedAt: "2026-11-05" };
  if (portfolioId) a.portfolioId = portfolioId;
  return a;
}

function setup(): Ledger {
  const l = defaultLedger();
  l.investments.assets = [position("cdb", "fixed_income", 1000_00), position("fii", "reit", 3000_00, "ret"), position("etf", "etf", 1000_00, "ret")];
  l.investments.targets = [{ assetClass: "fixed_income", pct: 100 }];
  savePortfolio(l, { id: "ret", name: "Aposentadoria", targets: [{ assetClass: "reit", pct: 50 }, { assetClass: "etf", pct: 50 }] });
  return l;
}

const ids = (l: Ledger) => l.investments.assets.map((a) => a.id);

test("a portfolio sees only its positions and its targets", () => {
  const l = portfolioLedger(setup(), "ret");
  assert.deepEqual(ids(l), ["fii", "etf"]);
  assert.equal(portfolioValue(l), 4000_00);
  assert.deepEqual(l.investments.targets.map((t) => t.assetClass), ["reit", "etf"]);
});

test("the main portfolio is whatever is in no other, with the ledger's own targets", () => {
  const l = portfolioLedger(setup(), "");
  assert.deepEqual(ids(l), ["cdb"]);
  assert.deepEqual(l.investments.targets, [{ assetClass: "fixed_income", pct: 100 }]);
});

test("each portfolio rebalances against its own total, not the whole wealth", () => {
  const lines = rebalance(portfolioLedger(setup(), "ret"), 2000_00);
  // 6,000 after → 3,000 each: the ETF is 2,000 behind, the FII on target
  assert.equal(lines.find((x) => x.assetClass === "etf")?.contribute, 2000_00);
  assert.equal(lines.find((x) => x.assetClass === "reit")?.contribute, 0);
  assert.equal(lines.some((x) => x.assetClass === "fixed_income"), false);
});

test("net worth still counts every portfolio", () => {
  assert.equal(netWorth(setup()), 5000_00);
});

test("with no portfolios, everything is the main one, as before the feature existed", () => {
  const l = defaultLedger();
  l.investments.assets = [position("a", "stock", 100)];
  assert.deepEqual(ids(portfolioLedger(l, "")), ["a"]);
  assert.deepEqual(ids(portfolioLedger(l, "gone")), ["a"]);
});

test("a position pointing at a portfolio that no longer exists shows in the main one, instead of vanishing", () => {
  const l = setup();
  l.investments.assets.push(position("lost", "stock", 100, "gone"));
  assert.deepEqual(ids(portfolioLedger(l, "")), ["cdb", "lost"]);
});

test("removing a portfolio returns its positions to the main one and leaves its targets out of it", () => {
  const l = setup();
  removePortfolio(l, "ret");
  assert.equal(l.investments.portfolios, undefined);
  assert.deepEqual(ids(portfolioLedger(l, "")), ["cdb", "fii", "etf"]);
  assert.deepEqual(l.investments.targets, [{ assetClass: "fixed_income", pct: 100 }]);
  assert.ok(l.investments.assets.every((a) => !a.portfolioId));
});

test("a target set in one portfolio doesn't touch another's", () => {
  const l = setup();
  setPortfolioTarget(l, "ret", "reit", 70);
  setPortfolioTarget(l, "", "stock", 20);
  assert.deepEqual(l.investments.portfolios?.[0].targets, [{ assetClass: "etf", pct: 50 }, { assetClass: "reit", pct: 70 }]);
  assert.deepEqual(l.investments.targets, [{ assetClass: "fixed_income", pct: 100 }, { assetClass: "stock", pct: 20 }]);
  setPortfolioTarget(l, "", "stock", 0);
  assert.deepEqual(l.investments.targets, [{ assetClass: "fixed_income", pct: 100 }]);
});

test("reading a portfolio doesn't change the real ledger", () => {
  const l = setup();
  portfolioLedger(l, "ret");
  assert.equal(l.investments.assets.length, 3);
});

test("portfolios and a position's place survive a reload, and renaming keeps the targets", () => {
  const l = setup();
  savePortfolio(l, { id: "ret", name: "Renda", targets: l.investments.portfolios?.[0].targets ?? [] });
  const back = parseLedger(JSON.stringify(l));
  assert.equal(back.investments.portfolios?.length, 1);
  assert.equal(back.investments.portfolios?.[0].name, "Renda");
  assert.equal(back.investments.portfolios?.[0].targets.length, 2);
  assert.equal(back.investments.assets[1].portfolioId, "ret");
});

test("a synced position stays in its portfolio after the next sync", () => {
  const l = defaultLedger();
  const inv = { id: "cdb", itemId: "item-1", name: "cdb", type: "FIXED_INCOME", subtype: "CDB", balance: 1000, status: "ACTIVE" };
  applyInvestments(l, [inv], ["item-1"], "2026-10-24");
  l.investments.assets[0].portfolioId = "ret";
  applyInvestments(l, [{ ...inv, balance: 1100 }], ["item-1"], "2026-10-25");
  assert.equal(l.investments.assets[0].portfolioId, "ret");
});
