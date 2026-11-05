import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultLedger, goalProgress, parseLedger, removeGoal, saveGoal } from "../src/ledger.ts";
import type { Asset, Ledger, SavingsGoal } from "../src/ledger.ts";

const TODAY = "2026-11-05";

function position(extra: Partial<Asset> = {}): Asset {
  return { id: "cdb", name: "CDB", assetClass: "fixed_income", value: 300_00, updatedAt: TODAY, ...extra };
}

/** One savings account holding `balance` and one position. */
function setup(balance = 400_00): Ledger {
  const l = defaultLedger();
  l.accounts = [{ id: "acc", name: "Poupança", type: "savings", openingBalance: balance }];
  l.investments.assets = [position()];
  return l;
}

function goal(extra: Partial<SavingsGoal> = {}): SavingsGoal {
  return { id: "trip", name: "Viagem", target: 1000_00, date: "2027-03-15", accountId: "acc", ...extra };
}

test("what to save per month spreads the rest over the months until the date, rounded up so the goal is reached", () => {
  const p = goalProgress(setup(), goal({ target: 1000_01 }), TODAY);
  assert.equal(p.saved, 400_00);
  assert.equal(p.left, 600_01);
  // November to March: 4 months
  assert.equal(p.monthly, 150_01);
  assert.equal(p.status, "active");
});

test("a goal due this month still asks for the whole rest, not a division by zero", () => {
  const p = goalProgress(setup(), goal({ date: "2026-11-30" }), TODAY);
  assert.equal(p.monthly, 600_00);
  assert.equal(p.status, "active");
});

test("progress follows the linked position's current value", () => {
  const p = goalProgress(setup(), goal({ accountId: undefined, assetId: "cdb" }), TODAY);
  assert.equal(p.saved, 300_00);
  assert.equal(p.linked, true);
});

test("a goal in the base currency counts a foreign account at the day's rate", () => {
  const l = setup(100_00);
  l.accounts[0].currency = "USD";
  l.fx = { base: "BRL", date: TODAY, rates: { USD: 0.2 } };
  assert.equal(goalProgress(l, goal(), TODAY).saved, 500_00);
});

test("reaching the target is done, even past the date, and asks for nothing more", () => {
  const p = goalProgress(setup(1200_00), goal({ date: "2026-01-01" }), TODAY);
  assert.equal(p.status, "done");
  assert.equal(p.left, 0);
  assert.equal(p.monthly, 0);
});

test("a date gone by without reaching the target is late, with no monthly amount left to plan", () => {
  const p = goalProgress(setup(), goal({ date: "2026-11-04" }), TODAY);
  assert.equal(p.status, "late");
  assert.equal(p.left, 600_00);
  assert.equal(p.monthly, 0);
});

test("an overdrawn account counts as nothing saved, not as negative progress", () => {
  const p = goalProgress(setup(-50_00), goal(), TODAY);
  assert.equal(p.saved, 0);
  assert.equal(p.left, 1000_00);
});

test("a deleted account or a closed position leaves the goal unlinked with nothing saved", () => {
  const l = setup();
  l.investments.assets[0].closed = true;
  for (const g of [goal({ accountId: "gone" }), goal({ accountId: undefined, assetId: "cdb" })]) {
    const p = goalProgress(l, g, TODAY);
    assert.equal(p.linked, false);
    assert.equal(p.saved, 0);
  }
});

test("two goals on the same account are flagged, since each counts the whole balance", () => {
  const l = setup();
  const trip = goal();
  const other = goal({ id: "reserve", name: "Reserva" });
  const elsewhere = goal({ id: "car", name: "Carro", accountId: undefined, assetId: "cdb" });
  saveGoal(l, trip);
  saveGoal(l, other);
  saveGoal(l, elsewhere);
  assert.equal(goalProgress(l, trip, TODAY).shared, true);
  assert.equal(goalProgress(l, other, TODAY).shared, true);
  assert.equal(goalProgress(l, elsewhere, TODAY).shared, false);
});

test("saving edits a goal in place, removing the last one clears the field, and goals survive a reload", () => {
  const l = setup();
  saveGoal(l, goal());
  saveGoal(l, goal({ target: 2000_00 }));
  assert.equal(l.goals?.length, 1);
  assert.equal(l.goals?.[0].target, 2000_00);
  assert.deepEqual(parseLedger(JSON.stringify(l)).goals, l.goals);
  removeGoal(l, "trip");
  assert.equal(l.goals, undefined);
});

test("a ledger from before goals loads without any", () => {
  assert.equal(parseLedger(JSON.stringify(defaultLedger())).goals, undefined);
});
