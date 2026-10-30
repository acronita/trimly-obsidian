import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultLedger,
  dueObligations,
  estimatedBills,
  expectedAmount,
  linkObligationPayments,
  linkPayment,
  matchScore,
  nextDue,
  obligationReminders,
  openOccurrences,
  paidOn,
  parseLedger,
  payableOccurrences,
  paymentCandidates,
  paymentOf,
  settleObligation,
  settlementFor,
  unsettleObligation,
  windowStart,
} from "../src/ledger.ts";
import { businessDayFrom, isBusinessDay } from "../src/business-days.ts";
import type { Ledger, Obligation, Transaction } from "../src/ledger.ts";

const TODAY = "2026-10-25";

function obligation(extra: Partial<Obligation> = {}): Obligation {
  return { id: "light", name: "Conta de luz", kind: "payment", frequency: "monthly", day: 10, since: "2026-08-01", remindDays: 3, settled: [], ...extra };
}

function ledgerWith(...obligations: Obligation[]): Ledger {
  const l = defaultLedger();
  l.obligations = obligations;
  return l;
}

test("every month not dealt with stays open, so a forgotten bill keeps showing as overdue", () => {
  const o = obligation();
  assert.deepEqual(openOccurrences(o, TODAY), ["2026-08-10", "2026-09-10", "2026-10-10"]);
  settleObligation(o, { due: "2026-08-10", status: "done", date: "2026-08-09" });
  // skipping counts as dealt with: no water bill that month is not a debt
  settleObligation(o, { due: "2026-09-10", status: "skipped", date: "2026-09-12" });
  assert.deepEqual(openOccurrences(o, TODAY), ["2026-10-10"]);
  unsettleObligation(o, "2026-09-10");
  assert.deepEqual(openOccurrences(o, TODAY), ["2026-09-10", "2026-10-10"]);
});

test("moving the due day does not reopen months already paid", () => {
  const o = obligation();
  settleObligation(o, { due: "2026-08-10", status: "done", date: "2026-08-09" });
  o.day = 15;
  assert.deepEqual(openOccurrences(o, "2026-08-31"), []);
});

test("marking the same month twice keeps a single mark", () => {
  const o = obligation();
  settleObligation(o, { due: "2026-10-10", status: "skipped", date: "2026-10-10" });
  settleObligation(o, { due: "2026-10-10", status: "done", date: "2026-10-11", transactionId: "tx" });
  assert.equal(o.settled.length, 1);
  assert.equal(o.settled[0].status, "done");
});

test("occurrences due before an obligation existed never open", () => {
  const o = obligation({ since: TODAY });
  assert.deepEqual(openOccurrences(o, "2026-11-30"), ["2026-11-10"]);
});

test("due days past the end of a short month fall on its last day", () => {
  const rent = obligation({ day: 31, since: "2027-01-01" });
  assert.deepEqual(openOccurrences(rent, "2027-03-31"), ["2027-01-31", "2027-02-28", "2027-03-31"]);
});

test("yearly obligations come due once a year in their month, and ending one stops it", () => {
  const irpf = obligation({ id: "irpf", name: "Declaração IRPF", kind: "document", frequency: "yearly", month: 5, day: 1, endDay: 29, since: "2025-01-01" });
  assert.deepEqual(openOccurrences(irpf, TODAY), ["2025-05-29", "2026-05-29"]);
  assert.equal(nextDue(irpf, TODAY), "2027-05-29");
  irpf.archived = true;
  assert.equal(nextDue(irpf, TODAY), undefined);
  // an ended obligation stops nagging about what was left open
  assert.deepEqual(openOccurrences(irpf, TODAY), []);
});

test("a document is due on the last day of its window, which opens on the start day", () => {
  const nf = obligation({ id: "nf", kind: "document", day: 1, endDay: 20, since: "2026-10-01" });
  assert.deepEqual(openOccurrences(nf, TODAY), ["2026-10-20"]);
  assert.equal(windowStart(nf, "2026-10-20"), "2026-10-01");
});

test("a yearly document's window can span months, like the IRPF from March 23 to May 29", () => {
  const irpf = obligation({ id: "irpf", kind: "document", frequency: "yearly", month: 3, day: 23, endMonth: 5, endDay: 29, since: "2026-01-01" });
  assert.deepEqual(openOccurrences(irpf, "2026-12-31"), ["2026-05-29"]);
  assert.equal(windowStart(irpf, "2026-05-29"), "2026-03-23");
  // nothing is due before the deadline, even while the window is open
  assert.deepEqual(openOccurrences(irpf, "2026-04-15"), []);
});

test("business days skip weekends and national bank holidays, movable ones included", () => {
  assert.equal(isBusinessDay("2026-10-23"), true); // Friday
  assert.equal(isBusinessDay("2026-10-24"), false); // Saturday
  assert.equal(isBusinessDay("2026-11-02"), false); // Finados, Monday
  assert.equal(isBusinessDay("2026-11-20"), false); // Consciência Negra
  // Easter 2026 is April 5
  assert.equal(isBusinessDay("2026-02-16"), false); // Carnaval Monday
  assert.equal(isBusinessDay("2026-02-17"), false); // Carnaval Tuesday
  assert.equal(isBusinessDay("2026-02-18"), true); // Ash Wednesday
  assert.equal(isBusinessDay("2026-04-03"), false); // Good Friday
  assert.equal(isBusinessDay("2026-06-04"), false); // Corpus Christi
  // Saturday Oct 31 → Sunday → Finados Monday Nov 2 → Tuesday
  assert.equal(businessDayFrom("2026-10-31"), "2026-11-03");
  assert.equal(businessDayFrom("2026-10-23"), "2026-10-23");
});

test("a bill paid when banks are closed is scheduled for the next business day; documents are not", () => {
  const light = obligation();
  assert.equal(paidOn(light, "2026-10-10", "2026-10-24").date, "2026-10-26");
  assert.equal(paidOn(light, "2026-10-10", "2026-10-23").date, "2026-10-23");
  const nf = obligation({ kind: "document" });
  assert.equal(paidOn(nf, "2026-10-10", "2026-10-24").date, "2026-10-24");
});

test("reminders start remindDays before the due date and keep going while overdue", () => {
  const das = obligation({ id: "das", name: "DAS MEI", day: 20, since: "2026-10-01", remindDays: 3 });
  const internet = obligation({ id: "net", name: "Internet", day: 28, since: "2026-10-01", remindDays: 3 });
  const phone = obligation({ id: "phone", name: "Telefone", day: 29, since: "2026-10-01", remindDays: 3 });
  const l = ledgerWith(das, internet, phone);
  assert.deepEqual(
    obligationReminders(l, TODAY).map((d) => d.obligation.id),
    ["das", "net"] // overdue, due in 3 days; the phone bill in 4 days is not yet
  );
  settleObligation(das, { due: "2026-10-20", status: "done", date: TODAY });
  assert.deepEqual(obligationReminders(l, TODAY).map((d) => d.obligation.id), ["net"]);
  assert.deepEqual(dueObligations(l, "2026-10-31", TODAY).map((d) => d.obligation.id), ["net", "phone"]);
});

test("payment suggestions prefer the bill's name and skip transactions already linked elsewhere", () => {
  const light = obligation({ amount: 120_00 });
  const water = obligation({ id: "water", name: "Água", settled: [{ due: "2026-10-10", status: "done", date: "2026-10-10", transactionId: "sabesp" }] });
  const l = ledgerWith(light, water);
  const acc = l.accounts[0].id;
  l.transactions.push(
    { id: "enel", date: "2026-10-09", type: "expense", amount: 98_00, accountId: acc, description: "PAG*ENEL CONTA DE LUZ" },
    { id: "market", date: "2026-10-10", type: "expense", amount: 120_00, accountId: acc, description: "Mercado" },
    { id: "sabesp", date: "2026-10-10", type: "expense", amount: 60_00, accountId: acc, description: "Sabesp" },
    { id: "salary", date: "2026-10-10", type: "income", amount: 5000_00, accountId: acc, description: "Salário" },
    { id: "old", date: "2026-08-01", type: "expense", amount: 120_00, accountId: acc, description: "Luz" }
  );
  assert.deepEqual(paymentCandidates(l, light, "2026-10-10").map((t) => t.id), ["enel", "market"]);
});

test("similarity: a shared word beats any amount, and strict lookups reject the rest", () => {
  const tx = (description: string, amount: number, date = "2026-10-10"): Transaction => ({ id: description, date, type: "expense", amount, accountId: "a", description });
  const e = { text: "Conta de luz Enel", amount: 100_00, date: "2026-10-10", maxDays: 7 };
  // accents and case do not matter; a named charge far off in amount still ranks above an unnamed exact one
  assert.ok(matchScore(tx("ENÉL SP", 300_00), e)! < matchScore(tx("Mercado", 100_00), e)!);
  assert.equal(matchScore(tx("Enel", 100_00, "2026-10-20"), e), undefined); // too far from the date
  assert.equal(matchScore(tx("Mercado", 130_00), { ...e, amountTolerance: 0.2 }), undefined);
  assert.notEqual(matchScore(tx("Mercado", 110_00), { ...e, amountTolerance: 0.2 }), undefined);
  assert.equal(matchScore(tx("Mercado", 100_00), { ...e, requireName: true }), undefined);
});

test("linking a payment remembers it, so the next months link themselves", () => {
  const light = obligation({ amount: 120_00 });
  const l = ledgerWith(light);
  const acc = l.accounts[0].id;
  const enelAug: Transaction = { id: "aug", date: "2026-08-08", type: "expense", amount: 110_00, accountId: acc, description: "PAG*ENEL DISTRIBUICAO" };
  l.transactions.push(enelAug);
  linkPayment(light, "2026-08-10", enelAug);
  assert.deepEqual(light.settled, [{ due: "2026-08-10", status: "done", date: "2026-08-08", transactionId: "aug" }]);
  assert.equal(paymentOf(l, "aug")?.obligation.id, "light");

  l.transactions.push(
    // same amount as usual but nothing like the bill: must not be taken for it
    { id: "market", date: "2026-09-10", type: "expense", amount: 120_00, accountId: acc, description: "Mercado" },
    { id: "sep", date: "2026-09-11", type: "expense", amount: 143_00, accountId: acc, description: "ENEL DISTRIBUICAO SP" },
    // after today: not paid yet, even if it looks like the bill
    { id: "nov", date: "2026-11-09", type: "expense", amount: 120_00, accountId: acc, description: "ENEL DISTRIBUICAO SP" }
  );
  assert.equal(linkObligationPayments(l, TODAY), 1);
  assert.equal(settlementFor(light, "2026-09-10")?.transactionId, "sep");
  // the last payment becomes the usual amount, so the next bill is projected at it
  assert.equal(light.amount, 143_00);
  assert.equal(settlementFor(light, "2026-10-10"), undefined);
  assert.equal(linkObligationPayments(l, TODAY), 0); // running again changes nothing
});

test("a bill without a usual amount is projected at its last linked payment, else at an explicit 0", () => {
  const light = obligation({
    settled: [
      { due: "2026-08-10", status: "done", date: "2026-08-09", transactionId: "aug" },
      { due: "2026-09-10", status: "done", date: "2026-09-09", transactionId: "sep" },
      { due: "2026-10-10", status: "skipped", date: "2026-10-10" },
    ],
  });
  const l = ledgerWith(light);
  const acc = l.accounts[0].id;
  l.transactions.push(
    { id: "aug", date: "2026-08-09", type: "expense", amount: 90_00, accountId: acc, description: "Enel" },
    { id: "sep", date: "2026-09-09", type: "expense", amount: 105_00, accountId: acc, description: "Enel" }
  );
  assert.equal(expectedAmount(l, light), 105_00);
  assert.equal(expectedAmount(l, { ...light, amount: 120_00 }), 120_00); // a usual amount wins
  assert.equal(expectedAmount(l, obligation()), 0);
  assert.equal(expectedAmount(l, obligation({ kind: "document", amount: 50_00 })), 0);
});

test("obligations never linked to a transaction are not linked automatically", () => {
  const light = obligation({ amount: 120_00 });
  const l = ledgerWith(light);
  l.transactions.push({ id: "luz", date: "2026-10-10", type: "expense", amount: 120_00, accountId: l.accounts[0].id, description: "Conta de luz" });
  assert.equal(linkObligationPayments(l, TODAY), 0);
});

test("a transaction can be linked to any bill due near it that no other transaction paid", () => {
  const light = obligation();
  const water = obligation({ id: "water", name: "Água", settled: [{ due: "2026-10-10", status: "done", date: "2026-10-10", transactionId: "other" }] });
  const das = obligation({ id: "das", name: "DAS", kind: "document" });
  const l = ledgerWith(light, water, das);
  const tx: Transaction = { id: "t", date: "2026-10-09", type: "expense", amount: 98_00, accountId: l.accounts[0].id, description: "Enel conta de luz" };
  // one occurrence per bill, the closest to the transaction; water's October one is paid by another, so its September one is offered
  assert.deepEqual(payableOccurrences(l, tx).map((d) => `${d.obligation.id} ${d.due}`), ["light 2026-10-10", "water 2026-09-10"]);
  assert.deepEqual(payableOccurrences(l, { ...tx, type: "income" }), []);
});

test("obligations survive saving and reopening the ledger", () => {
  const l = ledgerWith(obligation({ settled: [{ due: "2026-08-10", status: "done", date: "2026-08-09" }] }));
  assert.deepEqual(parseLedger(JSON.stringify(l)).obligations, l.obligations);
  // ledgers from before obligations existed load with none
  assert.deepEqual(parseLedger(JSON.stringify({ version: 3, accounts: [] })).obligations, []);
});

test("obligations saved with full dates (0.9.0) load as days, and past end dates end them", () => {
  const old = (extra: object) => ({ id: "x", name: "X", kind: "payment", remindDays: 3, settled: [], ...extra });
  const l = parseLedger(
    JSON.stringify({
      version: 4,
      obligations: [
        old({ frequency: "monthly", startDate: "2026-08-10" }),
        old({ frequency: "yearly", startDate: "2025-05-29", endDate: "2025-12-31" }),
        old({ frequency: "weekly", startDate: "2026-10-05" }),
      ],
    })
  );
  const [monthly, yearly, weekly] = l.obligations;
  assert.deepEqual([monthly.day, monthly.since, monthly.archived], [10, "2026-08-10", undefined]);
  assert.deepEqual([yearly.frequency, yearly.month, yearly.day, yearly.archived], ["yearly", 5, 29, true]);
  assert.equal("startDate" in monthly || "endDate" in yearly, false);
  assert.deepEqual([weekly.frequency, weekly.day], ["monthly", 5]);
  // the months already open stay open after the migration
  assert.deepEqual(openOccurrences(monthly, TODAY), ["2026-08-10", "2026-09-10", "2026-10-10"]);
});

test("the recurring tab's estimate of bills paid by hand counts each once, per month", () => {
  const light = obligation({ amount: 180_00 });
  const ipva = obligation({ id: "ipva", name: "IPVA", frequency: "yearly", month: 1, amount: 1200_00 });
  const irpf = obligation({ id: "irpf", name: "IRPF", kind: "document" });
  const old = obligation({ id: "old", amount: 99_00, archived: true });
  // rent already posted by a recurring rule: counting it here too would charge it twice
  const rent = obligation({ id: "rent", name: "Aluguel", amount: 2000_00, settled: [{ due: "2026-10-10", status: "done", date: "2026-10-10", transactionId: "r1" }] });
  const l = ledgerWith(light, ipva, irpf, old, rent);
  l.transactions.push({ id: "r1", date: "2026-10-10", type: "expense", amount: 2000_00, accountId: l.accounts[0].id, description: "Aluguel", recurringId: "rule" });
  assert.deepEqual(estimatedBills(l).map((b) => [b.obligation.id, b.monthly]), [["light", 180_00], ["ipva", 100_00]]);
});

test("months already marked paid by hand get their payment linked too, so every month of a bill is traceable", () => {
  const plan = obligation({
    id: "plan",
    name: "Plano de saúde",
    fixed: true,
    settled: [
      { due: "2026-08-10", status: "done", date: "2026-08-10" },
      { due: "2026-09-10", status: "done", date: "2026-09-10" },
      { due: "2026-10-10", status: "done", date: "2026-10-09", transactionId: "oct" },
    ],
    payee: "UNIMED SEGUROS",
    amount: 500_00,
  });
  const l = ledgerWith(plan);
  const acc = l.accounts[0].id;
  const health = l.categories.find((c) => c.kind === "expense")!.id;
  l.transactions.push(
    { id: "aug", date: "2026-08-09", type: "expense", amount: 480_00, accountId: acc, description: "UNIMED SEGUROS", categoryId: health },
    { id: "sep", date: "2026-09-09", type: "expense", amount: 480_00, accountId: acc, description: "UNIMED SEGUROS" },
    { id: "oct", date: "2026-10-09", type: "expense", amount: 500_00, accountId: acc, description: "UNIMED SEGUROS" }
  );
  assert.equal(linkObligationPayments(l, TODAY), 2);
  assert.equal(settlementFor(plan, "2026-08-10")?.transactionId, "aug");
  assert.equal(settlementFor(plan, "2026-09-10")?.transactionId, "sep");
  assert.equal(settlementFor(plan, "2026-09-10")?.date, "2026-09-09");
  // an older payment does not become the usual amount the next bill is projected at
  assert.equal(plan.amount, 500_00);
  // the bill picks up the category its payments are in, for Planning
  assert.equal(plan.categoryId, health);
});

test("a skipped month is never given a payment", () => {
  const light = obligation({ payee: "ENEL", settled: [{ due: "2026-09-10", status: "skipped", date: "2026-09-10" }] });
  const l = ledgerWith(light);
  l.transactions.push({ id: "x", date: "2026-09-09", type: "expense", amount: 100_00, accountId: l.accounts[0].id, description: "ENEL" });
  linkObligationPayments(l, TODAY);
  assert.equal(settlementFor(light, "2026-09-10")?.transactionId, undefined);
});

test("payments of a bill from before it was registered are still that bill's, by description and amount", () => {
  // registered in October; August and September were paid before it existed, so they have no occurrence
  const plan = obligation({ id: "unimed", name: "Unimed", since: "2026-10-01", day: 20, fixed: true, amount: 520_00 });
  const l = ledgerWith(plan);
  const acc = l.accounts[0].id;
  l.transactions.push(
    { id: "aug", date: "2026-08-19", type: "expense", amount: 500_00, accountId: acc, description: "Pagamento efetuado|UNIMED SEGUROS" },
    { id: "sep", date: "2026-09-21", type: "expense", amount: 510_00, accountId: acc, description: "Pagamento efetuado|UNIMED SEGUROS" },
    { id: "oct", date: "2026-10-19", type: "expense", amount: 520_00, accountId: acc, description: "Pagamento efetuado|UNIMED SEGUROS" },
    // same bank wording, another bill: "Pagamento efetuado" names nobody
    { id: "enel", date: "2026-09-10", type: "expense", amount: 500_00, accountId: acc, description: "Pagamento efetuado|ENEL" },
    // same name but nothing like the usual amount: a one-off, not the plan
    { id: "consult", date: "2026-09-05", type: "expense", amount: 90_00, accountId: acc, description: "UNIMED CONSULTA" }
  );
  linkPayment(plan, "2026-10-20", l.transactions.find((x) => x.id === "oct")!);
  linkObligationPayments(l, TODAY);
  const billOfTx = (id: string) => l.transactions.find((x) => x.id === id)?.obligationId;
  assert.equal(billOfTx("oct"), "unimed");
  assert.equal(billOfTx("aug"), "unimed");
  assert.equal(billOfTx("sep"), "unimed");
  assert.equal(billOfTx("enel"), undefined);
  assert.equal(billOfTx("consult"), undefined);
  // only October has an occurrence to settle; the older ones are the bill's without one
  assert.equal(settlementFor(plan, "2026-09-20"), undefined);

  // unlinked by hand: stays unlinked
  l.transactions.find((x) => x.id === "aug")!.obligationId = null;
  linkObligationPayments(l, TODAY);
  assert.equal(billOfTx("aug"), null);
});

test("a bill that never learned its payment's description still finds its older payments by its own name", () => {
  // as in the app: the usual amount is empty and only October's occurrence is linked
  const l = ledgerWith();
  const health = l.categories.find((c) => c.kind === "expense")!.id;
  const other = l.categories.find((c) => c.kind === "expense" && c.id !== health)!.id;
  const unimed = obligation({ id: "unimed", name: "Unimed", since: "2026-10-01", day: 20, categoryId: health, settled: [{ due: "2026-10-20", status: "done", date: "2026-10-19", transactionId: "oct" }] });
  l.obligations = [unimed];
  const acc = l.accounts[0].id;
  l.transactions.push(
    { id: "aug", date: "2026-08-19", type: "expense", amount: 505_00, accountId: acc, categoryId: health, description: "Pagamento efetuado|UNIMED SEGUROS" },
    { id: "oct", date: "2026-10-19", type: "expense", amount: 520_00, accountId: acc, categoryId: health, description: "Pagamento efetuado|UNIMED SEGUROS" },
    // filed under another category: someone else's Unimed, not this bill
    { id: "other", date: "2026-09-02", type: "expense", amount: 520_00, accountId: acc, categoryId: other, description: "UNIMED" }
  );
  linkObligationPayments(l, TODAY);
  assert.equal(l.transactions.find((x) => x.id === "aug")?.obligationId, "unimed");
  assert.equal(l.transactions.find((x) => x.id === "other")?.obligationId, undefined);
  // and it now knows what its payment looks like, so November's links itself
  l.transactions.push({ id: "nov", date: "2026-11-19", type: "expense", amount: 520_00, accountId: acc, categoryId: health, description: "Pagamento efetuado|UNIMED SEGUROS" });
  assert.equal(linkObligationPayments(l, "2026-11-25"), 1);
  assert.equal(settlementFor(unimed, "2026-11-20")?.transactionId, "nov");
});

test("with no amount known, a bill only takes look-alike payments in its own category", () => {
  const l = ledgerWith(obligation({ id: "gym", name: "Academia" }));
  l.transactions.push({ id: "x", date: "2026-09-02", type: "expense", amount: 99_00, accountId: l.accounts[0].id, description: "ACADEMIA SMART" });
  linkObligationPayments(l, TODAY);
  assert.equal(l.transactions[0].obligationId, undefined);
});
