import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { taxMonths, taxPositions } from "../src/income-tax.ts";
import { applyImport, parseDate, parseNumber, parseStatement, previewImport } from "../src/investment-import.ts";
import { defaultLedger, recordSnapshot } from "../src/ledger.ts";
import type { Asset, Ledger } from "../src/ledger.ts";
import { parseCsv, readSpreadsheet, readXlsx } from "../src/spreadsheet.ts";

const TRADES = ["Data do Negócio", "Tipo de Movimentação", "Mercado", "Prazo/Vencimento", "Instituição", "Código de Negociação", "Quantidade", "Preço", "Valor"];
const trade = (date: string, side: string, ticker: string, qty: string, price: string, value: string) => [date, side, "Mercado à Vista", "-", "XP", ticker, qty, price, value];

const MOVES = ["Entrada/Saída", "Data", "Movimentação", "Produto", "Instituição", "Quantidade", "Preço unitário", "Valor da Operação"];

function position(extra: Partial<Asset> = {}): Asset {
  return { id: "hglg", name: "HGLG11", code: "HGLG11", assetClass: "reit", quantity: 10, value: 1600_00, updatedAt: "2026-11-01", pluggyId: "p", movementsSynced: true, ...extra };
}

function setup(...assets: Asset[]): Ledger {
  const l = defaultLedger();
  l.investments.assets = assets.length ? assets : [position()];
  return l;
}

const buys: string[][] = [TRADES, trade("05/03/2025", "Compra", "HGLG11", "6", "R$ 150,00", "R$ 900,00"), trade("05/06/2025", "Compra", "HGLG11F", "4", "R$ 175,00", "R$ 700,00")];

test("numbers read as written in Brazil, or as Excel stores them", () => {
  assert.equal(parseNumber("R$ 1.234,56"), 1234.56);
  assert.equal(parseNumber("97.5"), 97.5);
  assert.equal(parseNumber("-"), null);
  assert.equal(parseNumber(""), null);
});

test("dates read as written, or as the day number Excel stores", () => {
  assert.equal(parseDate("05/03/2025"), "2025-03-05");
  assert.equal(parseDate("2025-03-05"), "2025-03-05");
  assert.equal(parseDate("45721"), "2025-03-05");
  assert.equal(parseDate("Total"), null);
});

test("the B3 trade statement gives buys and sells, with the fractional ticker as the same asset", () => {
  const out = parseStatement(buys);
  assert.deepEqual(out?.trades[1], { date: "2025-06-05", type: "buy", ticker: "HGLG11", quantity: 4, amount: 700_00 });
});

test("the B3 movement statement gives settlements and income, and names what it leaves out", () => {
  const out = parseStatement([
    MOVES,
    ["Credito", "07/03/2025", "Transferência - Liquidação", "HGLG11 - CSHG LOGÍSTICA FII", "XP", "6", "150,00", "900,00"],
    ["Debito", "10/03/2025", "Transferência - Liquidação", "HGLG11 - CSHG LOGÍSTICA FII", "XP", "1", "160,00", "160,00"],
    ["Credito", "15/04/2025", "Rendimento", "HGLG11 - CSHG LOGÍSTICA FII", "XP", "6", "1,10", "6,60"],
    ["Credito", "15/05/2025", "Desdobro", "HGLG11 - CSHG LOGÍSTICA FII", "XP", "60", "-", "-"],
  ]);
  assert.deepEqual(out?.trades.map((t) => [t.type, t.amount]), [["buy", 900_00], ["sell", 160_00], ["income", 6_60]]);
  assert.deepEqual(out?.skipped, { Desdobro: 1 });
});

test("a broker's own sheet works by its column names, with the amount from the price when there is no total", () => {
  const out = parseStatement([["Relatório da corretora"], [], ["Data", "C/V", "Ativo", "Qtde", "Preço"], ["01/02/2026", "C", "VALE3", "10", "60,00"]]);
  assert.deepEqual(out?.trades, [{ date: "2026-02-01", type: "buy", ticker: "VALE3", quantity: 10, amount: 600_00 }]);
});

test("a sheet that is not a statement gives nothing, and totals under the table are ignored", () => {
  assert.equal(parseStatement([["Nome", "Idade"], ["Ana", "30"]]), null);
  const out = parseStatement([...buys, ["Total", "", "", "", "", "", "10", "", "1600,00"]]);
  assert.equal(out?.trades.length, 2);
});

test("importing the buys gives the real cost, for tax and for the position, with nothing left to check", () => {
  const l = setup();
  const preview = previewImport(l, [buys]);
  assert.ok(preview);
  applyImport(l, preview);
  const a = l.investments.assets[0];
  assert.equal(a.invested, 1600_00);
  assert.equal(a.costEdited, true);
  const [p] = taxPositions(l);
  assert.equal(p.costKnown, true);
  assert.equal(p.cost, 1600_00);
  assert.deepEqual(p.issues, []);
});

test("a sale from the statement becomes a taxable gain at the real average", () => {
  const l = setup(position({ quantity: 8 }));
  applyImport(l, previewImport(l, [[...buys, trade("10/07/2025", "Venda", "HGLG11", "2", "R$ 200,00", "R$ 400,00")]]) as NonNullable<ReturnType<typeof previewImport>>);
  const [m] = taxMonths(taxPositions(l));
  // average 160, so 2 shares cost 320: gain 80, FII tax 20%
  assert.equal(m.fii.tax, 16_00);
});

test("importing twice adds nothing", () => {
  const l = setup();
  applyImport(l, previewImport(l, [buys]) as NonNullable<ReturnType<typeof previewImport>>);
  const again = previewImport(l, [buys]);
  assert.equal(again?.trades.length, 0);
  assert.equal(again?.duplicates, 2);
});

test("two equal trades in the same file are two trades", () => {
  const l = setup();
  const same = trade("05/03/2025", "Compra", "HGLG11", "5", "160,00", "800,00");
  assert.equal(previewImport(l, [[TRADES, same, same]])?.trades.length, 2);
});

test("a trade the bank already reported, days apart from the statement's date, isn't counted again", () => {
  const l = setup();
  l.investments.movements = [{ id: "m", assetId: "hglg", date: "2025-03-07", type: "buy", amount: 899_00, quantity: 6, pluggyId: "bank" }];
  const preview = previewImport(l, [buys]);
  assert.equal(preview?.duplicates, 1);
  assert.equal(preview?.trades.length, 1);
});

test("a ticker with no position is named instead of creating one", () => {
  const preview = previewImport(setup(), [[TRADES, trade("01/02/2025", "Compra", "VALE3", "1", "60,00", "60,00")]]);
  assert.deepEqual(preview?.unmatched, ["VALE3"]);
  assert.equal(preview?.trades.length, 0);
});

test("partial history leaves the cost alone: buys alone can't say what older shares cost", () => {
  const l = setup(position({ quantity: 20 }));
  applyImport(l, previewImport(l, [buys]) as NonNullable<ReturnType<typeof previewImport>>);
  assert.equal(l.investments.assets[0].invested, undefined);
});

test("imported history doesn't count as money moved today, or returns would dip", () => {
  const l = setup();
  l.investments.snapshots = [{ date: "2026-11-01", value: 1600_00, invested: 1600_00 }];
  const recent = [TRADES, trade("03/11/2026", "Compra", "HGLG11", "1", "160,00", "160,00")];
  applyImport(l, previewImport(l, [recent]) as NonNullable<ReturnType<typeof previewImport>>);
  recordSnapshot(l, "2026-11-05");
  assert.equal(l.investments.snapshots.at(-1)?.flow, 0);
});

test("CSV reads with semicolons, quotes and line ends, and old Excel accents survive", async () => {
  assert.deepEqual(parseCsv('﻿a;"b;c"\r\n1;"2 ""x"""\r\n'), [["a", "b;c"], ["1", '2 "x"']]);
  const latin = new Uint8Array([0x50 + 1, 0xe7, 0x3b, 0x62]); // "Qç;b" in Windows-1252
  assert.deepEqual(await readSpreadsheet(latin), [[["Qç", "b"]]]);
});

/** A minimal .xlsx: real zip structure, deflated like Excel's. */
function xlsx(files: Record<string, string>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text));
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

test("an Excel file reads into rows: shared text, numbers, gaps between cells and escapes", async () => {
  const bytes = xlsx({
    "xl/sharedStrings.xml": `<sst><si><t>Código</t></si><si><r><t>A &amp; </t></r><r><t>B</t></r></si></sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>97.5</v></c><c r="B2" t="inlineStr"><is><t>x</t></is></c><c r="C2"/></row></sheetData></worksheet>`,
    "docProps/app.xml": "<ignored/>",
  });
  const [sheet] = await readXlsx(bytes);
  assert.deepEqual(sheet[0], ["Código", "", "A & B"]);
  assert.deepEqual(sheet[1].slice(0, 2), ["97.5", "x"]);
});

test("a whole statement in Excel imports, recognized by its content and not its name", async () => {
  const l = setup();
  const cell = (ref: string, v: string) => `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
  const row = (n: number, cells: string[]) => `<row r="${n}">${cells.map((v, i) => cell(`${String.fromCharCode(65 + i)}${n}`, v)).join("")}</row>`;
  const bytes = xlsx({ "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${buys.map((r, i) => row(i + 1, r)).join("")}</sheetData></worksheet>` });
  const preview = previewImport(l, await readSpreadsheet(bytes));
  assert.equal(preview?.trades.length, 2);
});

test("garbage that looks like a zip fails instead of importing nothing silently", async () => {
  await assert.rejects(readSpreadsheet(new Uint8Array([0x50, 0x4b, 1, 2, 3])));
});
