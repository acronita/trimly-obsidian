import { test } from "node:test";
import assert from "node:assert/strict";
import { applyBankData } from "../src/bank-sync.ts";
import type { BankData, PluggyAccount, PluggyCategory, PluggyTransaction } from "../src/bank-sync.ts";
import { accountBalance, defaultLedger, monthSummary, parseLedger, postDueRecurring, translateDefaults } from "../src/ledger.ts";
import { LANGUAGES } from "../src/i18n/index.ts";
import type { Ledger, Recurring } from "../src/ledger.ts";

const WINDOW = "2026-08-01";
const TODAY = "2026-10-25";

const CATEGORIES: PluggyCategory[] = [
  { id: "05000000", description: "Transfers" },
  { id: "05100000", description: "Credit card payment", parentId: "05000000" },
  { id: "04000000", description: "Same person transfer" },
  { id: "11000000", description: "Food and drinks" },
  { id: "11020000", description: "Food delivery", parentId: "11000000" },
  { id: "10000000", description: "Groceries" },
];

const checking: PluggyAccount = { id: "p-chk", type: "BANK", subtype: "CHECKING_ACCOUNT", name: "Conta", balance: 1000 };
const card: PluggyAccount = { id: "p-card", type: "CREDIT", subtype: "CREDIT_CARD", name: "Cartão", marketingName: "Nubank Ultravioleta", balance: 80 };

function tx(id: string, accountId: string, date: string, amount: number, type: "DEBIT" | "CREDIT", extra: Partial<PluggyTransaction> = {}): PluggyTransaction {
  return { id, accountId, date: `${date}T00:00:00.000Z`, description: id, amount, type, status: "POSTED", ...extra };
}

function data(transactions: PluggyTransaction[], accounts = [checking, card]): BankData {
  return { accounts, transactions, categories: CATEGORIES };
}

function fresh(): Ledger {
  return defaultLedger();
}

function synced(l: Ledger, pluggyId: string) {
  const acc = l.accounts.find((a) => a.pluggyId === pluggyId);
  assert.ok(acc, `account for ${pluggyId}`);
  return acc;
}

test("first sync creates one Trimly account per bank account, with balances matching the bank", () => {
  const l = fresh();
  const r = applyBankData(l, data([tx("salary", "p-chk", "2026-10-05", 5000, "CREDIT"), tx("ifood", "p-card", "2026-10-10", 80, "DEBIT")]), WINDOW, TODAY);
  assert.equal(r.accountsCreated, 2);
  assert.equal(r.added, 2);
  const chk = synced(l, "p-chk");
  const cc = synced(l, "p-card");
  assert.equal(chk.type, "checking");
  assert.equal(cc.type, "credit");
  assert.equal(cc.name, "Nubank Ultravioleta");
  // the dashboard must show what the bank shows, whatever happened before the window
  assert.equal(accountBalance(l, chk.id, TODAY), 1000_00);
  // a card bill is debt: negative in Trimly
  assert.equal(accountBalance(l, cc.id, TODAY), -80_00);
});

test("syncing again with the same data changes nothing (no duplicates)", () => {
  const l = fresh();
  const d = data([tx("salary", "p-chk", "2026-10-05", 5000, "CREDIT"), tx("ifood", "p-card", "2026-10-10", 80, "DEBIT")]);
  applyBankData(l, d, WINDOW, TODAY);
  const before = JSON.stringify(l);
  const r = applyBankData(l, d, WINDOW, TODAY);
  assert.deepEqual(r, { accountsCreated: 0, added: 0, updated: 0, removed: 0 });
  assert.equal(JSON.stringify(l), before);
});

test("paying the card bill becomes one transfer, so purchases are not counted as spending twice", () => {
  const l = fresh();
  applyBankData(
    l,
    data([
      tx("market", "p-card", "2026-09-20", 300, "DEBIT"),
      // bill paid from checking; the card shows the payment as a negative amount
      tx("bill-out", "p-chk", "2026-10-10", -300, "DEBIT", { categoryId: "05100000" }),
      tx("bill-in", "p-card", "2026-10-11", -300, "CREDIT", { categoryId: "05100000" }),
    ]),
    WINDOW,
    TODAY
  );
  const transfers = l.transactions.filter((t) => t.type === "transfer");
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].accountId, synced(l, "p-chk").id);
  assert.equal(transfers[0].toAccountId, synced(l, "p-card").id);
  assert.equal(monthSummary(l, "2026-10").expense, 0);
  assert.equal(monthSummary(l, "2026-09").expense, 300_00);
});

test("a bill payment the card reports twice counts once, not as income", () => {
  // C6 and Nubank also list the paid amount on the card under another name, uncategorized or not
  const l = fresh();
  const bill = [
    tx("market", "p-card", "2026-09-20", 300, "DEBIT"),
    tx("bill-out", "p-chk", "2026-10-02", -300, "DEBIT", { categoryId: "05100000" }),
    tx("bill-in", "p-card", "2026-10-02", -300, "CREDIT", { categoryId: "05100000" }),
  ];
  const copy = tx("Inclusao de Pagamento Ciclo Corrente", "p-card", "2026-10-02", -300, "CREDIT", { categoryId: "05000000" });
  // a ledger synced before the fix already holds the copy as income: the next sync removes it
  applyBankData(l, data([...bill, copy].filter((t) => t.id !== "bill-out")), WINDOW, TODAY);
  applyBankData(l, data([...bill, copy]), WINDOW, TODAY);
  assert.equal(l.transactions.filter((t) => t.type === "transfer").length, 1);
  assert.equal(l.transactions.filter((t) => t.type === "income").length, 0);
  assert.equal(monthSummary(l, "2026-10").income, 0);
  assert.equal(accountBalance(l, synced(l, "p-card").id, TODAY), -80_00);
});

test("a bill payment the card only reports under Transfers still pairs with the bank's debit (C6)", () => {
  // months where Pluggy built no "Pagamento recebido": the card has only C6's own copy, as a generic transfer
  const l = fresh();
  applyBankData(
    l,
    data([
      tx("PGTO FAT CARTAO C6", "p-chk", "2026-07-01", -118.56, "DEBIT"),
      tx("Inclusao de Pagamento Ciclo Corrente", "p-card", "2026-07-01", -118.56, "CREDIT", { categoryId: "05000000" }),
    ]),
    WINDOW,
    TODAY
  );
  assert.equal(l.transactions.filter((t) => t.type === "transfer").length, 1);
  assert.equal(l.transactions.filter((t) => t.type === "income").length, 0);
});

test("a card refund is not mistaken for a bill payment when categories say otherwise", () => {
  const l = fresh();
  applyBankData(
    l,
    data([
      tx("dinner", "p-chk", "2026-10-10", -50, "DEBIT", { categoryId: "11000000" }),
      tx("refund", "p-card", "2026-10-11", -50, "CREDIT", { categoryId: "11020000" }),
    ]),
    WINDOW,
    TODAY
  );
  assert.equal(l.transactions.filter((t) => t.type === "transfer").length, 0);
});

test("equal amounts between two banks only pair when Pluggy says it is a same-person transfer", () => {
  const savings: PluggyAccount = { id: "p-sav", type: "BANK", subtype: "SAVINGS_ACCOUNT", name: "Poupança", balance: 0 };
  const unrelated = fresh();
  applyBankData(unrelated, data([tx("pix-out", "p-chk", "2026-10-10", -200, "DEBIT"), tx("pix-in", "p-sav", "2026-10-10", 200, "CREDIT")], [checking, savings]), WINDOW, TODAY);
  assert.equal(unrelated.transactions.filter((t) => t.type === "transfer").length, 0);

  const own = fresh();
  applyBankData(
    own,
    data([tx("pix-out", "p-chk", "2026-10-10", -200, "DEBIT", { categoryId: "04000000" }), tx("pix-in", "p-sav", "2026-10-10", 200, "CREDIT")], [checking, savings]),
    WINDOW,
    TODAY
  );
  assert.equal(own.transactions.filter((t) => t.type === "transfer").length, 1);
});

test("a card transaction restated with a new id keeps the user's category and is not duplicated", () => {
  const l = fresh();
  applyBankData(l, data([tx("old-id", "p-card", "2026-10-10", 80, "DEBIT", { status: "PENDING" })]), WINDOW, TODAY);
  const imported = l.transactions.find((t) => t.pluggyIds?.includes("old-id"));
  assert.ok(imported);
  assert.equal(imported.pending, true);
  const groceries = l.categories.find((c) => c.name === "Mercado");
  assert.ok(groceries);
  imported.categoryId = groceries.id;

  // the bill closed: Pluggy deletes the row and re-creates it, posted, with a new id and date
  const r = applyBankData(l, data([tx("new-id", "p-card", "2026-10-12", 80, "DEBIT")]), WINDOW, TODAY);
  assert.deepEqual(r, { accountsCreated: 0, added: 0, updated: 1, removed: 0 });
  const card = l.transactions.filter((t) => t.accountId === synced(l, "p-card").id);
  assert.equal(card.length, 1);
  assert.deepEqual(card[0].pluggyIds, ["new-id"]);
  assert.equal(card[0].date, "2026-10-12");
  assert.equal(card[0].pending, undefined);
  assert.equal(card[0].categoryId, groceries.id);
});

test("imported transactions the bank no longer returns are removed, but only inside the window", () => {
  const l = fresh();
  applyBankData(l, data([tx("kept-old", "p-chk", "2026-07-15", -10, "DEBIT"), tx("dropped", "p-chk", "2026-10-01", -20, "DEBIT")]), "2026-07-01", TODAY);
  const wallet = l.accounts.find((a) => !a.pluggyId);
  assert.ok(wallet);
  l.transactions.push({ id: "manual", date: "2026-10-02", type: "expense", amount: 5_00, accountId: wallet.id, description: "Cash" });

  const r = applyBankData(l, data([]), WINDOW, TODAY);
  assert.equal(r.removed, 1);
  const ids = l.transactions.map((t) => t.pluggyIds?.[0] ?? t.id).sort();
  // older than the window: never re-fetched, so never judged; manual entries are the user's
  assert.deepEqual(ids, ["kept-old", "manual"]);
});

test("Pluggy categories map onto the default Trimly categories by tree, otherwise stay uncategorized", () => {
  const l = fresh();
  applyBankData(
    l,
    data([
      tx("ifood", "p-card", "2026-10-10", 40, "DEBIT", { categoryId: "11020000" }),
      tx("market", "p-card", "2026-10-11", 90, "DEBIT", { categoryId: "10000000" }),
      tx("mystery", "p-card", "2026-10-12", 15, "DEBIT", { categoryId: null }),
    ]),
    WINDOW,
    TODAY
  );
  const nameOf = (pid: string) => {
    const t = l.transactions.find((x) => x.pluggyIds?.includes(pid));
    return l.categories.find((c) => c.id === t?.categoryId)?.name;
  };
  assert.equal(nameOf("ifood"), "Restaurantes");
  assert.equal(nameOf("market"), "Mercado");
  assert.equal(nameOf("mystery"), undefined);
});

test("a synced card takes its closing and due days from the bank, without overriding ones set by hand", () => {
  const withDays: PluggyAccount = {
    ...card,
    creditData: { balanceCloseDate: "2026-11-03T00:00:00.000Z", balanceDueDate: "2026-11-10T00:00:00.000Z", creditLimit: 5000 },
  };
  const l = fresh();
  applyBankData(l, data([], [withDays]), WINDOW, TODAY);
  const acc = synced(l, "p-card");
  assert.deepEqual([acc.closingDay, acc.dueDay, acc.creditLimit], [3, 10, 5000_00]);
  acc.closingDay = 5;
  applyBankData(l, data([], [withDays]), WINDOW, TODAY);
  assert.deepEqual([acc.closingDay, acc.dueDay], [5, 10]);
});

test("a card keeps the bank's bill dates, each bill once, taking the latest closing date", () => {
  const l = fresh();
  const bill = (id: string, close: string, due: string) => ({ id, accountId: "p-card", billClosingDate: `${close}T00:00:00.000Z`, dueDate: `${due}T00:00:00.000Z` });
  applyBankData(l, { ...data([]), bills: [bill("b1", "2026-09-26", "2026-10-01"), bill("b2", "2026-10-26", "2026-11-01")] }, WINDOW, TODAY);
  // later the bank moves November's bill, and the card gives the open bill's dates; September's is no longer listed
  const open = { ...card, creditData: { balanceCloseDate: "2026-11-22T00:00:00.000Z", balanceDueDate: "2026-12-01T00:00:00.000Z" } };
  applyBankData(l, { ...data([], [checking, open]), bills: [bill("b2", "2026-10-24", "2026-11-01")] }, WINDOW, TODAY);
  assert.deepEqual(synced(l, "p-card").billDates, [
    { close: "2026-09-26", due: "2026-10-01" },
    { close: "2026-10-24", due: "2026-11-01" },
    { close: "2026-11-22", due: "2026-12-01" },
  ]);
  assert.equal(synced(l, "p-chk").billDates, undefined);
});

test("bank sync credentials survive saving and reopening the ledger", () => {
  const l = fresh();
  l.pluggy = { clientId: "id", clientSecret: "secret", itemIds: ["item"] };
  assert.deepEqual(parseLedger(JSON.stringify(l)).pluggy, l.pluggy);
});

test("starter categories still map after being translated", () => {
  const l = fresh();
  translateDefaults(l, LANGUAGES["pt-BR"], LANGUAGES.en);
  applyBankData(l, data([tx("market", "p-card", "2026-10-11", 90, "DEBIT", { categoryId: "10000000" })]), WINDOW, TODAY);
  const t = l.transactions.find((x) => x.pluggyIds?.includes("market"));
  assert.equal(l.categories.find((c) => c.id === t?.categoryId)?.name, "Groceries");
});

/** A synced ledger with a monthly Netflix rule on the synced card. */
function withNetflix(nextDate = "2026-09-12"): { l: Ledger; rule: Recurring } {
  const l = fresh();
  l.pluggy = { clientId: "id", clientSecret: "secret", itemIds: ["item"], lastSync: `${TODAY}T12:00:00.000Z` };
  applyBankData(l, data([]), WINDOW, TODAY);
  const entertainment = l.categories.find((c) => c.name === "Lazer");
  const rule: Recurring = {
    id: "netflix",
    description: "Netflix",
    type: "expense",
    amount: 39_90,
    accountId: synced(l, "p-card").id,
    categoryId: entertainment?.id,
    frequency: "monthly",
    startDate: nextDate,
    nextDate,
    subscription: true,
  };
  l.recurring.push(rule);
  return { l, rule };
}

test("a rule on a synced card is never posted: the imported charge is linked instead, so it counts once", () => {
  const { l, rule } = withNetflix();
  applyBankData(l, data([tx("NETFLIX.COM", "p-card", "2026-09-12", 39.9, "DEBIT"), tx("NETFLIX.COM 2", "p-card", "2026-10-13", 39.9, "DEBIT")]), WINDOW, TODAY);
  assert.equal(postDueRecurring(l, TODAY), 0);
  assert.equal(l.transactions.length, 2);
  assert.ok(l.transactions.every((x) => x.recurringId === "netflix"));
  // the rule's category wins over whatever sync guessed
  assert.ok(l.transactions.every((x) => x.categoryId === rule.categoryId));
  assert.equal(rule.nextDate, "2026-11-12");
  // the card balance is still what the bank says
  assert.equal(accountBalance(l, synced(l, "p-card").id, TODAY), -80_00);
});

test("a price increase still links by name, and the rule follows the new price", () => {
  const { l, rule } = withNetflix("2026-10-12");
  applyBankData(l, data([tx("NETFLIX.COM", "p-card", "2026-10-11", 55.9, "DEBIT")]), WINDOW, TODAY);
  postDueRecurring(l, TODAY);
  assert.equal(l.transactions[0].recurringId, "netflix");
  assert.equal(rule.amount, 55_90);
});

test("an unrelated purchase is not taken for the subscription", () => {
  const { l, rule } = withNetflix("2026-10-12");
  // other name and price far off, or same price but weeks away
  applyBankData(l, data([tx("Padaria", "p-card", "2026-10-12", 12, "DEBIT"), tx("Loja", "p-card", "2026-09-01", 39.9, "DEBIT")]), WINDOW, TODAY);
  postDueRecurring(l, TODAY);
  assert.ok(l.transactions.every((x) => !x.recurringId));
  // no charge 13 days after the due date, with sync up to date: that month was skipped
  assert.equal(rule.nextDate, "2026-11-12");
});

test("a charge sharing the name but far off the price is not the subscription", () => {
  // a one-off purchase at the same store must not reprice the rule
  const { l, rule } = withNetflix("2026-10-12");
  applyBankData(l, data([tx("NETFLIX.COM", "p-card", "2026-10-11", 200, "DEBIT")]), WINDOW, TODAY);
  postDueRecurring(l, TODAY);
  assert.ok(l.transactions.every((x) => !x.recurringId));
  assert.equal(rule.amount, 39_90);
});

test("generic bank wording is not a name: another transfer is not taken for the rule", () => {
  // the rule was made from a 4,210 transfer; a 1,000 transfer from someone else days before the
  // next one shares only "Transferência Recebida" and must not be linked nor reprice the rule
  const l = fresh();
  l.pluggy = { clientId: "id", clientSecret: "secret", itemIds: ["item"], lastSync: `${TODAY}T12:00:00.000Z` };
  applyBankData(l, data([tx("Transferência Recebida|ROBSON", "p-chk", "2026-10-24", 1000, "CREDIT")]), WINDOW, TODAY);
  const rule: Recurring = {
    id: "salary",
    description: "Transferência Recebida",
    type: "income",
    amount: 4210_00,
    accountId: synced(l, "p-chk").id,
    frequency: "monthly",
    startDate: "2026-09-30",
    nextDate: "2026-10-30",
  };
  l.recurring.push(rule);
  postDueRecurring(l, TODAY);
  assert.ok(l.transactions.every((x) => !x.recurringId));
  assert.equal(rule.amount, 4210_00);
  assert.equal(rule.nextDate, "2026-10-30");
});

test("a synced rule waits for its charge while sync has not caught up", () => {
  const { l, rule } = withNetflix("2026-10-22");
  postDueRecurring(l, TODAY);
  // only 3 days past due: the charge may still be pending at the bank
  assert.equal(rule.nextDate, "2026-10-22");
  l.pluggy!.lastSync = "2026-10-01T12:00:00.000Z";
  rule.nextDate = "2026-09-22";
  postDueRecurring(l, TODAY);
  // sync last ran 11 days after due without the charge: skipped; October is after the last sync, so it waits
  assert.equal(rule.nextDate, "2026-10-22");
});

test("history older than the window is imported, re-linked when its id changes, and never removed", () => {
  const l = fresh();
  // the fetch reaches a year back; WINDOW only limits what may be removed
  applyBankData(l, data([tx("old", "p-card", "2025-11-28", 50, "DEBIT")]), WINDOW, TODAY);
  const old = l.transactions.find((t) => t.description === "old");
  assert.ok(old);
  old.notes = "kept";
  // Pluggy re-created it with a new id: the same entry is re-linked, not duplicated
  applyBankData(l, data([tx("old-2", "p-card", "2025-11-28", 50, "DEBIT")]), WINDOW, TODAY);
  assert.equal(l.transactions.length, 1);
  assert.equal(l.transactions[0].notes, "kept");
  // a later sync that no longer returns it leaves it alone, since it is before the window
  applyBankData(l, data([]), WINDOW, TODAY);
  assert.equal(l.transactions.length, 1);
});

test("a category the user taught wins over the bank's for new synced transactions", () => {
  const ifood = () => data([tx("IFOOD 123", "p-card", "2026-10-10", 80, "DEBIT", { categoryId: "11020000" })]);
  const plain = fresh();
  applyBankData(plain, ifood(), WINDOW, TODAY);
  const fromBank = plain.transactions[0].categoryId;
  assert.ok(fromBank, "the bank's category maps to one of Trimly's");

  const l = fresh();
  const taught = l.categories.find((c) => c.kind === "expense" && c.id !== fromBank)!;
  l.categoryRules = [{ key: "ifood", categoryId: taught.id }];
  applyBankData(l, ifood(), WINDOW, TODAY);
  assert.equal(l.transactions[0].categoryId, taught.id);
});
