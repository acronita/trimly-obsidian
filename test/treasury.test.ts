import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultLedger, parseLedger } from "../src/ledger.ts";
import type { Asset, Ledger } from "../src/ledger.ts";
import { applyTreasuryPrices, findBond, manualTreasuryPositions, parseTreasuryPrices } from "../src/treasury.ts";

const TODAY = "2026-11-05";
const HEADER = "Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha";

/** The file's real shape: newest day first, CRLF, decimal commas. */
const CSV = [
  HEADER,
  "Tesouro Selic;01/03/2029;30/10/2026;0,06;0,07;20185,67;20170,66;20170,66",
  "Tesouro IPCA+;15/05/2035;30/10/2026;7,10;7,22;2000,00;1950,50;1950,50",
  "Tesouro IPCA+ com Juros Semestrais;15/05/2035;30/10/2026;7,00;7,12;4400,00;4350,25;4350,25",
  "Tesouro Renda+ Aposentadoria Extra;15/12/2065;30/10/2026;7,00;7,12;900,00;880,10;880,10",
  "Tesouro Prefixado;01/01/2029;30/10/2026;13,00;13,12;700,00;690,00;690,00",
  "Tesouro Prefixado;01/07/2029;30/10/2026;13,00;13,12;650,00;640,00;640,00",
  "Tesouro Selic;01/03/2029;29/10/2026;0,06;0,07;20175,46;20160,46;20160,46",
  "Tesouro Selic;01/03/2021;02/01/2020;0,06;0,07;1,00;2,00;2,00",
].join("\r\n");

const data = parseTreasuryPrices(CSV);
assert.ok(data);

function position(extra: Partial<Asset> = {}): Asset {
  return { id: "t", name: "Tesouro IPCA+ 2035", assetClass: "treasury", quantity: 2.5, value: 1000_00, updatedAt: "2026-01-01", ...extra };
}

function ledgerWith(...assets: Asset[]): Ledger {
  const l = defaultLedger();
  l.investments.assets = assets;
  return l;
}

test("only the newest day counts, wherever it is in the file, and a bond gone from it has no price", () => {
  assert.equal(data.date, "2026-10-30");
  assert.equal(data.prices.length, 6);
  assert.deepEqual(data.prices[0], { type: "Tesouro Selic", due: "2029-03-01", price: 20170_66 });
  const shuffled = parseTreasuryPrices([HEADER, "Tesouro Selic;01/03/2029;29/10/2026;0;0;1,00;1,00;1,00", "Tesouro Selic;01/03/2029;30/10/2026;0;0;2,00;2,00;2,00"].join("\n"));
  assert.equal(shuffled?.prices[0].price, 2_00);
});

test("the price is what selling pays, not what buying costs", () => {
  const row = data.prices.find((p) => p.type === "Tesouro IPCA+");
  assert.equal(row?.price, 1950_50);
});

test("a page that isn't the file gives nothing, instead of zeroing positions", () => {
  assert.equal(parseTreasuryPrices("<html>maintenance</html>"), null);
  assert.equal(parseTreasuryPrices(""), null);
});

test("a position is found by its name's type and its maturity's year, whatever the casing", () => {
  assert.equal(findBond({ name: "tesouro ipca+", dueDate: "2035-05-15" }, data.prices)?.price, 1950_50);
  assert.equal(findBond({ name: "Minha reserva Tesouro Selic 2029" }, data.prices)?.price, 20170_66);
});

test("IPCA+ with semiannual interest is another bond, and only its full name finds it", () => {
  assert.equal(findBond({ name: "Tesouro IPCA+ com Juros Semestrais 2035" }, data.prices)?.price, 4350_25);
  // writing only "com juros" must not land on the bond without them
  assert.equal(findBond({ name: "Tesouro IPCA+ com juros 2035" }, data.prices), null);
});

test("Renda+ needs its exact maturity: the year in its name is when payments start, not when it matures", () => {
  const rows = [
    { type: "Tesouro Renda+ Aposentadoria Extra", due: "2064-12-15", price: 702_62 },
    { type: "Tesouro Renda+ Aposentadoria Extra", due: "2084-12-15", price: 169_96 },
  ];
  // "Renda+ 2065" matures in 2084, and 2064's bond is another one
  assert.equal(findBond({ name: "Tesouro Renda+ 2065" }, rows), null);
  assert.equal(findBond({ name: "Tesouro Renda+ 2045" }, rows), null);
  assert.equal(findBond({ name: "Tesouro Renda+ 2065", dueDate: "2084-12-15" }, rows)?.price, 169_96);
});

test("Educa+ also needs its exact maturity", () => {
  const rows = [{ type: "Tesouro Educa+", due: "2030-12-15", price: 3423_09 }];
  assert.equal(findBond({ name: "Tesouro Educa+ 2030" }, rows), null);
  assert.equal(findBond({ name: "Tesouro Educa+", dueDate: "2030-12-15" }, rows)?.price, 3423_09);
});

test("two bonds of the same type and year need the exact maturity: guessing would give a wrong value", () => {
  assert.equal(findBond({ name: "Tesouro Prefixado 2029" }, data.prices), null);
  assert.equal(findBond({ name: "Tesouro Prefixado", dueDate: "2029-07-01" }, data.prices)?.price, 640_00);
});

test("no type or no year in sight finds nothing", () => {
  assert.equal(findBond({ name: "Tesouro IPCA+" }, data.prices), null);
  assert.equal(findBond({ name: "Título do governo 2035" }, data.prices), null);
});

test("a manual position is worth its price times its quantity, on the day of that price", () => {
  const l = ledgerWith(position());
  const r = applyTreasuryPrices(l, data, TODAY);
  const a = l.investments.assets[0];
  assert.equal(a.value, Math.round(1950_50 * 2.5));
  assert.equal(a.updatedAt, "2026-10-30");
  assert.equal(a.quote?.price, 1950_50);
  assert.deepEqual(r, { updated: 1, missing: [] });
});

test("a revaluation is a market move: it records a snapshot without any money flowing", () => {
  const l = ledgerWith(position());
  applyTreasuryPrices(l, data, TODAY);
  const snap = l.investments.snapshots.at(-1);
  assert.equal(snap?.date, TODAY);
  assert.equal(snap?.value, Math.round(1950_50 * 2.5));
  assert.ok(!snap?.flow);
});

test("the same price again changes nothing and records nothing", () => {
  const l = ledgerWith(position());
  applyTreasuryPrices(l, data, TODAY);
  const before = l.investments.snapshots.length;
  assert.equal(applyTreasuryPrices(l, data, TODAY).updated, 0);
  assert.equal(l.investments.snapshots.length, before);
});

test("a position the file can't price keeps its value and is named, so the staleness doesn't go unnoticed", () => {
  const l = ledgerWith(position({ quantity: undefined, name: "Sem quantidade 2035 Tesouro IPCA+" }), position({ id: "x", name: "Título misterioso" }));
  const r = applyTreasuryPrices(l, data, TODAY);
  assert.deepEqual(r.missing, ["Sem quantidade 2035 Tesouro IPCA+", "Título misterioso"]);
  assert.equal(r.updated, 0);
  assert.equal(l.investments.assets[0].value, 1000_00);
  assert.equal(l.investments.snapshots.length, 0);
});

test("synced, closed and other positions are left alone", () => {
  const l = ledgerWith(
    position({ id: "synced", pluggyId: "p" }),
    position({ id: "closed", closed: true }),
    position({ id: "cdb", assetClass: "fixed_income" })
  );
  assert.deepEqual(manualTreasuryPositions(l), []);
  assert.deepEqual(applyTreasuryPrices(l, data, TODAY), { updated: 0, missing: [] });
  assert.ok(l.investments.assets.every((a) => a.value === 1000_00));
});

test("the day of the last check survives a reload, so the big file isn't fetched on every unlock", () => {
  const l = defaultLedger();
  l.treasuryCheckedOn = TODAY;
  assert.equal(parseLedger(JSON.stringify(l)).treasuryCheckedOn, TODAY);
});
