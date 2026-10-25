import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultLedger,
  dueObligations,
  nextDue,
  obligationReminders,
  openOccurrences,
  paidOn,
  parseLedger,
  paymentCandidates,
  settleObligation,
  unsettleObligation,
  windowStart,
} from "../src/ledger.ts";
import { businessDayFrom, isBusinessDay } from "../src/business-days.ts";
import type { Ledger, Obligation } from "../src/ledger.ts";

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

test("a bill created after this month's due day starts next month, not as overdue", () => {
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
