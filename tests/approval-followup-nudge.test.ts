import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("approval follow-up activity appears after two days", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-approval-nudge-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const campaigns = await import("../src/lib/campaigns");
  const { getDb } = await import("../src/lib/db");
  const nudge = await import("../src/lib/approval-followup-nudge");
  const copy = await import("../src/lib/activity-copy");

  const internal = campaigns.createCampaign({
    title: "Internal package",
    clientName: "Acme",
    htmlContent: "<p>Hi</p>",
  });
  campaigns.updateCampaign(internal.id, { status: "internal_review" });
  getDb()
    .prepare(
      `UPDATE campaigns SET internal_review_sent_at = ?, updated_at = ? WHERE id = ?`
    )
    .run("2026-09-10T16:00:00.000Z", "2026-09-10T16:00:00.000Z", internal.id);

  const external = campaigns.createCampaign({
    title: "Client package",
    clientName: "Beta Co",
    htmlContent: "<p>Hi</p>",
  });
  campaigns.updateCampaign(external.id, { status: "in_review" });
  getDb()
    .prepare(
      `UPDATE campaigns SET basecamp_approval_sent_at = ?, updated_at = ? WHERE id = ?`
    )
    .run("2026-09-12T16:00:00.000Z", "2026-09-12T16:00:00.000Z", external.id);

  const fresh = campaigns.createCampaign({
    title: "Just sent",
    clientName: "Gamma",
    htmlContent: "<p>Hi</p>",
  });
  campaigns.updateCampaign(fresh.id, { status: "in_review" });
  getDb()
    .prepare(
      `UPDATE campaigns SET basecamp_approval_sent_at = ?, updated_at = ? WHERE id = ?`
    )
    .run("2026-09-15T16:00:00.000Z", "2026-09-15T16:00:00.000Z", fresh.id);

  const asOf = "2026-09-16T16:00:00.000Z";
  const due = nudge.listDueApprovalFollowups(asOf);
  assert.deepEqual(
    due.map((row) => [row.kind, row.clientName, row.waitingDays]),
    [
      ["internal", "Acme", 6],
      ["external", "Beta Co", 4],
    ]
  );

  const items = nudge.listApprovalFollowupActivity(asOf);
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, "followup");
  assert.equal(items[0].id, `${internal.id}:2026-09-16`);
  assert.equal(items[1].id, `${external.id}:2026-09-16`);
  const line = copy.followupActivityParts(items[0]);
  assert.equal(line.actor, "Follow up");
  assert.match(line.rest, /Acme/);
  assert.match(line.rest, /internal review/);
  assert.match(line.rest, /6 days/);

  const merged = nudge.mergeActivityWithFollowups([], asOf, null, 10);
  assert.equal(merged[0].kind, "followup");
});
