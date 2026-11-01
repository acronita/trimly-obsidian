import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultLedger, newId } from "../src/ledger.ts";
import type { Asset } from "../src/ledger.ts";
import { estimatedPayouts, issuerOf, lastPaidProventos, parseCashDividends, proventoIssuers, tickerOfIsin, upcomingProventos } from "../src/proventos.ts";
import type { CashDividend } from "../src/proventos.ts";

const asset = (extra: Partial<Asset>): Asset => ({ id: newId(), name: "x", assetClass: "stock", value: 0, updatedAt: "2026-10-01", ...extra });
const row = (extra: Partial<CashDividend>): CashDividend => ({
  isinCode: "BRPETRACNPR6",
  label: "DIVIDENDO",
  rate: "0,47156696000",
  lastDatePrior: "21/08/2026",
  paymentDate: "21/12/2026",
  ...extra,
});

test("B3 lists proventos by ISIN; the share type picks the ticker", () => {
  // holding PETR4 must not show PETR3's dividend, which has another value per share
  assert.equal(tickerOfIsin("BRPETRACNOR9"), "PETR3");
  assert.equal(tickerOfIsin("BRPETRACNPR6"), "PETR4");
  assert.equal(tickerOfIsin("BRTAEECDAM10"), "TAEE11");
  assert.equal(tickerOfIsin("BRHGLGCTF004"), "HGLG11");
  // subscription receipts of a FII are not the quota
  assert.equal(tickerOfIsin("BRHGLGR26M17"), null);
  assert.equal(issuerOf("HGLG11"), "HGLG");
});

test("rows parse into proventos, dropping what can't be matched or dated", () => {
  const out = parseCashDividends([
    row({}),
    row({ isinCode: "BRPETRACNOR9", label: "JRS CAP PROPRIO", rate: "0,67407131000" }),
    row({ isinCode: "BRHGLGR26M17" }),
    row({ lastDatePrior: "" }),
    row({ paymentDate: "" }),
  ]);
  assert.deepEqual(
    out.map((p) => [p.ticker, p.kind, p.perShare, p.dataCom, p.payDate]),
    [
      ["PETR4", "dividend", 0.47156696, "2026-08-21", "2026-12-21"],
      ["PETR3", "jcp", 0.67407131, "2026-08-21", "2026-12-21"],
      ["PETR4", "dividend", 0.47156696, "2026-08-21", null],
    ]
  );
});

test("only open positions with a B3 ticker send their issuer, once", () => {
  const l = defaultLedger();
  l.investments.assets.push(
    asset({ code: "PETR4" }),
    asset({ code: "PETR3" }),
    asset({ code: "HGLG11", assetClass: "reit" }),
    asset({ code: "VALE3", closed: true }),
    asset({ code: "CDB224AXYZ1", assetClass: "fixed_income" })
  );
  assert.deepEqual(proventoIssuers(l), ["HGLG", "PETR"]);
});

test("upcoming proventos: still to be paid, estimated by quantity, JCP net of tax", () => {
  const l = defaultLedger();
  const petr = asset({ code: "PETR4", quantity: 100 });
  const hglg = asset({ code: "HGLG11", assetClass: "reit" });
  l.investments.assets.push(petr, hglg);
  const proventos = parseCashDividends([
    row({ paymentDate: "21/12/2026" }),
    row({ label: "JRS CAP PROPRIO", rate: "1,00", paymentDate: "23/11/2026" }),
    // already paid: it shows up in the income movements, not here
    row({ paymentDate: "20/08/2026" }),
    row({ isinCode: "BRHGLGCTF004", label: "RENDIMENTO", rate: "1,10", lastDatePrior: "30/11/2026", paymentDate: "" }),
    row({ isinCode: "BRVALEACNOR0" }),
  ]);
  const up = upcomingProventos(l, proventos, "2026-11-01");
  assert.deepEqual(
    up.map((u) => [u.provento.ticker, u.provento.kind, u.amount]),
    [
      // 100 × R$ 1,00 of JCP pays R$ 85 after the 15% withheld
      ["PETR4", "jcp", 85_00],
      ["PETR4", "dividend", 47_16],
      // no quantity known: listed, without an amount; no payment date yet goes last
      ["HGLG11", "income", null],
    ]
  );
});

test("the latest paid provento per position shows the lookup ran even with nothing upcoming", () => {
  const l = defaultLedger();
  l.investments.assets.push(asset({ code: "HGLG11", assetClass: "reit" }), asset({ code: "XPTO3" }));
  const proventos = parseCashDividends([
    row({ isinCode: "BRHGLGCTF004", label: "RENDIMENTO", rate: "1,10", paymentDate: "15/09/2026" }),
    row({ isinCode: "BRHGLGCTF004", label: "RENDIMENTO", rate: "1,17", paymentDate: "15/10/2026" }),
    // announced but not paid yet: it belongs to the upcoming list
    row({ isinCode: "BRHGLGCTF004", label: "RENDIMENTO", rate: "1,20", paymentDate: "16/11/2026" }),
  ]);
  const last = lastPaidProventos(l, proventos, "2026-11-01");
  assert.deepEqual(
    last.map((x) => [x.ticker, x.provento?.payDate ?? null, x.provento?.perShare ?? null]),
    [
      ["HGLG11", "2026-10-15", 1.17],
      ["XPTO3", null, null],
    ]
  );
});

test("a monthly FII with nothing announced gets next month's forecast at the last value", () => {
  const l = defaultLedger();
  l.investments.assets.push(asset({ code: "HGRE11", assetClass: "reit", quantity: 10 }));
  const fii = (rate: string, com: string, pay: string) => row({ isinCode: "BRHGRECTF009", label: "RENDIMENTO", rate, lastDatePrior: com, paymentDate: pay });
  const paid = [fii("0,80", "31/08/2026", "15/09/2026"), fii("0,85", "30/09/2026", "15/10/2026")];
  const up = upcomingProventos(l, parseCashDividends(paid), "2026-11-01");
  assert.deepEqual(
    up.map((u) => [u.forecast, u.provento.payDate, u.amount]),
    [[true, "2026-11-15", 8_50]]
  );
  // once B3 lists the announcement, it replaces the forecast
  const announced = upcomingProventos(l, parseCashDividends([...paid, fii("0,90", "30/10/2026", "14/11/2026")]), "2026-11-01");
  assert.deepEqual(
    announced.map((u) => [u.forecast ?? false, u.provento.payDate]),
    [[false, "2026-11-14"]]
  );
  // past the projected date with no announcement: no guess (it may have skipped the month)
  assert.equal(upcomingProventos(l, parseCashDividends(paid), "2026-11-20").length, 0);
});

test("payouts are estimated from B3 only for positions the bank sync brings no income for", () => {
  const l = defaultLedger();
  const hgre = asset({ code: "HGRE11", assetClass: "reit", quantity: 10 });
  const petr = asset({ code: "PETR4", quantity: 100 });
  l.investments.assets.push(hgre, petr);
  // PETR4's income already comes from the bank: estimating it too would count it twice
  l.investments.movements.push({ id: newId(), assetId: petr.id, date: "2026-09-01", type: "income", amount: 10_00 });
  // HGRE11 was bought in September: August's provento wasn't its
  l.investments.movements.push({ id: newId(), assetId: hgre.id, date: "2026-09-10", type: "buy", amount: 1000_00 });
  const proventos = parseCashDividends([
    row({ isinCode: "BRHGRECTF009", label: "RENDIMENTO", rate: "0,80", lastDatePrior: "31/08/2026", paymentDate: "15/09/2026" }),
    row({ isinCode: "BRHGRECTF009", label: "RENDIMENTO", rate: "0,85", lastDatePrior: "30/09/2026", paymentDate: "15/10/2026" }),
    row({ paymentDate: "15/10/2026" }),
  ]);
  const est = estimatedPayouts(l, proventos, "2025-11-01", "2026-11-01");
  assert.deepEqual(
    est.map((e) => [e.provento.ticker, e.date, e.amount]),
    [["HGRE11", "2026-10-15", 8_50]]
  );
});
