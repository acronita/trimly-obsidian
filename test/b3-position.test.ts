import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPositions, parsePositions, previewPositions, reportDate } from "../src/b3-position.ts";
import { applyInvestments } from "../src/investment-sync.ts";
import type { PluggyInvestment } from "../src/investment-sync.ts";
import { defaultLedger, portfolioValue } from "../src/ledger.ts";
import type { Ledger } from "../src/ledger.ts";
import { previewImport } from "../src/investment-import.ts";

// sheets as B3's investor area exports them: one per kind, a total row at the bottom
const ACOES = [
  ["Produto", "Instituição", "Conta", "Código de Negociação", "CNPJ da Empresa", "Código ISIN / Distribuição", "Tipo", "Escriturador", "Quantidade", "Quantidade Disponível", "Quantidade Indisponível", "Motivo", "Preço de Fechamento", "Valor Atualizado"],
  ["TGAR11 - TG ATIVO REAL FII", "XP INVESTIMENTOS", "123", "TGAR11", "", "BRTGARCTF000", "Cotas", "", "5", "5", "0", "", "105,20", "526,00"],
  ["", "", "", "", "", "", "", "", "", "", "", "", "Total", "526,00"],
];
const TESOURO = [
  ["Produto", "Instituição", "Código ISIN", "Indexador", "Vencimento", "Quantidade", "Quantidade Disponível", "Quantidade Indisponível", "Motivo", "Valor Aplicado", "Valor bruto", "Valor líquido", "Valor Atualizado"],
  ["Tesouro Prefixado 2027", "XP INVESTIMENTOS", "BRSTNCLTN8C3", "PRÉ", "01/01/2027", "1,5", "1,5", "0", "", "1.200,00", "1.310,00", "1.290,00", "1.310,00"],
  ["Tesouro IPCA+ 2035", "XP INVESTIMENTOS", "BRSTNCNTB3E2", "IPCA", "15/05/2035", "0,8", "0,8", "0", "", "2.000,00", "2.150,00", "2.120,00", "2.150,00"],
];

const DAY = "2026-11-08";
const TODAY = "2026-11-20";

function inv(id: string, extra: Partial<PluggyInvestment>): PluggyInvestment {
  return { id, itemId: "item-1", name: id, type: "FIXED_INCOME", balance: 1000, status: "ACTIVE", date: `${DAY}T00:00:00.000Z`, ...extra };
}

/** The incident: positions synced, then a zeroed report under new ids closed them all. */
function zeroedPortfolio(): Ledger {
  const l = defaultLedger();
  const held = [
    inv("ltn", { name: "LTN", code: "BRSTNCLTN8C3", subtype: "TREASURY", dueDate: "2027-01-01T00:00:00.000Z", balance: 1280 }),
    inv("ipca", { name: "NTN-B PRINC", code: "BRSTNCNTB3E2", subtype: "TREASURY", dueDate: "2035-05-15T00:00:00.000Z", balance: 2100 }),
    inv("tgar", { name: "TGAR11", code: "TGAR11", type: "EQUITY", subtype: "REAL_ESTATE_FUND", balance: 520 }),
  ];
  applyInvestments(l, held, ["item-1"], DAY);
  const zero = { balance: 0, quantity: 0, status: "TOTAL_WITHDRAWAL" };
  // Pluggy's new ids for the same products
  const again = (p: PluggyInvestment, id: string, extra: Partial<PluggyInvestment> = {}) => ({ ...p, ...zero, ...extra, id });
  applyInvestments(l, [again(held[0], "ltn-2", { code: null }), again(held[2], "tgar-2")], ["item-1"], DAY);
  return l;
}

test("the B3 position report is read per sheet, one position per product, total rows left out", () => {
  const held = parsePositions([ACOES, TESOURO]);
  assert.ok(held);
  assert.equal(held.length, 3);
  const ltn = held.find((p) => p.isin === "BRSTNCLTN8C3");
  // net value: what a synced position's value means
  assert.equal(ltn?.value, 1290_00);
  assert.equal(ltn?.grossValue, 1310_00);
  assert.equal(ltn?.invested, 1200_00);
  assert.equal(ltn?.quantity, 1.5);
  assert.equal(ltn?.dueDate, "2027-01-01");
  assert.equal(held.find((p) => p.ticker === "TGAR11")?.value, 526_00);
});

test("a statement of movements is not taken for a position report, nor the other way round", () => {
  const statement = [
    ["Entrada/Saída", "Data", "Movimentação", "Produto", "Instituição", "Quantidade", "Preço unitário", "Valor da Operação"],
    ["Credito", "09/11/2026", "Transferência - Liquidação", "TGAR11 - TG ATIVO REAL FII", "XP", "5", "100,00", "500,00"],
  ];
  assert.equal(parsePositions([statement]), null);
  assert.equal(previewImport(defaultLedger(), [TESOURO]), null);
});

test("importing the B3 position reopens the positions a zeroed sync closed, with B3's numbers", () => {
  const l = zeroedPortfolio();
  assert.equal(portfolioValue(l), 0);
  const preview = previewPositions(l, parsePositions([ACOES, TESOURO])!, "2026-11-19");
  assert.equal(preview.restores.length, 3);
  assert.deepEqual(preview.unmatched, []);
  applyPositions(l, preview, TODAY);
  // the original positions come back (they carry the history), not the zeroed copies
  const ltn = l.investments.assets.find((a) => a.code === "BRSTNCLTN8C3")!;
  assert.equal(ltn.closed, undefined);
  assert.equal(ltn.value, 1290_00);
  assert.equal(ltn.quantity, 1.5);
  assert.equal(l.investments.assets.find((a) => a.pluggyId === "ltn-2")?.closed, true);
  assert.equal(portfolioValue(l), 1290_00 + 2120_00 + 526_00);
});

test("a restored position the bank had closed survives the next syncs that still leave it out", () => {
  const l = zeroedPortfolio();
  applyPositions(l, previewPositions(l, parsePositions([ACOES, TESOURO])!, "2026-11-19"), TODAY);
  // the bank still reports the zeroed copy and a fresh, unrelated position: the old ids stay missing
  const r = applyInvestments(
    l,
    [inv("ltn-2", { name: "LTN", subtype: "TREASURY", dueDate: "2027-01-01T00:00:00.000Z", balance: 0, status: "TOTAL_WITHDRAWAL" }), inv("cdb", { date: `${TODAY}T00:00:00.000Z` })],
    ["item-1"],
    TODAY
  );
  assert.equal(r.closed, 0);
  assert.equal(portfolioValue(l), 1290_00 + 2120_00 + 526_00 + 1000_00);
});

test("once the bank reports the product again with a value, it takes the restored position back instead of duplicating it", () => {
  const l = zeroedPortfolio();
  applyPositions(l, previewPositions(l, parsePositions([ACOES, TESOURO])!, "2026-11-19"), TODAY);
  const restored = l.investments.assets.find((a) => a.code === "BRSTNCLTN8C3")!.id;
  const r = applyInvestments(l, [inv("ltn-3", { name: "LTN", subtype: "TREASURY", dueDate: "2027-01-01T00:00:00.000Z", balance: 1300 })], ["item-1"], TODAY);
  assert.equal(r.added, 0);
  const ltn = l.investments.assets.find((a) => a.pluggyId === "ltn-3")!;
  // the restored position, with its history, is the one synced again
  assert.equal(ltn.id, restored);
  assert.equal(ltn.value, 1300_00);
  assert.equal(l.investments.assets.filter((a) => !a.closed && a.assetClass === "treasury" && a.dueDate === "2027-01-01").length, 1);
});

test("a position the bank still reports with a value is left to the bank; products the portfolio lacks are only listed", () => {
  const l = defaultLedger();
  applyInvestments(l, [inv("tgar", { name: "TGAR11", code: "TGAR11", type: "EQUITY", subtype: "REAL_ESTATE_FUND", balance: 520 })], ["item-1"], DAY);
  const extra = [...ACOES.slice(0, 2), ["BOVA11 - ISHARES BOVA", "XP", "1", "BOVA11", "", "", "Cotas", "", "3", "3", "0", "", "166,00", "498,00"]];
  const preview = previewPositions(l, parsePositions([extra])!, "2026-11-19");
  assert.equal(preview.restores.length, 0);
  assert.deepEqual(preview.unmatched, ["BOVA11"]);
});

test("the report date comes from B3's file name", () => {
  assert.equal(reportDate("posicao-2026-11-19-10-30-00.xlsx"), "2026-11-19");
  assert.equal(reportDate("carteira.xlsx"), null);
});
