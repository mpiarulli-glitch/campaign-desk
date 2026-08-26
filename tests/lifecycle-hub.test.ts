import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("adding a client to the hub requires a launch date and platform", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-hub-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const hub = await import("../src/lib/lifecycle-hub");
  const { getDb, nowIso } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO rev_clients (id, name, active, monthly_email_quota, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?)`
    )
    .run("cl_hub", "Northline", 4, now, now);

  assert.deepEqual(hub.addClientToHub("cl_hub", "2026-08-26", "michael"), {
    ok: false,
    error: "Pick a platform.",
  });
  assert.deepEqual(hub.addClientToHub("cl_hub", "2026-08-26", "michael", undefined, null), {
    ok: false,
    error: "Pick a platform.",
  });

  const added = hub.addClientToHub("cl_hub", "2026-08-26", "michael", undefined, "klaviyo");
  assert.deepEqual(added, { ok: true });

  const snapshot = hub.buildLifecycleHub();
  const client = snapshot.clients.find((c) => c.id === "cl_hub");
  assert.ok(client);
  assert.equal(client.launchDate, "2026-08-26");
  assert.equal(client.platform, "klaviyo");
  assert.equal(client.launch.total, 3);
});
