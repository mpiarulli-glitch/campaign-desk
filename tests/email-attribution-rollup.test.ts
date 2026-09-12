import assert from "node:assert/strict";
import test from "node:test";
import {
  partitionAttributionRows,
  sortAttributionWins,
  type AttributionRollupRow,
} from "../src/lib/email-attribution-rollup";

function row(
  partial: Partial<AttributionRollupRow> &
    Pick<AttributionRollupRow, "clientId" | "clientName">
): AttributionRollupRow {
  return {
    locationId: "loc",
    attributedAppointments: 0,
    attributedFormFills: 0,
    totalAppointments: 0,
    totalFormFills: 0,
    campaignSends: 0,
    flowSends: 0,
    error: null,
    ...partial,
  };
}

test("sortAttributionWins ranks bookings before forms", () => {
  const a = row({ clientId: "a", clientName: "Alpha", attributedFormFills: 9 });
  const b = row({
    clientId: "b",
    clientName: "Beta",
    attributedAppointments: 1,
  });
  assert.ok(sortAttributionWins(b, a) < 0);
});

test("partitionAttributionRows keeps only credited accounts in wins", () => {
  const rows = [
    row({ clientId: "z", clientName: "Zed" }),
    row({
      clientId: "a",
      clientName: "Acme",
      attributedAppointments: 2,
      attributedFormFills: 1,
    }),
    row({
      clientId: "b",
      clientName: "Beacon",
      attributedFormFills: 4,
    }),
    row({ clientId: "c", clientName: "Cedar", error: "token expired" }),
  ];
  const { wins, others } = partitionAttributionRows(rows);
  assert.deepEqual(
    wins.map((w) => w.clientId),
    ["a", "b"]
  );
  assert.deepEqual(
    others.map((o) => o.clientId),
    ["c", "z"]
  );
});
