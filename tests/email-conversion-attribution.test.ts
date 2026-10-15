import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ATTRIBUTION_DAYS,
  attributeConversionsToJourneys,
  attributeConversionsToSends,
  emailLabelsMatch,
  isAbandonedRecoveryFlowName,
  pickSendForEmailTouch,
  summarizeAbandonedRecovery,
  threadEmailLabel,
} from "../src/lib/email-conversion-attribution";

test("default attribution window is 5 days", () => {
  assert.equal(DEFAULT_ATTRIBUTION_DAYS, 5);
});

test("attributeConversionsToJourneys pairs each conversion with its credited send", () => {
  const journeys = attributeConversionsToJourneys(
    [
      { id: "c1", name: "Blast A", sentOn: "2026-08-01", channel: "campaign" },
      { id: "c2", name: "Blast B", sentOn: "2026-08-10", channel: "campaign" },
    ],
    [
      {
        id: "appt1",
        contactId: "person-1",
        at: "2026-08-12",
        kind: "appointment",
      },
      {
        id: "form1",
        contactId: "person-2",
        at: "2026-08-03",
        kind: "form_fill",
      },
    ]
  );

  assert.equal(journeys.length, 2);
  assert.equal(journeys[0].send.id, "c2");
  assert.equal(journeys[0].event.contactId, "person-1");
  assert.equal(journeys[0].sendOn, "2026-08-10");
  assert.equal(journeys[1].send.id, "c1");
  assert.equal(journeys[1].event.kind, "form_fill");
});

test("attributeConversionsToSends credits the latest prior send inside the window", () => {
  // Window = 5 days.
  // Blast A Aug 1 → through Aug 6
  // Flow   Aug 5 → through Aug 10
  // Blast B Aug 10 → through Aug 15
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
      // Within Blast A's 5-day window.
      { id: "form3", contactId: "w", at: "2026-08-03", kind: "form_fill" },
      // Past Blast A's window (lag 7), inside the flow's window (lag 3).
      { id: "form2", contactId: "z", at: "2026-08-08", kind: "form_fill" },
    ]
  );

  assert.equal(counts.get("c2")?.formFills, 1);
  assert.equal(counts.get("c2")?.appointments, 1);
  assert.equal(counts.get("c1")?.formFills, 1);
  assert.equal(counts.get("f1")?.formFills, 1);
});

test("attributeConversionsToSends ignores conversions outside the window", () => {
  const counts = attributeConversionsToSends(
    [{ id: "c1", name: "Blast A", sentOn: "2026-08-01", channel: "campaign" }],
    [
      // 6 days later — outside a 5-day window.
      { id: "form1", contactId: "x", at: "2026-08-07", kind: "form_fill" },
    ]
  );
  assert.equal(counts.get("c1")?.formFills, 0);
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
        dateAdded: "2026-07-20",
        dateUpdated: "2026-07-21",
      },
    ],
    [{ contactId: "3", at: "2026-08-10" }],
    "2026-08-01",
    "2026-08-31"
  );

  assert.equal(summary.abandoned, 3);
  assert.equal(summary.recovered, 2);
  assert.equal(summary.stillAbandoned, 1);
  assert.equal(summary.recoveredInWindow, 2);
});

test("emailLabelsMatch requires the send subject, not a short shared word", () => {
  assert.equal(
    emailLabelsMatch(
      "What a Bad Gutter Actually Costs",
      "What a Bad Gutter Actually Costs"
    ),
    true
  );
  assert.equal(
    emailLabelsMatch("Re: What a Bad Gutter Actually Costs", "What a Bad Gutter Actually Costs"),
    true
  );
  assert.equal(emailLabelsMatch("Your inspection is booked", "update"), false);
  assert.equal(emailLabelsMatch("", "What a Bad Gutter Actually Costs"), false);
});

test("pickSendForEmailTouch does not credit a same-day blast with a different subject", () => {
  const gutter = {
    id: "gutter",
    name: "September blast",
    subject: "What a Bad Gutter Actually Costs",
    sentOn: "2026-09-23",
    channel: "campaign" as const,
  };
  const eventAt = "2026-09-23";
  const missed = pickSendForEmailTouch(
    [gutter],
    eventAt,
    {
      day: "2026-09-23",
      subject: "Thanks for requesting a gutter inspection",
      text: "We received your form and will call shortly.",
      campaignId: "",
    }
  );
  assert.equal(missed, null);

  const hit = pickSendForEmailTouch(
    [gutter],
    eventAt,
    {
      day: "2026-09-23",
      subject: "What a Bad Gutter Actually Costs",
      text: "",
      campaignId: "",
    }
  );
  assert.equal(hit?.send.id, "gutter");
});

test("attributeConversionsToJourneys keeps a thread email off the wrong campaign", () => {
  const sends = [
    {
      id: "gutter",
      name: "September blast",
      subject: "What a Bad Gutter Actually Costs",
      sentOn: "2026-09-23",
      channel: "campaign" as const,
    },
  ];
  const events = [
    {
      id: "form-gabriel",
      contactId: "gabriel",
      at: "2026-09-23",
      kind: "form_fill" as const,
    },
  ];
  const touches = {
    "form-gabriel": {
      day: "2026-09-23",
      subject: "",
      text: "Here is your onsite visit window for next Tuesday morning.",
      campaignId: "",
    },
  };

  const dated = attributeConversionsToJourneys(sends, events);
  assert.equal(dated.length, 1);
  assert.equal(dated[0].send.id, "gutter");

  const matched = attributeConversionsToJourneys(sends, events, 5, touches);
  assert.equal(matched.length, 0);

  const counts = attributeConversionsToSends(sends, events, 5, touches);
  assert.equal(counts.get("gutter")?.formFills, 0);
});

test("threadEmailLabel prefers the subject and otherwise previews the body", () => {
  assert.equal(
    threadEmailLabel({
      day: "2026-09-23",
      subject: "Thanks for requesting a gutter inspection",
      text: "ignored body",
      campaignId: "",
    }),
    "Thanks for requesting a gutter inspection"
  );
  assert.equal(
    threadEmailLabel({
      day: "2026-09-23",
      subject: "",
      text: "",
      campaignId: "",
    }),
    "Marketing email"
  );
});
