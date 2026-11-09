import { test } from "node:test";
import assert from "node:assert/strict";
import { marketLookup, parseStatusInvest, parseXpRows, statusInvestCategories, statusInvestUrl, xpListUrl, XP_LISTS } from "../src/market-data.ts";

const NOTE = `<span class="nome-coluna d-xs-block d-md-block d-lg-none">`;
const row = (name: string, cells: string) => `<tr><td><a title="${name}"><div class="abs-nome-atv"> ${name} </div></a></td>${cells}<td><a class="btn-tab-detalhe">Detalhes</a></td></tr>`;
const cell = (label: string, value: string) => `<td>${NOTE}${label}</span> ${value} </td>`;
const RISK = `<span class="genius-risk genius-alto"> 58 <b> Risco Alto <span class="texto-genius"><p>Para saber mais, <a href="#">clique aqui</a>.</p></span></b></span>`;

test("the addresses carry no ticker, so the sites can't learn what was asked about", () => {
  for (const url of [statusInvestUrl(1), xpListUrl(XP_LISTS[0], 3)]) assert.ok(!/PETR|search=[^&%]/.test(url), url);
});

test("Status Invest's Brazilian numbers become numbers, and empty cells stay out instead of reading as zero", () => {
  const [a, b] = parseStatusInvest("﻿TICKER;PRECO;DY; LIQUIDEZ MEDIA DIARIA;P/L;GESTAO\nPETR4;45,36;8,08;19.430.810,55;-22,14;\nHGLG11;146,52;;1.000,00;;Ativa\n");
  assert.deepEqual(a, { TICKER: "PETR4", PRECO: 45.36, DY: 8.08, "LIQUIDEZ MEDIA DIARIA": 19430810.55, "P/L": -22.14 });
  assert.equal(b.DY, undefined);
  assert.equal(b.GESTAO, "Ativa");
});

test("a page that isn't the export fails, instead of reporting every ticker as missing", () => {
  assert.throws(() => parseStatusInvest("<html>blocked</html>"));
});

test("XP's stock rows give the recommendation and target, without the risk score's explanation", () => {
  const html = row("YDUQ3", cell("Preço Alvo", "R$ 11,00") + cell("Risco (0 - 100)", RISK) + cell("Recomendação", `<span class="recomendacao rec-compra">compra</span>`));
  assert.deepEqual(parseXpRows(html), [{ TICKER: "YDUQ3", "Preço Alvo": "R$ 11,00", "Risco (0 - 100)": "58", Recomendação: "compra" }]);
});

test("XP names FIIs by the fund, and the ticker is the end of it", () => {
  const [fii] = parseXpRows(row("XP SELECTION FUNDO DE FUNDOS FII - XPSF11", cell("Dividendo Yield (12M)", "14,00 %")));
  assert.equal(fii.TICKER, "XPSF11");
  assert.equal(fii["Dividendo Yield (12M)"], "14,00 %");
});

test("only the lists a ticker can be in are read: the US ones are ten times the size", () => {
  assert.deepEqual(statusInvestCategories(["PETR4", "HGLG11"]), [1, 2]);
  assert.deepEqual(statusInvestCategories(["AAPL"]), [12, 13]);
});

test("each ticker is matched exactly, so a share class doesn't answer for another", () => {
  const { results, unavailable } = marketLookup(["PETR3", "PETR4"], [{ TICKER: "PETR4", DY: 8 }], [], ["XP"]);
  assert.equal(results[0].status_invest, null);
  assert.equal(results[1].status_invest?.DY, 8);
  assert.deepEqual(unavailable, ["XP"]);
});
