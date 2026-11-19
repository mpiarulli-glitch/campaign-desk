import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("archiving a client hides them and can be undone", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-client-archive-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const { closeDbForTests } = await import("../src/lib/db");
  const revenue = await import("../src/lib/revenue");
  const archive = await import("../src/lib/active-clients");
  const campaigns = await import("../src/lib/campaigns");
  const snapshot = await import("../src/lib/snapshot");
  const calendar = await import("../src/lib/calendar");
  const route = await import("../src/app/api/revenue/clients/[id]/archive/route");

  t.after(() => closeDbForTests());

  const kept = revenue.createRevClient({ name: "Kept Client", businessModel: "home_service" });
  const gone = revenue.createRevClient({
    name: "Former Client",
    businessModel: "home_service",
    retainer: 1200,
  });
  revenue.updateRevClient(gone.id, { active: false, contactName: "Dana" });
  const campaign = campaigns.createCampaign({
    title: "Spring email",
    clientName: gone.name,
    clientId: gone.id,
    htmlContent: "<p>Hello</p>",
  });
  calendar.createSend({
    clientId: gone.id,
    clientName: gone.name,
    title: "Former send",
    sendDate: "2026-11-02",
  });
  calendar.createSend({
    clientId: kept.id,
    clientName: kept.name,
    title: "Kept send",
    sendDate: "2026-11-03",
  });

  await t.test("active lists omit an archived client and keep the row", () => {
    const hidden = route.applyClientArchive({
      id: gone.id,
      archived: true,
      isAdmin: true,
      actor: "michael",
    });
    assert.equal(hidden.status, 200);
    assert.ok(hidden.body.client?.archived_at);
    assert.equal(hidden.body.client?.archived_by, "michael");

    const names = archive.activeClients(true).map((client) => client.name);
    assert.deepEqual(names, ["Kept Client"]);
    assert.equal(revenue.listRevClients(true).some((client) => client.id === gone.id), false);
    assert.equal(
      revenue.listRevClients(true, { includeArchived: true }).some((client) => client.id === gone.id),
      true
    );
    assert.equal(archive.listArchivedClients().map((client) => client.id).includes(gone.id), true);

    const stored = revenue.getRevClient(gone.id);
    assert.equal(stored?.name, "Former Client");
    assert.equal(stored?.retainer, 1200);
    assert.equal(stored?.active, 0);
    assert.equal(stored?.contact_name, "Dana");
    assert.equal(campaigns.listCampaigns().some((row) => row.id === campaign.id), false);
    assert.equal(campaigns.getCampaignById(campaign.id)?.title, "Spring email");
    assert.deepEqual(
      calendar.listSends("2026-11-01", "2026-11-30").map((row) => row.title),
      ["Kept send"]
    );
    assert.equal(snapshot.listAccounts().some((account) => account.id === gone.id), false);
  });

  await t.test("the archive endpoint refuses a non-admin and a bad body", () => {
    assert.equal(
      route.applyClientArchive({
        id: kept.id,
        archived: true,
        isAdmin: false,
        actor: "guest",
      }).status,
      401
    );
    assert.equal(
      route.applyClientArchive({
        id: kept.id,
        archived: "yes",
        isAdmin: true,
        actor: "michael",
      }).status,
      400
    );
    assert.equal(
      route.applyClientArchive({
        id: "missing",
        archived: true,
        isAdmin: true,
        actor: "michael",
      }).status,
      404
    );
    assert.equal(revenue.getRevClient(kept.id)?.archived_at, null);
  });

  await t.test("unarchive restores the same client to active lists", () => {
    const restored = route.applyClientArchive({
      id: gone.id,
      archived: false,
      isAdmin: true,
      actor: "michael",
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.client?.archived_at, null);
    assert.equal(restored.body.client?.archived_by, "");

    const stored = revenue.getRevClient(gone.id);
    assert.equal(stored?.retainer, 1200);
    assert.equal(stored?.active, 0);
    assert.equal(stored?.contact_name, "Dana");
    assert.equal(
      revenue.listRevClients(true).some((client) => client.id === gone.id),
      true
    );
    assert.equal(archive.activeClients(false).some((client) => client.id === gone.id), false);
    assert.equal(campaigns.listCampaigns().some((row) => row.id === campaign.id), true);
    assert.deepEqual(
      calendar.listSends("2026-11-01", "2026-11-30").map((row) => row.title).sort(),
      ["Former send", "Kept send"]
    );
  });
});
