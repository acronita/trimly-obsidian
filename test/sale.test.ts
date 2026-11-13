import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SALE_RULES, iofPct, monthsToTargets, simulateSale } from "../src/sale.ts";
import type { SaleInput, SaleResult } from "../src/sale.ts";
import { defaultLedger } from "../src/ledger.ts";
import type { Asset, Ledger, MovementType } from "../src/ledger.ts";

const TODAY = "2026-11-12";

function position(id: string, extra: Partial<Asset>): Asset {
  return { id, name: id.toUpperCase(), assetClass: "stock", updatedAt: TODAY, value: 0, ...extra };
}

let n = 0;
function move(l: Ledger, assetId: string, date: string, type: MovementType, amount: number, quantity?: number) {
  l.investments.movements.push({ id: `m${n++}`, assetId, date, type, amount, quantity });
}

/**
 * FIIs 55% of the portfolio against a 30% target: HGRE11 (100 at R$ 100, now R$ 120), TGAR11
 * (100 at R$ 150, now R$ 100, a loss), stocks 25% against 40%, Tesouro 20% against 30%.
 */
function portfolio(): Ledger {
  const l = defaultLedger();
  l.investments.assets.push(
    position("hgre", { name: "HGRE11", code: "HGRE11", assetClass: "reit", quantity: 100, value: 12_000_00, invested: 10_000_00, quote: { price: 120_00 } }),
    position("tgar", { name: "TGAR11", code: "TGAR11", assetClass: "reit", quantity: 100, value: 10_000_00, invested: 15_000_00, quote: { price: 100_00 } }),
    position("bbas", { name: "BBAS3", code: "BBAS3", assetClass: "stock", quantity: 400, value: 10_000_00, invested: 8_000_00, quote: { price: 25_00 } }),
    position("selic", { name: "Tesouro Selic", assetClass: "treasury", value: 8_000_00 })
  );
  move(l, "hgre", "2026-01-05", "buy", 10_000_00, 100);
  move(l, "tgar", "2026-01-05", "buy", 15_000_00, 100);
  move(l, "bbas", "2026-01-05", "buy", 8_000_00, 400);
  // HGRE11 paid R$ 1 a share in each of the last 12 months
  for (let m = 1; m <= 12; m++) move(l, "hgre", `2026-${String(m).padStart(2, "0")}-10`.replace("2026-12", "2025-12"), "income", 100_00);
  l.investments.targets = [{ assetClass: "reit", pct: 30 }, { assetClass: "stock", pct: 40 }, { assetClass: "treasury", pct: 30 }];
  return l;
}

function sell(l: Ledger, extra: Partial<SaleInput> = {}): SaleResult {
  const r = simulateSale(l, { assetId: "hgre", quantity: 50, price: 120_00, costs: 0, monthly: 0, today: TODAY, ...extra });
  assert.ok(r);
  return r;
}

const rule = (r: SaleResult, id: string) => r.rules.find((x) => x.id === id)!;

test("an FII sale pays 20% on the gain over the average cost of the IR tab, with no exemption", () => {
  const r = sell(portfolio(), { costs: 10_00 });
  assert.equal(r.gross, 6_000_00);
  assert.equal(r.averagePrice, 100_00);
  // 6.000 − 10 of costs − 5.000 of cost
  assert.equal(r.gain, 990_00);
  assert.equal(r.tax, 198_00);
  assert.equal(r.net, 6_000_00 - 10_00 - 198_00);
  assert.equal(r.exempt, false);
});

test("a stock sale up to R$ 20.000 in the month pays no tax, but an ETF sale does", () => {
  const l = portfolio();
  const stock = simulateSale(l, { assetId: "bbas", quantity: 400, price: 25_00, costs: 0, monthly: 0, today: TODAY })!;
  assert.equal(stock.gain, 2_000_00);
  assert.equal(stock.tax, 0);
  assert.equal(stock.exempt, true);
  l.investments.assets.push(position("bova", { code: "BOVA11", assetClass: "etf", quantity: 10, value: 1_500_00, invested: 1_000_00 }));
  move(l, "bova", "2026-01-05", "buy", 1_000_00, 10);
  const etf = simulateSale(l, { assetId: "bova", quantity: 10, price: 150_00, costs: 0, monthly: 0, today: TODAY })!;
  assert.equal(etf.tax, 75_00);
});

test("losses carried in FIIs offset an FII gain, but not a stock gain", () => {
  const l = portfolio();
  // TGAR11 sold at a loss in October: R$ 2.000 left to offset
  move(l, "tgar", "2026-10-05", "sell", 1_000_00, 20);
  l.investments.assets.find((a) => a.id === "tgar")!.quantity = 80;
  const fii = sell(l);
  assert.equal(fii.lossAvailable, 2_000_00);
  assert.equal(fii.lossUsed, 1_000_00);
  assert.equal(fii.tax, 0);
  // a stock sale above the exemption still pays: FII losses are a separate group
  l.investments.assets.find((a) => a.id === "bbas")!.quantity = 1000;
  move(l, "bbas", "2026-02-05", "buy", 12_000_00, 600);
  const stock = simulateSale(l, { assetId: "bbas", quantity: 1000, price: 25_00, costs: 0, monthly: 0, today: TODAY })!;
  assert.equal(stock.lossAvailable, 0);
  assert.equal(stock.tax, 750_00);
});

test("the proventos the sold shares paid in the last 12 months are what the sale gives up", () => {
  const r = sell(portfolio());
  // half the shares, half of R$ 1.200
  assert.equal(r.income12m, 600_00);
  assert.equal(r.incomeYield, 10);
});

test("the allocation after the sale moves the money from the class to its destination", () => {
  const r = sell(portfolio(), { destination: "stock" });
  const reit = r.allocation.find((a) => a.assetClass === "reit")!;
  const stock = r.allocation.find((a) => a.assetClass === "stock")!;
  assert.equal(Math.round(reit.now), 55);
  assert.equal(reit.target, 30);
  assert.ok(reit.after < reit.now && stock.after > stock.now);
});

test("rules: a class 25 points above target, with a destination below target, from a position not in the reserve", () => {
  const r = sell(portfolio(), { destination: "stock" });
  assert.equal(rule(r, "band").status, "pass");
  assert.equal(rule(r, "destination").status, "pass");
  assert.equal(rule(r, "exemptIncome").status, "pass");
  assert.equal(rule(r, "reserve").status, "pass");
  assert.equal(rule(r, "preferAporte").status, "na");
});

test("rules: selling with tax while a loss-making FII could go first, tax too high, and no destination", () => {
  const r = sell(portfolio());
  // TGAR11 sells at a loss: no tax, so it comes first
  assert.deepEqual(rule(r, "order").detail, { first: ["TGAR11"], because: "noTax" });
  assert.equal(rule(r, "order").status, "fail");
  assert.equal(rule(r, "cost").status, "fail");
  assert.equal(rule(r, "destination").status, "fail");
  // giving up exempt income with nowhere better to go
  assert.equal(rule(r, "exemptIncome").status, "fail");
  assert.equal(sell(portfolio(), { destinationYield: 12 }).rules.find((x) => x.id === "exemptIncome")!.status, "pass");
});

test("rules: a position of the emergency reserve is never sold to rebalance", () => {
  const l = portfolio();
  l.investments.reserve = { amount: 1_000_00, assetIds: ["hgre"] };
  assert.equal(rule(sell(l), "reserve").status, "fail");
});

test("rules can be turned off and their limits changed", () => {
  const r = simulateSale(portfolio(), { assetId: "hgre", quantity: 50, price: 120_00, costs: 0, monthly: 0, today: TODAY }, { ...DEFAULT_SALE_RULES, band: 30, maxCostPct: 5, off: ["order"] })!;
  assert.equal(rule(r, "band").status, "fail");
  assert.equal(rule(r, "cost").status, "pass");
  assert.equal(r.rules.some((x) => x.id === "order"), false);
});

test("without selling: months of aportes until no class is more than the band above its target", () => {
  const l = portfolio();
  // FIIs R$ 22.000 of R$ 40.000; at 35% (30 + 5) they need a R$ 62.857 portfolio: R$ 22.857 of aportes
  assert.equal(monthsToTargets(l, 2_000_00, 5), 12);
  assert.equal(monthsToTargets(l, 0, 5), null);
  // previdência takes its slice first, so it takes longer
  l.investments.pensionShare = { value: 50, unit: "pct" };
  assert.equal(monthsToTargets(l, 2_000_00, 5), 23);
  const r = sell(l, { monthly: 4_000_00 });
  assert.equal(r.monthsWithoutSelling, 12);
  assert.equal(rule(r, "preferAporte").status, "fail");
});

/** A CDB of R$ 16.500 gross: R$ 10.000 applied 680 days ago, R$ 5.000 applied 23 days ago. */
function cdb(extra: Partial<Asset> = {}): Ledger {
  const l = defaultLedger();
  l.investments.assets.push(position("cdb", { name: "CDB Banco X", assetClass: "fixed_income", subtype: "CDB", value: 16_200_00, grossValue: 16_500_00, invested: 15_000_00, ...extra }));
  move(l, "cdb", "2025-01-01", "buy", 10_000_00);
  move(l, "cdb", "2026-10-20", "buy", 5_000_00);
  return l;
}

const redeem = (l: Ledger, amount?: number) => simulateSale(l, { assetId: "cdb", quantity: 0, price: 0, amount, costs: 0, monthly: 0, today: TODAY })!;

test("a fixed income redemption takes the oldest application first, taxed by the regressive table for its days", () => {
  const r = redeem(cdb(), 11_000_00);
  // R$ 11.000 of the old application, which grew 10%: R$ 1.000 of gain at 17,5% (361 to 720 days)
  assert.equal(r.kind, "fixed");
  assert.equal(r.fixed!.cost, 10_000_00);
  assert.equal(r.gain, 1_000_00);
  assert.equal(r.fixed!.iof, 0);
  assert.equal(r.tax, 175_00);
  assert.equal(r.net, 11_000_00 - 175_00);
  assert.equal(r.fixed!.maxDays, 680);
});

test("redeeming all of it reaches the new application too, which pays IOF under 30 days and 22,5% on the rest", () => {
  const r = redeem(cdb());
  assert.equal(r.gross, 16_500_00);
  // R$ 500 of gain after 23 days: 23% of IOF, then 22,5% on the R$ 385 left
  assert.equal(r.fixed!.iof, 115_00);
  assert.equal(r.fixed!.ir, Math.round(175_00 + 385_00 * 0.225));
  assert.deepEqual([r.fixed!.minDays, r.fixed!.maxDays], [23, 680]);
});

test("IOF falls from 96% on the first day to nothing at 30 days", () => {
  assert.equal(iofPct(1), 96);
  assert.equal(iofPct(4), 86);
  assert.equal(iofPct(29), 3);
  assert.equal(iofPct(30), 0);
});

test("an LCI pays no income tax, but IOF still applies under 30 days", () => {
  const r = redeem(cdb({ subtype: "LCI", name: "LCI Banco X" }));
  assert.equal(r.fixed!.taxFree, true);
  assert.equal(r.fixed!.ir, 0);
  assert.equal(r.fixed!.iof, 115_00);
});

test("a position without movements counts as one application from when Trimly started tracking it", () => {
  const l = defaultLedger();
  l.investments.assets.push(position("cdb", { assetClass: "treasury", value: 11_000_00, invested: 10_000_00, addedOn: "2026-06-01" }));
  const r = redeem(l);
  assert.equal(r.fixed!.estimated, true);
  // 164 days: 22,5%
  assert.equal(r.tax, 225_00);
});

test("order rule: a taxed redemption fails while a tax-free position of the same class could go first", () => {
  const l = cdb();
  l.investments.assets.push(position("lca", { name: "LCA Banco Y", assetClass: "fixed_income", subtype: "LCA", value: 5_000_00, invested: 4_800_00 }));
  move(l, "lca", "2026-01-05", "buy", 4_800_00);
  assert.deepEqual(rule(redeem(l, 11_000_00), "order").detail, { first: ["LCA Banco Y"], because: "noTax" });
});
