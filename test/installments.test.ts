import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBankData } from "../src/bank-sync.ts";
import type { PluggyAccount, PluggyTransaction } from "../src/bank-sync.ts";
import { cardBill, cardBillObligations, defaultLedger, futureInstallments, installmentFromDescription, postDueInstallments } from "../src/ledger.ts";
import type { Account, Ledger, Transaction } from "../src/ledger.ts";

/** Card closing on the 3rd, due on the 10th. */
function ledger(transactions: Transaction[], card: Partial<Account> = {}): Ledger {
  return {
    version: 1,
    accounts: [{ id: "card", name: "Card", type: "credit", openingBalance: 0, closingDay: 3, dueDay: 10, ...card }],
    categories: [],
    transactions,
    budgets: [],
    recurring: [],
    obligations: [],
    investments: { assets: [], snapshots: [], movements: [], targets: [] },
  };
}

const charge = (id: string, date: string, amount: number, number: number, total: number, description = "Loja"): Transaction => ({
  id,
  date,
  type: "expense",
  amount,
  accountId: "card",
  description,
  installment: { number, total },
});

test("an installment purchase projects its remaining installments, one per month", () => {
  const l = ledger([charge("a", "2026-09-15", 100_00, 2, 4)]);
  const planned = futureInstallments(l, "card");
  assert.deepEqual(
    planned.map((p) => [p.number, p.date, p.amount]),
    [
      [3, "2026-10-15", 100_00],
      [4, "2026-11-15", 100_00],
    ]
  );
});

test("installments already charged are not projected again", () => {
  // the bank posted 1/3 and 2/3; only 3/3 is still to come
  const l = ledger([charge("a", "2026-09-15", 50_00, 1, 3), charge("b", "2026-10-15", 50_00, 2, 3)]);
  assert.deepEqual(
    futureInstallments(l, "card").map((p) => [p.number, p.date]),
    [[3, "2026-11-15"]]
  );
});

test("two purchases at the same store in different months stay apart", () => {
  const l = ledger([charge("a", "2026-09-15", 30_00, 1, 2), charge("b", "2026-10-20", 80_00, 1, 2)]);
  assert.deepEqual(
    futureInstallments(l, "card").map((p) => [p.date, p.amount]),
    [
      ["2026-10-15", 30_00],
      ["2026-11-20", 80_00],
    ]
  );
});

test("future bills include the installments still to come, so they are not understated", () => {
  const l = ledger([charge("a", "2026-10-15", 100_00, 1, 3)]);
  // open bill (Oct 3 to Nov 2) has the charged 1/3; the next ones hold 2/3 and 3/3
  const open = cardBill(l, "card", "2026-10-25", 0);
  assert.deepEqual([open.total, open.planned], [100_00, 0]);
  const next = cardBill(l, "card", "2026-10-25", 1);
  assert.deepEqual([next.total, next.planned, next.due], [100_00, 100_00, "2026-12-10"]);
  assert.equal(cardBill(l, "card", "2026-10-25", 2).planned, 100_00);
  assert.equal(cardBill(l, "card", "2026-10-25", 3).planned, 0);
});

test("an installment expected in the open bill but not charged yet counts in its projection", () => {
  // 1/2 charged on the last closed bill; 2/2 is expected on Oct 15, in the open bill
  const l = ledger([charge("a", "2026-09-15", 70_00, 1, 2)]);
  const open = cardBill(l, "card", "2026-10-10", 0);
  assert.deepEqual([open.total, open.planned], [70_00, 70_00]);
  const projected = cardBillObligations(l, "2026-10-10").find((d) => d.projected);
  assert.equal(projected?.obligation.amount, 70_00);
});

test("installments the bank never reports still count in their bills, closed ones included", () => {
  // some banks only report 1/3; 2/3 belongs to the bill that closed on Oct 3, 3/3 to the open one
  const l = ledger([charge("a", "2026-08-15", 70_00, 1, 3)]);
  assert.deepEqual([cardBill(l, "card", "2026-10-25", -1).total, cardBill(l, "card", "2026-10-25", -1).planned], [70_00, 70_00]);
  assert.equal(cardBill(l, "card", "2026-10-25", 0).planned, 70_00);
  assert.equal(cardBill(l, "card", "2026-10-25", 1).planned, 0);
});

test("manual cards post each installment when its date comes", () => {
  const l = ledger([{ ...charge("a", "2026-08-15", 40_00, 1, 3), categoryId: "cat", notes: "presente" }]);
  assert.equal(postDueInstallments(l, "2026-10-20"), 2);
  const posted = l.transactions.filter((t) => t.id !== "a");
  assert.deepEqual(
    posted.map((t) => [t.date, t.amount, t.installment?.number, t.categoryId, t.notes]),
    [
      ["2026-09-15", 40_00, 2, "cat", undefined],
      ["2026-10-15", 40_00, 3, "cat", undefined],
    ]
  );
  // nothing left to post, so running it again adds nothing
  assert.equal(postDueInstallments(l, "2026-12-31"), 0);
});

test("synced cards never post installments: the bank charges them", () => {
  const l = ledger([charge("a", "2026-08-15", 40_00, 1, 3)], { pluggyId: "p-card" });
  l.pluggy = { clientId: "id", clientSecret: "secret", itemIds: ["item"] };
  assert.equal(postDueInstallments(l, "2026-10-20"), 0);
});

test("installment marks in descriptions are read, dates and plain numbers are not", () => {
  assert.deepEqual(installmentFromDescription("MAGALU 03/10"), { number: 3, total: 10 });
  assert.deepEqual(installmentFromDescription("Loja PARC 2/6"), { number: 2, total: 6 });
  assert.deepEqual(installmentFromDescription("Notebook - Parcela 4 de 12"), { number: 4, total: 12 });
  // a day/month date whose day is past the "total" is not an installment
  assert.equal(installmentFromDescription("PIX 25/10"), undefined);
  assert.equal(installmentFromDescription("Netflix"), undefined);
  assert.equal(installmentFromDescription("Loja 1/1"), undefined);
});

test("bank sync keeps which installment a card charge is, from Pluggy or from the description", () => {
  const card: PluggyAccount = { id: "p-card", type: "CREDIT", name: "Cartão", balance: 300 };
  const tx = (id: string, description: string, extra: Partial<PluggyTransaction> = {}): PluggyTransaction => ({
    id,
    accountId: "p-card",
    date: "2026-10-10T00:00:00.000Z",
    description,
    amount: 100,
    type: "DEBIT",
    status: "POSTED",
    ...extra,
  });
  const l = defaultLedger();
  applyBankData(
    l,
    {
      accounts: [card],
      transactions: [
        tx("meta", "AMAZON", { creditCardMetadata: { installmentNumber: 2, totalInstallments: 5 } }),
        tx("desc", "MAGALU 03/10"),
        tx("plain", "MERCADO"),
      ],
      categories: [],
    },
    "2026-08-01",
    "2026-10-25"
  );
  const by = (d: string) => l.transactions.find((t) => t.description === d)?.installment;
  assert.deepEqual(by("AMAZON"), { number: 2, total: 5 });
  assert.deepEqual(by("MAGALU 03/10"), { number: 3, total: 10 });
  assert.equal(by("MERCADO"), undefined);
});
