import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A campaign that was never sent to Basecamp has no card to move. Syncing on
// approve/schedule must not invent a failure for that — the failures panel is
// for things that should have happened and did not.

test("campaign card sync", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-card-sync-test-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const campaigns = await import("../src/lib/campaigns");
  const failures = await import("../src/lib/failures");
  const sync = await import("../src/lib/campaign-card-sync");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await t.test("no linked card is a silent skip, not a failure", async () => {
    const campaign = campaigns.createCampaign({
      title: "April newsletter",
      htmlContent: "<p>Hello</p>",
    });
    await sync.syncCampaignDeliverablesCard(campaign.id, "approved");
    await sync.syncCampaignDeliverablesCard(campaign.id, "scheduled");
    assert.equal(failures.openFailureCount(), 0);
  });

  await t.test("clearing the stored due date does not drop the linked card", () => {
    const campaign = campaigns.createCampaign({
      title: "May newsletter",
      htmlContent: "<p>Hello</p>",
    });
    campaigns.recordBasecampApproval(campaign.id, {
      cardId: "card-1",
      cardUrl: "https://3.basecamp.com/example/cards/1",
      revision: "v1",
      dueOn: "2026-09-10",
    });
    campaigns.clearCampaignBasecampDueOn(campaign.id);
    const fresh = campaigns.getCampaignById(campaign.id)!;
    assert.equal(fresh.basecamp_due_on, null);
    assert.equal(fresh.basecamp_card_id, "card-1");
  });
});
