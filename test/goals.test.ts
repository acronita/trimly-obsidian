import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultLedger, goalProgress, parseLedger, removeGoal, saveGoal } from "../src/ledger.ts";
import type { Asset, Ledger, SavingsGoal } from "../src/ledger.ts";

const TODAY = "2026-11-05";

function position(extra: Partial<Asset> = {}): Asset {
  return { id: "cdb", name: "CDB", assetClass: "fixed_income", value: 300_00, updatedAt: TODAY, ...extra };
}

/** One savings account holding `balance`, another with 100, and one position. */
function setup(balance = 400_00): Ledger {
  const l = defaultLedger();
  l.accounts = [
    { id: "acc", name: "Poupança", type: "savings", openingBalance: balance },
    { id: "other", name: "Corrente", type: "checking", openingBalance: 100_00 },
  ];
  l.investments.assets = [position()];
  return l;
}

function goal(extra: Partial<SavingsGoal> = {}): SavingsGoal {
  return { id: "trip", name: "Viagem", target: 1000_00, date: "2027-03-15", accountIds: ["acc"], assetIds: [], ...extra };
}

test("what to save per month spreads the rest over the months until the date, rounded up so the goal is reached", () => {
  const p = goalProgress(setup(), goal({ target: 1000_01 }), TODAY);
  assert.equal(p.saved, 400_00);
  assert.equal(p.left, 600_01);
  // November to March: 4 months
  assert.equal(p.monthly, 150_01);
  assert.equal(p.status, "active");
});

test("a goal kept in several places counts all of them together", () => {
  const p = goalProgress(setup(), goal({ accountIds: ["acc", "other"], assetIds: ["cdb"] }), TODAY);
  assert.equal(p.saved, 800_00);
  assert.equal(p.linked, true);
});

test("a goal due this month still asks for the whole rest, not a division by zero", () => {
  const p = goalProgress(setup(), goal({ date: "2026-11-30" }), TODAY);
  assert.equal(p.monthly, 600_00);
  assert.equal(p.status, "active");
});

test("progress follows a position's current value", () => {
  const p = goalProgress(setup(), goal({ accountIds: [], assetIds: ["cdb"] }), TODAY);
  assert.equal(p.saved, 300_00);
});

test("a goal in the base currency counts a foreign account at the day's rate", () => {
  const l = setup(100_00);
  l.accounts[0].currency = "USD";
  l.fx = { base: "BRL", date: TODAY, rates: { USD: 0.2 } };
  assert.equal(goalProgress(l, goal(), TODAY).saved, 500_00);
});

test("reaching the target is done and asks for nothing more", () => {
  const p = goalProgress(setup(1200_00), goal({ date: "2026-01-01" }), TODAY);
  assert.equal(p.status, "done");
  assert.equal(p.left, 0);
  assert.equal(p.monthly, 0);
});

test("a goal with no date is a level to keep: only how far from it, never a monthly amount", () => {
  const { date: _date, ...undated } = goal();
  const below = goalProgress(setup(), undated, TODAY);
  assert.equal(below.status, "below");
  assert.equal(below.left, 600_00);
  assert.equal(below.monthly, 0);
  assert.equal(goalProgress(setup(1000_00), undated, TODAY).status, "done");
});

test("after its date a goal becomes a level to keep, not something overdue", () => {
  const p = goalProgress(setup(), goal({ date: "2026-11-04" }), TODAY);
  assert.equal(p.status, "below");
  assert.equal(p.left, 600_00);
  assert.equal(p.monthly, 0);
});

test("spending from a reserve that had reached its goal shows what is missing again", () => {
  const { date: _date, ...undated } = goal();
  const l = setup(1000_00);
  assert.equal(goalProgress(l, undated, TODAY).status, "done");
  l.transactions = [{ id: "e", date: TODAY, type: "expense", amount: 200_00, accountId: "acc", description: "Emergência" }];
  assert.equal(goalProgress(l, undated, TODAY).left, 200_00);
});

test("an overdrawn account adds nothing, and doesn't eat what the others hold", () => {
  const p = goalProgress(setup(-50_00), goal({ accountIds: ["acc", "other"] }), TODAY);
  assert.equal(p.saved, 100_00);
});

test("a deleted account or a closed position is flagged, and what remains still counts", () => {
  const l = setup();
  l.investments.assets[0].closed = true;
  const p = goalProgress(l, goal({ accountIds: ["acc", "gone"], assetIds: ["cdb"] }), TODAY);
  assert.equal(p.linked, false);
  assert.equal(p.saved, 400_00);
});

test("goals sharing any account or position are flagged, since each counts the whole balance", () => {
  const l = setup();
  const trip = goal({ accountIds: ["acc", "other"] });
  const other = goal({ id: "reserve", name: "Reserva", accountIds: ["other"] });
  const elsewhere = goal({ id: "car", name: "Carro", accountIds: [], assetIds: ["cdb"] });
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

test("a goal saved with one account or position opens as a list of one", () => {
  const raw = { ...defaultLedger(), goals: [{ id: "a", name: "A", target: 1, date: TODAY, accountId: "acc" }, { id: "b", name: "B", target: 1, date: TODAY, assetId: "cdb" }] };
  const goals = parseLedger(JSON.stringify(raw)).goals ?? [];
  assert.deepEqual([goals[0].accountIds, goals[0].assetIds], [["acc"], []]);
  assert.deepEqual([goals[1].accountIds, goals[1].assetIds], [[], ["cdb"]]);
  assert.ok(!("accountId" in goals[0]));
});

test("a ledger from before goals loads without any", () => {
  assert.equal(parseLedger(JSON.stringify(defaultLedger())).goals, undefined);
});
