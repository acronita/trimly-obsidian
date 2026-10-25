import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultLedger,
  dueObligations,
  nextDue,
  obligationReminders,
  openOccurrences,
  parseLedger,
  paymentCandidates,
  settleObligation,
  unsettleObligation,
} from "../src/ledger.ts";
import type { Ledger, Obligation } from "../src/ledger.ts";

const TODAY = "2026-10-25";

function obligation(extra: Partial<Obligation> = {}): Obligation {
  return { id: "light", name: "Conta de luz", kind: "payment", frequency: "monthly", startDate: "2026-08-10", remindDays: 3, settled: [], ...extra };
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
  o.startDate = "2026-08-15";
  assert.deepEqual(openOccurrences(o, "2026-08-31"), []);
});

test("marking the same month twice keeps a single mark", () => {
  const o = obligation();
  settleObligation(o, { due: "2026-10-10", status: "skipped", date: "2026-10-10" });
  settleObligation(o, { due: "2026-10-10", status: "done", date: "2026-10-11", transactionId: "tx" });
  assert.equal(o.settled.length, 1);
  assert.equal(o.settled[0].status, "done");
});

test("yearly obligations come due once a year, and end dates stop them", () => {
  const irpf = obligation({ id: "irpf", name: "Declaração IRPF", kind: "document", frequency: "yearly", startDate: "2025-05-29" });
  assert.deepEqual(openOccurrences(irpf, TODAY), ["2025-05-29", "2026-05-29"]);
  assert.equal(nextDue(irpf, TODAY), "2027-05-29");
  irpf.endDate = "2026-12-31";
  assert.equal(nextDue(irpf, TODAY), undefined);
});

test("reminders start remindDays before the due date and keep going while overdue", () => {
  const das = obligation({ id: "das", name: "DAS MEI", startDate: "2026-10-20", remindDays: 3 });
  const internet = obligation({ id: "net", name: "Internet", startDate: "2026-10-28", remindDays: 3 });
  const phone = obligation({ id: "phone", name: "Telefone", startDate: "2026-10-29", remindDays: 3 });
  const l = ledgerWith(das, internet, phone);
  assert.deepEqual(
    obligationReminders(l, TODAY).map((d) => d.obligation.id),
    ["das", "net"] // overdue, due in 3 days; the phone bill in 4 days is not yet
  );
  settleObligation(das, { due: "2026-10-20", status: "done", date: TODAY });
  assert.deepEqual(obligationReminders(l, TODAY).map((d) => d.obligation.id), ["net"]);
  assert.deepEqual(dueObligations(l, "2026-10-31").map((d) => d.obligation.id), ["net", "phone"]);
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

test("obligations survive saving and reopening the ledger", () => {
  const l = ledgerWith(obligation({ settled: [{ due: "2026-08-10", status: "done", date: "2026-08-09" }] }));
  assert.deepEqual(parseLedger(JSON.stringify(l)).obligations, l.obligations);
  // ledgers from before obligations existed load with none
  assert.deepEqual(parseLedger(JSON.stringify({ version: 3, accounts: [] })).obligations, []);
});
