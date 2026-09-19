import assert from "node:assert/strict";
import test from "node:test";
import {
  extractWorkflowCampaignRows,
  preferWorkflowEmailCampaign,
  type WorkflowEmailCampaign,
} from "../src/lib/ghl-conversion-analytics";

function flow(
  partial: Partial<WorkflowEmailCampaign> & Pick<WorkflowEmailCampaign, "id" | "name">
): WorkflowEmailCampaign {
  return {
    status: "published",
    sourceId: partial.id,
    sentOn: null,
    sent: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    unsubscribed: 0,
    openRate: 0,
    clickRate: 0,
    statsAvailable: false,
    abandonedRecovery: false,
    ...partial,
  };
}

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

test("preferWorkflowEmailCampaign keeps the row with real automation stats", () => {
  const draftEm = flow({
    id: "wf-1",
    name: "Welcome (draft EM)",
    status: "draft",
    sent: 0,
    statsAvailable: false,
  });
  const automation = flow({
    id: "wf-1",
    name: "Welcome series",
    sent: 420,
    delivered: 400,
    opened: 88,
    clicked: 12,
    statsAvailable: true,
  });
  const preferred = preferWorkflowEmailCampaign(draftEm, automation);
  assert.equal(preferred.name, "Welcome series");
  assert.equal(preferred.sent, 420);
  assert.equal(preferred.statsAvailable, true);
});

test("preferWorkflowEmailCampaign keeps EM when it already has stronger stats", () => {
  const em = flow({
    id: "wf-2",
    name: "Cart recovery",
    sent: 900,
    opened: 200,
    statsAvailable: true,
  });
  const automation = flow({
    id: "wf-2",
    name: "Cart recovery",
    sent: 10,
    opened: 1,
    statsAvailable: true,
  });
  assert.equal(preferWorkflowEmailCampaign(em, automation).sent, 900);
});