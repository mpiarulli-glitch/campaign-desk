import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("campaign follow-up count increments each time", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-followup-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const campaigns = await import("../src/lib/campaigns");
  const campaign = campaigns.createCampaign({
    title: "Welcome series",
    htmlContent: "<p>Hi</p>",
  });
  assert.equal(campaign.basecamp_followup_count || 0, 0);
  assert.equal(campaign.basecamp_followup_last_at, null);

  const once = campaigns.recordBasecampFollowUp(campaign.id);
  assert.equal(once?.basecamp_followup_count, 1);
  assert.ok(once?.basecamp_followup_last_at);

  const twice = campaigns.recordBasecampFollowUp(campaign.id);
  assert.equal(twice?.basecamp_followup_count, 2);
  assert.ok(twice?.basecamp_followup_last_at);
  assert.ok(
    (twice?.basecamp_followup_last_at || "") >= (once?.basecamp_followup_last_at || "")
  );
});
