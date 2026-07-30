import assert from "node:assert/strict";
import test from "node:test";
import { isSubscriptionDead, seatHealth } from "../src/lib/skylead";

/**
 * Fixtures are the real shape of the account as of 2026-07-29: 14 seats, three
 * of them on a dead subscription, five faulted in ways somebody can actually
 * fix. Status ids come from GET /enums/account-global-statuses.
 */
const SEATS = [
  { name: "healthy 1", accountGlobalStatusId: 5, connectionStatusId: 1, isInJail: false },
  { name: "healthy 2", accountGlobalStatusId: 5, connectionStatusId: 1, isInJail: false },
  { name: "healthy 3", accountGlobalStatusId: 5, connectionStatusId: 1, isInJail: false },
  { name: "healthy 4", accountGlobalStatusId: 5, connectionStatusId: 1, isInJail: false },
  { name: "healthy 5", accountGlobalStatusId: 5, connectionStatusId: 1, isInJail: false },
  { name: "healthy 6", accountGlobalStatusId: 5, connectionStatusId: 1, isInJail: false },
  { name: "Luis Romero", accountGlobalStatusId: 11, connectionStatusId: 1, isInJail: false },
  { name: "Jaycob Forrest", accountGlobalStatusId: 11, connectionStatusId: 1, isInJail: false },
  { name: "Silvano Rosas", accountGlobalStatusId: 11, connectionStatusId: 1, isInJail: false },
  { name: "Kyle Onstott", accountGlobalStatusId: 5, connectionStatusId: 5, isInJail: false },
  { name: "Sophia Buturoaga", accountGlobalStatusId: 5, connectionStatusId: 5, isInJail: false },
  { name: "Tommy Walker", accountGlobalStatusId: 23, connectionStatusId: 1, isInJail: false },
  { name: "Rick Ramirez", accountGlobalStatusId: 9, connectionStatusId: 5, isInJail: false },
  { name: "Sylvia Artiga", accountGlobalStatusId: 3, connectionStatusId: 1, isInJail: false },
];

test("only billing-dead seats are treated as cancelled", () => {
  const hidden = SEATS.filter(isSubscriptionDead).map((s) => s.name);
  assert.deepEqual(hidden, ["Luis Romero", "Jaycob Forrest", "Silvano Rosas"]);
});

test("payment required and cancelled hide alongside invalid subscription", () => {
  for (const id of [7, 8, 11]) {
    assert.equal(isSubscriptionDead({ accountGlobalStatusId: id }), true, `status ${id}`);
  }
});

test("fixable faults stay visible so somebody can act on them", () => {
  const kept = SEATS.filter((s) => !isSubscriptionDead(s));
  assert.equal(kept.length, 11);

  // A seat needing a PIN, stuck behind LinkedIn restrictions, or erroring on
  // its connection is work, not a dead line. It must survive the filter.
  const stillBroken = kept.filter((s) => !seatHealth(s).healthy).map((s) => s.name);
  assert.deepEqual(stillBroken, [
    "Kyle Onstott",
    "Sophia Buturoaga",
    "Tommy Walker",
    "Rick Ramirez",
    "Sylvia Artiga",
  ]);
});

test("the array reads 6 of 11 once cancelled seats are dropped", () => {
  const kept = SEATS.filter((s) => !isSubscriptionDead(s));
  const live = kept.filter((s) => seatHealth(s).healthy).length;
  assert.equal(`${live} / ${kept.length}`, "6 / 11");
});

test("a seat in LinkedIn jail is unhealthy whatever its status says", () => {
  const jailed = { accountGlobalStatusId: 5, connectionStatusId: 1, isInJail: true };
  assert.equal(seatHealth(jailed).healthy, false);
  assert.equal(seatHealth(jailed).statusLabel, "In LinkedIn jail");
  // Jail is not a billing problem, so it must not be filtered away.
  assert.equal(isSubscriptionDead(jailed), false);
});
