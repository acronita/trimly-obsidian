import { test } from "node:test";
import assert from "node:assert/strict";
import { applySegments, companySegment, parseFiiSegments, segmentOf, segmentShares, segmentsDue } from "../src/segments.ts";
import { defaultLedger, saveAsset } from "../src/ledger.ts";
import type { Asset, Ledger } from "../src/ledger.ts";

const labels = { paper: "Papéis", fundOfFunds: "Fundo de Fundos" };
const generalHead = "CNPJ_Fundo_Classe;Data_Referencia;Codigo_ISIN;Segmento_Atuacao";
const balanceHead = "CNPJ_Fundo_Classe;Data_Referencia;Total_Investido;FII;CRI;CRI_CRA;LCI;LCI_LCA";
const parse = (general: string[], balance: string[]) => parseFiiSegments([generalHead, ...general].join("\n"), [balanceHead, ...balance].join("\n"), labels);

const asset = (over: Partial<Asset>): Asset => ({ id: over.code ?? "x", name: over.code ?? "x", assetClass: "reit", value: 100, updatedAt: "2026-11-01", ...over });
const ledgerWith = (...assets: Asset[]): Ledger => {
  const l = defaultLedger();
  l.investments.assets = assets;
  return l;
};

test("a credit fund labelled Multicategoria is Papéis: the balance tells what the label hides", () => {
  const out = parse(["1;2026-09-01;BRKNCRCTF000;Multicategoria"], ["1;2026-09-01;100;5;0;80;0;10"]);
  assert.equal(out?.get("KNCR"), "Papéis");
});

test("a fund holding mostly other FIIs is Fundo de Fundos", () => {
  const out = parse(["1;2026-09-01;BRXPSFCTF009;Outros"], ["1;2026-09-01;100;88;0;12;0;0"]);
  assert.equal(out?.get("XPSF"), "Fundo de Fundos");
});

test("a property fund keeps its specific label, and a vague one is left blank instead of shown as a segment", () => {
  const out = parse(
    ["1;2026-09-01;BRXPMLCTF000;Shoppings", "2;2026-09-01;BRHGLGCTF004;Multicategoria"],
    ["1;2026-09-01;100;0;0;0;0;0", "2;2026-09-01;100;2;0;1;0;0"]
  );
  assert.equal(out?.get("XPML"), "Shoppings");
  assert.equal(out?.has("HGLG"), false);
});

test("the newest month wins when a fund changes its label", () => {
  const out = parse(["1;2026-01-01;BRXPMLCTF000;Multicategoria", "1;2026-09-01;BRXPMLCTF000;Shoppings", "1;2026-03-01;BRXPMLCTF000;Outros"], []);
  assert.equal(out?.get("XPML"), "Shoppings");
});

test("a CVM file with other columns is reported, not read as empty segments", () => {
  assert.equal(parseFiiSegments("a;b\n1;2", "c;d\n3;4", labels), null);
});

test("B3's search brings other companies: only the exact issuer counts, and its periods are commas", () => {
  const results = [
    { issuingCompany: "ACPE", segment: "Não Classificados" },
    { issuingCompany: "PETR", segment: "Exploração. Refino e Distribuição" },
  ];
  assert.equal(companySegment(results, "PETR"), "Exploração, Refino e Distribuição");
  assert.equal(companySegment(results, "ACPE"), null);
  assert.equal(companySegment(results, "WEGE"), null);
});

test("the lookup never overwrites what the user typed", () => {
  const typed = asset({ code: "HGRU11", segment: "Misto", segmentEdited: true });
  applySegments(ledgerWith(typed), new Map([["HGRU", "Outra coisa"]]), new Map());
  assert.equal(typed.segment, "Misto");
});

test("a stock whose B3 lookup failed stays due; one B3 answered for is not asked again this month", () => {
  const failed = asset({ code: "PETR4", assetClass: "stock" });
  const answered = asset({ code: "WEGE3", assetClass: "stock" });
  applySegments(ledgerWith(failed, answered), new Map(), new Map([["WEGE", null]]));
  assert.equal(failed.segment, undefined);
  assert.equal(answered.segment, "");
});

test("refresh is monthly, but a position never looked up doesn't wait", () => {
  const known = ledgerWith(asset({ code: "KNCR11", segment: "Papéis" }));
  known.segmentsCheckedOn = "2026-11-01";
  assert.equal(segmentsDue(known, "2026-11-20"), false);
  assert.equal(segmentsDue(known, "2026-12-01"), true);
  known.investments.assets.push(asset({ id: "new", code: "XPML11" }));
  assert.equal(segmentsDue(known, "2026-11-20"), true);
});

test("positions the lookup can't help don't cause a download", () => {
  assert.equal(segmentsDue(ledgerWith(asset({ assetClass: "fixed_income" }), asset({ code: "BOVA11", assetClass: "etf" })), "2026-11-20"), false);
});

test("typing a segment protects it, clearing it hands it back to the lookup", () => {
  const before = asset({ code: "HGRU11", segment: "" });
  const l = ledgerWith(before);
  saveAsset(l, { ...before, segment: "Misto" }, "2026-11-08");
  assert.equal(l.investments.assets[0].segmentEdited, true);
  saveAsset(l, { ...l.investments.assets[0], segment: undefined }, "2026-11-08");
  assert.equal(l.investments.assets[0].segment, undefined);
  assert.equal(l.investments.assets[0].segmentEdited, undefined);
});

test("Tesouro is grouped by product, from the name synced and manual positions share", () => {
  const kind = (name: string) => segmentOf(asset({ assetClass: "treasury", name }));
  assert.equal(kind("Tesouro IPCA+ 2035"), "IPCA+");
  assert.equal(kind("Tesouro Selic 2029"), "Selic");
  assert.equal(kind("Tesouro Prefixado 2031"), "Prefixado");
  assert.equal(kind("Tesouro Renda+ Aposentadoria Extra 2065"), "Renda+");
});

test("renda fixa is grouped by indexer, and a fixed rate without one is Prefixado", () => {
  const kind = (over: Partial<Asset>) => segmentOf(asset({ assetClass: "fixed_income", name: "CDB Banco X", ...over }));
  assert.equal(kind({ rateType: "CDI", rate: 110 }), "CDI");
  assert.equal(kind({ rateType: "SELIC" }), "Selic");
  assert.equal(kind({ rateType: "IPCA", fixedRate: 6 }), "IPCA");
  assert.equal(kind({ fixedRate: 13 }), "Prefixado");
  assert.equal(kind({}), "");
});

test("what the user typed beats what the name or indexer says", () => {
  assert.equal(segmentOf(asset({ assetClass: "treasury", name: "Tesouro Selic 2029", segment: "Reserva", segmentEdited: true })), "Reserva");
});

test("segment shares add up over the whole class, positions without one included, and spelling doesn't split a group", () => {
  const shares = segmentShares([
    { segment: "Logística", value: 300 },
    { segment: "logistica", value: 200 },
    { segment: "Papéis", value: 400 },
    { segment: "", value: 100 },
  ]);
  assert.deepEqual(shares.map((s) => [s.segment, s.share]), [["Logística", 0.5], ["Papéis", 0.4], ["", 0.1]]);
});
