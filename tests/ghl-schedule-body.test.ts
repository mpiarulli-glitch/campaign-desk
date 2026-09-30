import assert from "node:assert/strict";
import test from "node:test";
import { buildGhlScheduleBody } from "../src/lib/ghl-tools";

test("schedule body targets all contacts at the saved instant", () => {
  const body = buildGhlScheduleBody({
    locationId: "loc",
    templateId: "tpl",
    name: "October - Email 1",
    subject: "Two ways to taste fall",
    fromName: "Krak Boba",
    scheduledAt: "2026-10-02T16:00:00.000Z",
    audience: { type: "all" },
  });
  assert.equal(body.status, "schedule_later");
  assert.equal(body.templateId, "tpl");
  assert.equal(body.scheduledAt, "2026-10-02T16:00:00.000Z");
  assert.deepEqual(body.audiences, [
    { id: "all", name: "All Contacts", type: "all" },
  ]);
});

test("schedule body sends a tag segment", () => {
  const body = buildGhlScheduleBody({
    locationId: "loc",
    templateId: "tpl",
    name: "October - Email 1",
    subject: "Two ways to taste fall",
    fromName: "Krak Boba",
    scheduledAt: "2026-10-02T16:00:00.000Z",
    audience: { type: "tags", tags: ["vip", "oceanside"] },
  });
  assert.deepEqual(body.audiences, [
    {
      id: "tags_vip_oceanside",
      name: "Tags: vip, oceanside",
      type: "tags",
      tagIds: ["vip", "oceanside"],
    },
  ]);
});
