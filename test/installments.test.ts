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

test("an installment purchase projects its remaining installments, one per bill", () => {
  const l = ledger([charge("a", "2026-09-15", 100_00, 2, 4)]);
  const planned = futureInstallments(l, "card");
  assert.deepEqual(
    planned.map((p) => [p.number, p.date, p.amount]),
    [
      // the card closes on the 3rd: each one is dated on the day its bill opens
      [3, "2026-10-03", 100_00],
      [4, "2026-11-03", 100_00],
    ]
  );
});

test("installments already charged are not projected again", () => {
  // the bank posted 1/3 and 2/3; only 3/3 is still to come
  const l = ledger([charge("a", "2026-09-15", 50_00, 1, 3), charge("b", "2026-10-15", 50_00, 2, 3)]);
  assert.deepEqual(
    futureInstallments(l, "card").map((p) => [p.number, p.date]),
    [[3, "2026-11-03"]]
  );
});

test("two purchases at the same store in different months stay apart", () => {
  const l = ledger([charge("a", "2026-09-15", 30_00, 1, 2), charge("b", "2026-10-20", 80_00, 1, 2)]);
  assert.deepEqual(
    futureInstallments(l, "card").map((p) => [p.date, p.amount]),
    [
      ["2026-10-03", 30_00],
      ["2026-11-03", 80_00],
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
      ["2026-09-03", 40_00, 2, "cat", undefined],
      ["2026-10-03", 40_00, 3, "cat", undefined],
    ]
  );
  // nothing left to post, so running it again adds nothing
  assert.equal(postDueInstallments(l, "2026-12-31"), 0);
});

test("the next installment goes to the next bill even when the closing day moves", () => {
  // the bank closed on Sep 2 and Oct 1, so a purchase on Sep 6 is on the bill closing Oct 1
  // and its 2nd installment on the one after, not one month later by date (Oct 6, the same bill)
  const l = ledger([charge("a", "2026-09-06", 136_10, 1, 2)], {
    closingDay: 22,
    billDates: [
      { close: "2026-09-02", due: "2026-09-10" },
      { close: "2026-10-01", due: "2026-10-10" },
      { close: "2026-11-03", due: "2026-11-10" },
    ],
  });
  assert.deepEqual(
    futureInstallments(l, "card").map((p) => p.date),
    ["2026-10-01"]
  );
  assert.equal(cardBill(l, "card", "2026-10-28", 0).planned, 136_10);
  assert.equal(cardBill(l, "card", "2026-10-28", -1).planned, 0);
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

test("synced charges go on the bill the bank says, whatever their date (Rico)", () => {
  // Rico closes around the 24th-27th and is due on the 1st; its bill months come from Pluggy's billForecastDate
  const l = defaultLedger();
  l.pluggy = { clientId: "id", clientSecret: "secret", itemIds: ["item"] };
  l.accounts.push({
    id: "rico",
    name: "Rico",
    type: "credit",
    openingBalance: 0,
    pluggyId: "p-rico",
    closingDay: 22,
    dueDay: 1,
    // the bank gave the September closing, not the October one
    billDates: [{ close: "2026-09-24", due: "2026-10-01" }],
  });
  const charge = (id: string, date: string, amount: number, forecast: string, installment?: [number, number], purchase?: string): PluggyTransaction => ({
    id,
    accountId: "p-rico",
    date: `${date}T03:00:00.000Z`,
    description: id,
    amount,
    type: "DEBIT",
    status: "POSTED",
    creditCardMetadata: {
      billForecastDate: forecast,
      ...(installment ? { installmentNumber: installment[0], totalInstallments: installment[1], purchaseDate: purchase ?? `${date}T03:00:00.000Z` } : {}),
    },
  });
  applyBankData(
    l,
    {
      accounts: [{ id: "p-rico", type: "CREDIT", name: "Rico", balance: 0 }],
      transactions: [
        // fees posted on the closing day stay on the bill that closes
        charge("multa-set", "2026-09-24", 3.07, "2026-09"),
        charge("amazon", "2026-09-06", 272.21, "2026-09", [1, 2]),
        // the October bill closed on the 26th, a date the bank did not give
        charge("multa-out", "2026-10-26", 16.67, "2026-10"),
        // a later installment carries the purchase date and the 1st installment's month
        charge("paypal", "2026-08-22", 189.51, "2026-06", [3, 3], "2026-06-09T21:27:00.000Z"),
      ],
      categories: [],
    },
    "2026-08-01",
    "2026-10-28"
  );
  const bill = (offset: number) => cardBill(l, "rico", "2026-10-28", offset);
  // the bill due Oct 1: September fee and Amazon 1/2
  assert.deepEqual([bill(-2).due, bill(-2).total], ["2026-10-01", 3_07 + 272_21]);
  // the bill due Nov 1: the October fee and Amazon 2/2, which Pluggy does not send yet
  assert.deepEqual([bill(-1).due, bill(-1).total, bill(-1).planned], ["2026-11-01", 16_67 + 272_21, 272_21]);
  // PayPal 3/3, bought in June, is on the bill closing in August
  assert.equal(bill(-3).total, 189_51);
});

test("banks that give each installment its own bill month (Nubank) are taken as they are", () => {
  // Nubank sends every installment ahead, PENDING, dated in its own cycle with its own bill month
  const l = defaultLedger();
  l.pluggy = { clientId: "id", clientSecret: "secret", itemIds: ["item"] };
  l.accounts.push({ id: "nu", name: "Nubank", type: "credit", openingBalance: 0, pluggyId: "p-nu", closingDay: 2, dueDay: 9 });
  const toro = (n: number, date: string, forecast: string): PluggyTransaction => ({
    id: `toro-${n}`,
    accountId: "p-nu",
    date: `${date}T03:00:00.000Z`,
    description: `Pg *Toro Investimentos ${n}/12`,
    amount: 29.8,
    type: "DEBIT",
    status: "PENDING",
    creditCardMetadata: { billForecastDate: forecast, installmentNumber: n, totalInstallments: 12, purchaseDate: "2026-07-21T14:52:37.001Z" },
  });
  applyBankData(
    l,
    { accounts: [{ id: "p-nu", type: "CREDIT", name: "Nubank", balance: 0 }], transactions: [toro(4, "2026-10-21", "2026-11"), toro(12, "2027-06-21", "2027-07")], categories: [] },
    "2026-08-01",
    "2026-10-28"
  );
  const month = (n: number) => l.transactions.find((t) => t.installment?.number === n)?.billMonth;
  assert.deepEqual([month(4), month(12)], ["2026-11", "2027-07"]);
});
