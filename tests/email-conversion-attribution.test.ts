import assert from "node:assert/strict";
import test from "node:test";
import {
  attributeConversionsToSends,
  isAbandonedRecoveryFlowName,
  summarizeAbandonedRecovery,
} from "../src/lib/email-conversion-attribution";

test("attributeConversionsToSends credits the latest prior send inside the window", () => {
  const counts = attributeConversionsToSends(
    [
      { id: "c1", name: "Blast A", sentOn: "2026-08-01", channel: "campaign" },
      { id: "c2", name: "Blast B", sentOn: "2026-08-10", channel: "campaign" },
      {
        id: "f1",
        name: "Abandoned booking recovery",
        sentOn: "2026-08-05",
        channel: "flow",
      },
    ],
    [
      { id: "form1", contactId: "x", at: "2026-08-11", kind: "form_fill" },
      { id: "appt1", contactId: "y", at: "2026-08-12", kind: "appointment" },
      { id: "form2", contactId: "z", at: "2026-08-03", kind: "form_fill" },
    ],
    14
  );

  assert.equal(counts.get("c2")?.formFills, 1);
  assert.equal(counts.get("c2")?.appointments, 1);
  assert.equal(counts.get("c1")?.formFills, 1);
  assert.equal(counts.get("f1")?.formFills, 0);
});

test("isAbandonedRecoveryFlowName catches recovery automations", () => {
  assert.equal(isAbandonedRecoveryFlowName("Abandoned Booking SMS"), true);
  assert.equal(isAbandonedRecoveryFlowName("Booking Recovery Email"), true);
  assert.equal(isAbandonedRecoveryFlowName("Welcome series"), false);
});

test("summarizeAbandonedRecovery counts recovered and still-open abandoners", () => {
  const summary = summarizeAbandonedRecovery(
    [
      {
        id: "1",
        tags: ["abandoned booking", "meeting booked"],
        dateAdded: "2026-07-01",
        dateUpdated: "2026-08-15",
      },
      {
        id: "2",
        tags: ["abandoned booking"],
        dateAdded: "2026-08-01",
        dateUpdated: "2026-08-02",
      },
      {
        id: "3",
        tags: ["abandoned booking"],
        dateAdded: "2026-08-01",
        dateUpdated: "2026-08-03",
      },
    ],
    [{ contactId: "3", at: "2026-08-20" }],
    "2026-08-01",
    "2026-08-31"
  );

  assert.equal(summary.abandoned, 3);
  assert.equal(summary.recovered, 2); // tagged booked + appointment
  assert.equal(summary.stillAbandoned, 1);
  assert.equal(summary.recoveredInWindow, 2);
  assert.ok(summary.recoveryRate > 0);
});
