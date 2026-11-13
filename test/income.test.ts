import { test } from "node:test";
import assert from "node:assert/strict";
import { distributionCuts, incomeGoal, paymentCalendar, positionIncome } from "../src/income.ts";
import type { Payout } from "../src/income.ts";
import { defaultLedger, parseLedger } from "../src/ledger.ts";
import type { Asset, Ledger } from "../src/ledger.ts";
import type { Provento } from "../src/proventos.ts";

const TODAY = "2026-11-13";

function position(id: string, extra: Partial<Asset>): Asset {
  return { id, name: id.toUpperCase(), assetClass: "reit", updatedAt: TODAY, value: 0, ...extra };
}

function ledger(): Ledger {
  const l = defaultLedger();
  l.investments.assets.push(
    // bought at R$ 8.000, worth R$ 10.000, paid R$ 1.000 in 12 months
    position("hgre", { code: "HGRE11", value: 10_000_00, invested: 8_000_00 }),
    // paid R$ 300 on R$ 10.000
    position("bbas", { code: "BBAS3", assetClass: "stock", value: 10_000_00, invested: 10_000_00 })
  );
  return l;
}

const pay = (assetId: string, date: string, amount: number): Payout => ({ assetId, date, amount });

test("yield on cost is the income over what the position cost, current yield over what it is worth", () => {
  const rows = positionIncome(ledger(), [pay("hgre", "2026-05-10", 1_000_00), pay("bbas", "2026-08-10", 300_00)], null);
  const hgre = rows[0];
  assert.equal(hgre.asset.id, "hgre");
  assert.equal(hgre.yieldOnCost, 12.5);
  assert.equal(hgre.currentYield, 10);
  // concentration: HGRE11 is 1.000 of 1.300
  assert.equal(Math.round(hgre.share), 77);
  assert.equal(hgre.vsCdi, null);
});

test("each position's income is compared with the CDI net of 15% income tax, since proventos of FIIs and stocks pay none", () => {
  // CDI 12% → 10,2% net: HGRE11's 10% is 0,2 point behind, BBAS3's 3% 7,2 behind
  const rows = positionIncome(ledger(), [pay("hgre", "2026-05-10", 1_000_00), pay("bbas", "2026-08-10", 300_00)], 0.12);
  assert.equal(Math.round(rows[0].vsCdi! * 10), -2);
  assert.equal(Math.round(rows[1].vsCdi! * 10), -72);
});

const p = (ticker: string, payDate: string, perShare: number, kind: Provento["kind"] = "income"): Provento => ({ ticker, kind, perShare, dataCom: payDate, payDate });

test("a payment 10% or more below the ticker's average of the previous 12 months is a cut", () => {
  const proventos = [p("HGRE11", "2026-07-15", 1), p("HGRE11", "2026-08-15", 1), p("HGRE11", "2026-09-15", 1), p("HGRE11", "2026-10-15", 0.8)];
  const cuts = distributionCuts(ledger(), proventos, TODAY);
  assert.equal(cuts.length, 1);
  assert.equal(cuts[0].ticker, "HGRE11");
  assert.equal(Math.round(cuts[0].drop), 20);
  // 5% less is noise, not a cut
  assert.equal(distributionCuts(ledger(), [...proventos.slice(0, 3), p("HGRE11", "2026-10-15", 0.95)], TODAY).length, 0);
});

test("a stock's occasional dividend, or a JCP after dividends, is not taken for a cut", () => {
  // two dividends before: not regular enough
  assert.equal(distributionCuts(ledger(), [p("BBAS3", "2026-03-10", 1, "dividend"), p("BBAS3", "2026-06-10", 1, "dividend"), p("BBAS3", "2026-09-10", 0.2, "dividend")], TODAY).length, 0);
  // a small JCP after three big dividends: different kinds
  const mixed = [p("BBAS3", "2026-03-10", 1, "dividend"), p("BBAS3", "2026-05-10", 1, "dividend"), p("BBAS3", "2026-07-10", 1, "dividend"), p("BBAS3", "2026-09-10", 0.2, "jcp")];
  assert.equal(distributionCuts(ledger(), mixed, TODAY).length, 0);
});

test("the calendar shows, per position, how much it paid in each of the last 12 months", () => {
  const cal = paymentCalendar([pay("hgre", "2026-11-10", 100_00), pay("hgre", "2025-12-10", 90_00), pay("bbas", "2025-11-10", 50_00)], TODAY);
  assert.equal(cal.months[0], "2025-12");
  assert.equal(cal.months[11], "2026-11");
  // November 2025 is out of the window
  assert.deepEqual(cal.rows.map((r) => r.assetId), ["hgre"]);
  assert.equal(cal.rows[0].byMonth[0], 90_00);
  assert.equal(cal.rows[0].byMonth[11], 100_00);
});

test("income goal: what is missing and how many months of aportes, reinvesting, until the portfolio pays it", () => {
  // R$ 12.000 a year on R$ 120.000 (10%); R$ 2.000 a month needs R$ 240.000
  const g = incomeGoal(2_000_00, 12_000_00, 120_000_00, 2_000_00, 10);
  assert.equal(g.now, 1_000_00);
  assert.equal(g.missing, 1_000_00);
  assert.equal(g.progress, 50);
  assert.equal(g.wealthNeeded, 240_000_00);
  // reinvesting gets there sooner than the 60 months of aportes alone
  assert.ok(g.months! > 30 && g.months! < 60, String(g.months));
  assert.equal(incomeGoal(500_00, 12_000_00, 120_000_00, 0, 10).months, 0);
  assert.equal(incomeGoal(2_000_00, 0, 120_000_00, 2_000_00, 0).months, null);
});

test("the income goal survives a reload", () => {
  const l = defaultLedger();
  l.investments.incomeGoal = 3_000_00;
  assert.equal(parseLedger(JSON.stringify(l)).investments.incomeGoal, 3_000_00);
});
