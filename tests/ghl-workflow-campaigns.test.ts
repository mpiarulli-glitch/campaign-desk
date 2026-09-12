import assert from "node:assert/strict";
import test from "node:test";
import { extractWorkflowCampaignRows } from "../src/lib/ghl-conversion-analytics";

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
