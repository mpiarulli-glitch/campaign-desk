import assert from "node:assert/strict";
import test from "node:test";
import { matchEmailsToGhlSchedules } from "../src/lib/campaign-ghl-schedule";

test("GHL scheduled blasts match package emails by title or subject", () => {
  const emails = [
    {
      id: "e1",
      title: "01. Imagine Your Finished Yard | Ecoworkz",
      subjects: ["Imagine your finished yard"],
    },
    {
      id: "e2",
      title: "02. Plan Your Project | Ecoworkz",
      subjects: [],
    },
  ];
  const schedules = [
    {
      id: "g2",
      name: "Plan Your Project",
      subject: "Let's plan it",
      status: "scheduled",
      scheduledAt: "2026-09-18T16:00:00.000Z",
    },
    {
      id: "g1",
      name: "Imagine Your Finished Yard",
      subject: "Imagine your finished yard",
      status: "scheduled",
      scheduledAt: "2026-09-09T16:00:00.000Z",
    },
    {
      id: "g3",
      name: "Unrelated blast",
      subject: "Hello",
      status: "scheduled",
      scheduledAt: "2026-09-20T16:00:00.000Z",
    },
  ];

  const matched = matchEmailsToGhlSchedules(emails, schedules);
  assert.equal(matched[0].schedule?.id, "g1");
  assert.equal(matched[1].schedule?.id, "g2");
  assert.equal(matched.filter((row) => row.schedule).length, 2);
});
