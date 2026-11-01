import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBankData } from "../src/bank-sync.ts";
import type { BankData, PluggyAccount, PluggyTransaction } from "../src/bank-sync.ts";
import { accountBalance, defaultLedger, foreignCurrencies, monthSummary, netWorth, spendingByCategory, toBase } from "../src/ledger.ts";
import type { FxRates, Ledger } from "../src/ledger.ts";

const WINDOW = "2026-08-01";
const TODAY = "2026-10-25";
/** 1 BRL = 0.20 USD, i.e. US$ 1 = R$ 5 */
const FX: FxRates = { base: "BRL", date: "2026-10-23", fetched: TODAY, rates: { USD: 0.2 } };

const card: PluggyAccount = { id: "p-card", type: "CREDIT", subtype: "CREDIT_CARD", name: "Cartão", balance: 55, currencyCode: "BRL" };
const nomad: PluggyAccount = { id: "p-usd", type: "BANK", subtype: "CHECKING_ACCOUNT", name: "Nomad", balance: 100, currencyCode: "USD" };

function tx(id: string, accountId: string, amount: number, extra: Partial<PluggyTransaction> = {}): PluggyTransaction {
  return { id, accountId, date: "2026-10-10T00:00:00.000Z", description: id, amount, type: "DEBIT", status: "POSTED", ...extra };
}

function data(transactions: PluggyTransaction[], accounts: PluggyAccount[]): BankData {
  return { accounts, transactions, categories: [] };
}

function account(l: Ledger, pluggyId: string) {
  const acc = l.accounts.find((a) => a.pluggyId === pluggyId);
  assert.ok(acc, `account for ${pluggyId}`);
  return acc;
}

test("a purchase in dollars on a real card counts what the card charged, and keeps the dollar amount", () => {
  const l = defaultLedger();
  applyBankData(l, data([tx("AWS", "p-card", 10, { currencyCode: "USD", amountInAccountCurrency: 55 })], [card]), WINDOW, TODAY);
  const [t] = l.transactions;
  // the bill is paid in reais: US$ 10 must not show up as R$ 10
  assert.equal(t.amount, 55_00);
  assert.deepEqual(t.original, { currency: "USD", amount: 10_00 });
  assert.equal(accountBalance(l, account(l, "p-card").id, TODAY), -55_00);
  assert.equal(monthSummary(l, "2026-10").expense, 55_00);
});

test("without Pluggy's conversion, a foreign purchase is converted with the stored rates", () => {
  const l = defaultLedger();
  l.fx = FX;
  applyBankData(l, data([tx("AWS", "p-card", 10, { currencyCode: "USD" })], [card]), WINDOW, TODAY);
  assert.equal(l.transactions[0].amount, 50_00);
  assert.deepEqual(l.transactions[0].original, { currency: "USD", amount: 10_00 });
});

test("a purchase in the account's own currency has no original amount", () => {
  const l = defaultLedger();
  applyBankData(l, data([tx("Padaria", "p-card", 12, { currencyCode: "BRL", amountInAccountCurrency: null })], [card]), WINDOW, TODAY);
  assert.equal(l.transactions[0].amount, 12_00);
  assert.equal(l.transactions[0].original, undefined);
});

test("an account in dollars keeps dollars, and totals convert it to the settings' currency", () => {
  const l = defaultLedger();
  applyBankData(l, data([tx("Starbucks", "p-usd", 4)], [nomad]), WINDOW, TODAY);
  const usd = account(l, "p-usd");
  assert.equal(usd.currency, "USD");
  // the balance matches the bank, in its own currency
  assert.equal(accountBalance(l, usd.id, TODAY), 100_00);
  assert.deepEqual(foreignCurrencies(l, "BRL"), ["USD"]);
  l.fx = FX;
  // US$ 100 is R$ 500 in the net worth, not R$ 100
  assert.equal(netWorth(l), 500_00);
  assert.equal(monthSummary(l, "2026-10").expense, 20_00);
  assert.equal(spendingByCategory(l, "2026-10").get(""), 20_00);
});

test("amounts stay as they are while no rate is known, and in the settings' own currency", () => {
  const l = defaultLedger();
  assert.equal(toBase(l, 100_00, "USD"), 100_00);
  l.fx = FX;
  assert.equal(toBase(l, 100_00, "BRL"), 100_00);
  assert.equal(toBase(l, 100_00, undefined), 100_00);
  assert.equal(toBase(l, 100_00, "EUR"), 100_00);
  assert.equal(toBase(l, 100_00, "USD"), 500_00);
});
