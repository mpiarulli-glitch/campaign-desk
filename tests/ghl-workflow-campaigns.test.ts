import assert from "node:assert/strict";
import test from "node:test";
import {
  extractWorkflowCampaignRows,
  ghlWorkflowStatsDateParams,
  workflowCampaignStatsFromPayload,
} from "../src/lib/ghl-conversion-analytics";

test("extractWorkflowCampaignRows reads the documented campaigns envelope", () => {
  const rows = extractWorkflowCampaignRows({
    campaigns: [{ id: "1", name: "Welcome" }],
    total: 1,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Welcome");
});

test("extractWorkflowCampaignRows handles nested data.campaigns", () => {
  const rows = extractWorkflowCampaignRows({
    data: { campaigns: [{ id: "2", name: "Nurture" }] },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "2");
});

test("extractWorkflowCampaignRows ignores non-array data objects", () => {
  assert.deepEqual(extractWorkflowCampaignRows({ data: { total: 0 } }), []);
  assert.deepEqual(extractWorkflowCampaignRows(null), []);
});

test("ghlWorkflowStatsDateParams uses local calendar-day bounds, not lifetime", () => {
  assert.deepEqual(ghlWorkflowStatsDateParams(), {});
  assert.deepEqual(ghlWorkflowStatsDateParams(null), {});

  const params = ghlWorkflowStatsDateParams({
    start: "2026-09-02",
    end: "2026-10-02",
  });
  assert.equal(params.startDate, Date.parse("2026-09-02T07:00:00.000Z"));
  assert.equal(params.endDate, Date.parse("2026-10-03T06:59:59.000Z"));
});

test("workflowCampaignStatsFromPayload does not invent lifetime volume from a miss", () => {
  assert.deepEqual(workflowCampaignStatsFromPayload(null), {
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    unsubscribed: 0,
    openRate: 0,
    clickRate: 0,
    statsAvailable: false,
  });
});

test("workflowCampaignStatsFromPayload maps a windowed GHL stats payload", () => {
  const stats = workflowCampaignStatsFromPayload({
    sent: 200,
    delivered: 196,
    opened: 80,
    clicked: 12,
    bounced: 4,
    unsubscribed: 1,
  });
  assert.equal(stats.sent, 200);
  assert.equal(stats.delivered, 196);
  assert.equal(stats.opened, 80);
  assert.equal(stats.clicked, 12);
  assert.equal(stats.openRate, 40.8);
  assert.equal(stats.clickRate, 6.1);
  assert.equal(stats.statsAvailable, true);
});
