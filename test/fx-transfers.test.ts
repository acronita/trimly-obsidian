import { test } from "node:test";
import assert from "node:assert/strict";
import { transactionsCsv } from "../src/export.ts";
import { accountBalance, balanceForecast, defaultLedger, netWorth, parseLedger, postDueRecurring } from "../src/ledger.ts";
import type { Ledger, Recurring, Transaction } from "../src/ledger.ts";

const TODAY = "2026-11-05";

function setup(): Ledger {
  const l = defaultLedger();
  l.accounts = [
    { id: "brl", name: "Corrente", type: "checking", openingBalance: 1000_00 },
    { id: "usd", name: "Dólar", type: "checking", openingBalance: 0, currency: "USD" },
  ];
  l.fx = { base: "BRL", date: TODAY, rates: { USD: 0.2 } };
  return l;
}

const transfer = (extra: Partial<Transaction> = {}): Transaction => ({ id: "t", date: "2026-11-01", type: "transfer", amount: 500_00, accountId: "brl", toAccountId: "usd", description: "Câmbio", ...extra });

test("each side of the transfer moves in its own currency", () => {
  const l = setup();
  l.transactions = [transfer({ toAmount: 95_00 })];
  assert.equal(accountBalance(l, "brl"), 500_00);
  assert.equal(accountBalance(l, "usd"), 95_00);
});

test("a transfer without a second amount still moves the same number on both sides, as old ledgers expect", () => {
  const l = setup();
  l.transactions = [transfer()];
  assert.equal(accountBalance(l, "usd"), 500_00);
});

test("net worth only changes by the exchange cost, not by a whole currency's difference", () => {
  const l = setup();
  l.transactions = [transfer({ toAmount: 95_00 })];
  // 500 left + US$ 95 at R$ 5 = 975: R$ 25 went to the spread
  assert.equal(netWorth(l), 975_00);
});

test("a recurring transfer posts with what arrives on the other side", () => {
  const l = setup();
  const rule: Recurring = { id: "r", description: "Câmbio", type: "transfer", amount: 100_00, toAccountId: "usd", toAmount: 19_00, accountId: "brl", frequency: "monthly", startDate: "2026-11-01", nextDate: "2026-11-01", endDate: "2026-11-30" };
  l.recurring = [rule];
  postDueRecurring(l, TODAY);
  assert.equal(l.transactions[0].toAmount, 19_00);
  assert.equal(accountBalance(l, "usd"), 19_00);
});

test("money arriving from outside the total counts at what was agreed, or the same amount when there is none", () => {
  const l = setup();
  l.accounts[0].archived = true;
  const rule: Recurring = { id: "r", description: "Câmbio", type: "transfer", amount: 100_00, toAccountId: "usd", accountId: "brl", frequency: "monthly", startDate: "2026-11-10", nextDate: "2026-11-10", endDate: "2026-11-30" };
  l.recurring = [rule];
  assert.equal(balanceForecast(l, TODAY).end, 100_00);
  rule.toAmount = 19_00;
  assert.equal(balanceForecast(l, TODAY).end, 95_00);
});

test("what arrived survives a reload and appears in the export", () => {
  const l = setup();
  l.transactions = [transfer({ toAmount: 95_00 })];
  assert.equal(parseLedger(JSON.stringify(l)).transactions[0].toAmount, 95_00);
  assert.ok(transactionsCsv(l, "BRL").includes(";95,00\r\n"));
});
