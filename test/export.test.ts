import { test } from "node:test";
import assert from "node:assert/strict";
import { ledgerJson, movementsCsv, positionsCsv, textCell, transactionsCsv } from "../src/export.ts";
import { defaultLedger } from "../src/ledger.ts";
import type { Ledger } from "../src/ledger.ts";

function setup(): Ledger {
  const l = defaultLedger();
  l.accounts = [
    { id: "main", name: "Corrente", type: "checking", openingBalance: 0 },
    { id: "usd", name: "Dólar", type: "checking", openingBalance: 0, currency: "USD" },
  ];
  l.categories = [{ id: "food", name: "Mercado", kind: "expense", color: "#000" }];
  l.transactions = [
    { id: "b", date: "2026-03-10", type: "expense", amount: 1234_56, accountId: "main", categoryId: "food", description: "Pão; leite" },
    { id: "a", date: "2026-03-01", type: "transfer", amount: 10_00, accountId: "main", toAccountId: "usd", description: "Câmbio" },
  ];
  l.investments.assets = [{ id: "fii", name: "HGLG11", code: "HGLG11", assetClass: "reit", quantity: 2.5, invested: 300_00, value: 400_00, updatedAt: "2026-03-01", portfolioId: "ret" }];
  l.investments.portfolios = [{ id: "ret", name: "Aposentadoria", targets: [] }];
  l.investments.movements = [{ id: "m", assetId: "fii", date: "2026-03-02", type: "buy", amount: 300_00, quantity: 2.5 }];
  l.pluggy = { clientId: "CLIENT-ID", clientSecret: "CLIENT-SECRET", itemIds: ["ITEM"] };
  l.brapi = { token: "BRAPI-TOKEN" };
  return l;
}

const rows = (csv: string) => csv.replace(/^﻿/, "").trim().split("\r\n");

test("a backup never carries the bank credentials or the quotes token, since it gets copied around", () => {
  const json = ledgerJson(setup());
  for (const secret of ["CLIENT-ID", "CLIENT-SECRET", "BRAPI-TOKEN"]) assert.ok(!json.includes(secret), secret);
});

test("the JSON keeps everything else, and the ledger in use keeps its credentials", () => {
  const l = setup();
  const back = JSON.parse(ledgerJson(l));
  assert.equal(back.transactions.length, 2);
  assert.equal(back.investments.portfolios[0].name, "Aposentadoria");
  assert.equal(l.pluggy?.clientSecret, "CLIENT-SECRET");
  assert.equal(l.brapi?.token, "BRAPI-TOKEN");
});

test("a cell that a spreadsheet would run as a formula stays text", () => {
  for (const attack of ["=HYPERLINK(1)", "+1+1", "-1+1", "@SUM(A1)"]) assert.ok(textCell(attack).startsWith("'"), attack);
  assert.equal(textCell('=A1;"x"'), `"'=A1;""x"""`);
  assert.equal(textCell("Mercado"), "Mercado");
});

test("separators, quotes and line breaks inside a cell don't break the columns", () => {
  assert.equal(textCell("Pão; leite"), '"Pão; leite"');
  assert.equal(textCell('Loja "A"'), '"Loja ""A"""');
  assert.equal(textCell("a\nb"), '"a\nb"');
  assert.equal(textCell(undefined), "");
});

test("transactions come oldest first, in Excel's Brazilian format, with each account's currency", () => {
  const csv = transactionsCsv(setup(), "BRL");
  assert.ok(csv.startsWith("﻿"), "a BOM keeps accents right in Excel");
  const [, first, second] = rows(csv);
  assert.ok(first.startsWith("2026-03-01;"));
  assert.ok(first.includes(";10,00;BRL;Corrente;Dólar;"));
  assert.ok(second.includes(';1234,56;BRL;Corrente;;Mercado;"Pão; leite";'));
});

test("positions show their portfolio, quantity and money with decimal commas", () => {
  const [, row] = rows(positionsCsv(setup()));
  assert.ok(row.startsWith("HGLG11;HGLG11;"));
  assert.ok(row.includes(";Aposentadoria;;2,5;300,00;400,00;"));
});

test("a movement names its position", () => {
  const [, row] = rows(movementsCsv(setup()));
  assert.ok(row.startsWith("2026-03-02;HGLG11;"));
  assert.ok(row.includes(";300,00;2,5;"));
});
