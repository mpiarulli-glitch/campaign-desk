import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("resolveCampaignClient prefers and heals Basecamp-linked twin", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-resolve-client-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const revenue = await import("../src/lib/revenue");
  const campaigns = await import("../src/lib/campaigns");
  const { resolveCampaignClient } = await import("../src/lib/campaign-card-sync");

  const stub = revenue.createRevClient({
    name: "Our Watch",
    businessModel: "home_service",
  });
  const real = revenue.createRevClient({
    name: "Our Watch",
    businessModel: "ecomm",
  });
  revenue.updateRevClient(real.id, { basecampProjectId: "12345678" });

  const campaign = campaigns.createCampaign({
    title: "Welcome Series V2",
    clientName: "Our Watch",
    clientId: stub.id,
    htmlContent: "<p>Hi</p>",
  });

  const resolved = resolveCampaignClient(campaign);
  assert.ok(resolved);
  assert.equal(resolved!.id, stub.id);
  assert.equal(resolved!.basecamp_project_id, "12345678");

  const healed = revenue.getRevClient(stub.id);
  assert.equal(healed?.basecamp_project_id, "12345678");
});

test("resolveCampaignClient name-match prefers account with Basecamp project", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-resolve-name-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // Fresh process modules so getDb() binds to this temp cwd.
  const suffix = String(Date.now());
  const name = `Name Match Client ${suffix}`;

  const revenue = await import("../src/lib/revenue");
  const campaigns = await import("../src/lib/campaigns");
  const { resolveCampaignClient } = await import("../src/lib/campaign-card-sync");

  revenue.createRevClient({
    name,
    businessModel: "home_service",
  });
  const withProject = revenue.createRevClient({
    name,
    businessModel: "ecomm",
  });
  revenue.updateRevClient(withProject.id, { basecampProjectId: "999" });

  const campaign = campaigns.createCampaign({
    title: "Another package",
    clientName: name,
    htmlContent: "<p>Hi</p>",
  });

  const resolved = resolveCampaignClient(campaign);
  assert.equal(resolved?.basecamp_project_id, "999");
  assert.equal(resolved?.id, withProject.id);
});
