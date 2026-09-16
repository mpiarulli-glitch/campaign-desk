import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyLifecycleTouch,
  fromEmailOrFlow,
  summarizeAbandons,
  type AppointmentEvent,
} from "../src/lib/ghl-outcome-math";

test("classifyLifecycleTouch prefers flow over generic email", () => {
  assert.equal(
    classifyLifecycleTouch({ sessionSource: "Email Marketing", utmMedium: "email marketing" }),
    "campaign"
  );
  assert.equal(
    classifyLifecycleTouch({ sessionSource: "workflow", utmSource: "email" }),
    "flow"
  );
  assert.equal(
    classifyLifecycleTouch({ eventData: { source: "Direct traffic", medium: "form" } }),
    "other"
  );
  assert.equal(classifyLifecycleTouch({ createdBy: { source: "automation" } }), "flow");
});

test("summarizeAbandons counts a later booked slot as recovered", () => {
  const events: AppointmentEvent[] = [
    {
      id: "a1",
      contactId: "c1",
      startMs: 1,
      addedMs: 1,
      status: "cancelled",
      source: null,
      createdBy: null,
      raw: {},
    },
    {
      id: "a2",
      contactId: "c1",
      startMs: 5,
      addedMs: 4,
      status: "confirmed",
      source: null,
      createdBy: null,
      raw: {},
    },
    {
      id: "a3",
      contactId: "c2",
      startMs: 2,
      addedMs: 2,
      status: "noshow",
      source: null,
      createdBy: null,
      raw: {},
    },
  ];
  const summary = summarizeAbandons(events);
  assert.equal(summary.abandoned, 2);
  assert.equal(summary.recovered, 1);
  assert.equal(summary.recoveryRate, 50);
});

test("fromEmailOrFlow sums campaign and flow only", () => {
  assert.equal(
    fromEmailOrFlow({
      total: 10,
      fromCampaign: 3,
      fromFlow: 2,
      fromOther: 4,
      unknown: 1,
    }),
    5
  );
});
