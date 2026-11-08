import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultLedger, newId, saveAsset } from "../src/ledger.ts";
import type { Asset } from "../src/ledger.ts";
import { applyQuotes, averagePrice, institutionOf, quoteTickers, tickerOf, fundManager } from "../src/quotes.ts";
import { periodReturn, portfolioIndex } from "../src/returns.ts";

const asset = (extra: Partial<Asset>): Asset => ({ id: newId(), name: "x", assetClass: "stock", value: 0, updatedAt: "2026-10-01", ...extra });

test("only B3 tickers are quoted; the fractional F is dropped", () => {
  assert.equal(tickerOf({ code: "petr4" }), "PETR4");
  assert.equal(tickerOf({ code: "HGLG11" }), "HGLG11");
  assert.equal(tickerOf({ code: "PETR4F" }), "PETR4");
  assert.equal(tickerOf({ code: "CDB224AXYZ1" }), null);
  assert.equal(tickerOf({ code: "LFT" }), null);
  assert.equal(tickerOf({}), null);
});

test("each open ticker is requested once", () => {
  const l = defaultLedger();
  l.investments.assets.push(asset({ code: "PETR4" }), asset({ code: "PETR4", pluggyId: "p" }), asset({ code: "VALE3", closed: true }));
  assert.deepEqual(quoteTickers(l), ["PETR4"]);
});

test("a manual position with quantity is revalued at the quote", () => {
  const l = defaultLedger();
  const a = asset({ code: "PETR4", quantity: 100, value: 3000_00, invested: 3000_00 });
  saveAsset(l, a, "2026-10-01");
  const n = applyQuotes(l, [{ symbol: "PETR4", price: 38.21, changePct: 1.5, longName: "Petróleo Brasileiro S.A. - Petrobras" }], "2026-10-02");
  assert.equal(n, 1);
  const pos = l.investments.assets[0];
  assert.equal(pos.value, 3821_00);
  assert.equal(pos.quote?.price, 38_21);
  assert.equal(pos.quote?.longName, "Petróleo Brasileiro S.A. - Petrobras");
  // the price change is market return, not money put in
  const idx = portfolioIndex(l.investments.snapshots);
  const r = periodReturn(idx, "2026-10-01", "2026-10-02");
  assert.ok(r !== null && Math.abs(r - (3821 / 3000 - 1)) < 1e-9);
});

test("a synced position keeps its bank value but shows the quote", () => {
  const l = defaultLedger();
  l.investments.assets.push(asset({ code: "VALE3", quantity: 10, value: 600_00, pluggyId: "p" }));
  applyQuotes(l, [{ symbol: "VALE3", price: 61 }], "2026-10-02");
  assert.equal(l.investments.assets[0].value, 600_00);
  assert.equal(l.investments.assets[0].quote?.price, 61_00);
});

test("a position without quantity only gets the quote", () => {
  const l = defaultLedger();
  l.investments.assets.push(asset({ code: "BOVA11", value: 1000_00 }));
  applyQuotes(l, [{ symbol: "BOVA11", price: 120 }], "2026-10-02");
  assert.equal(l.investments.assets[0].value, 1000_00);
  assert.equal(l.investments.snapshots.length, 0);
});

test("quote stats and the 3-month history are stored in cents, history by day", () => {
  const l = defaultLedger();
  l.investments.assets.push(asset({ code: "PETR4", value: 1000_00, pluggyId: "p" }));
  const day = (iso: string) => new Date(`${iso}T12:00:00`).getTime() / 1000;
  applyQuotes(
    l,
    [{ symbol: "PETR4", price: 58.68, low52: 29.53, high52: 59.79, pe: 5.67, eps: 10.35, marketCap: 788886152374, history: [[day("2026-10-22"), 57.83], [day("2026-10-23"), 58.68]] }],
    "2026-10-25"
  );
  const q = l.investments.assets[0].quote;
  assert.equal(q?.low52, 29_53);
  assert.equal(q?.high52, 59_79);
  assert.equal(q?.eps, 10_35);
  assert.deepEqual(q?.history, [["2026-10-22", 57_83], ["2026-10-23", 58_68]]);
});

test("average price is cost per share; unknown without quantity or cost", () => {
  assert.equal(averagePrice({ invested: 3000_00, quantity: 100 }), 30_00);
  assert.equal(averagePrice({ invested: 3000_00 }), null);
  assert.equal(averagePrice({ quantity: 100 }), null);
});

test("a position without an institution is shown under its quoted company or fund name", () => {
  assert.deepEqual(institutionOf({ assetClass: "reit", quote: { price: 1, longName: "CSHG Logística FII" } }), {
    name: "CSHG Logística FII",
    via: "quote",
  });
  // what the bank or the user set always wins
  assert.deepEqual(institutionOf({ assetClass: "stock", institution: "XP", quote: { price: 1, longName: "Petrobras" } }), { name: "XP" });
  // Tesouro Direto has no quote on the free plan, but its issuer is always the same
  assert.deepEqual(institutionOf({ assetClass: "treasury" }), { name: "Tesouro Nacional", via: "issuer" });
  assert.equal(institutionOf({ assetClass: "fund" }), null);
});

test("a fund with no institution shows the manager in its own name", () => {
  const a = { assetClass: "reit" as const, name: "KNCR11", pluggyName: "KINEA RENDIMENTOS IMOBILIÁRIOS FDO INV IMOB -" };
  assert.deepEqual(institutionOf(a), { name: "Kinea", via: "name" });
  assert.equal(fundManager("XP MALLS FII"), "XP");
  assert.equal(fundManager("FUNDO DE INVESTIMENTO IMOBILIARIO VINCI LOGISTICA"), "Vinci");
});

test("a bare ticker or a position that isn't a fund names no manager", () => {
  assert.equal(fundManager("KNCR11"), null);
  assert.equal(institutionOf({ assetClass: "fixed_income", name: "BANCO XYZ CDB" }), null);
});
