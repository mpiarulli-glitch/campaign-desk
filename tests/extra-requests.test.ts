import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("an expired extra ask closes when they book a later day", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-extra-req-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const extras = await import("../src/lib/extra-requests");
  const { getDb, nowIso } = await import("../src/lib/db");
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO rev_clients (id, name, active, monthly_email_quota, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?)`
    )
    .run("c1", "Test Co", 4, now, now);

  const created = extras.createExtraRequest({
    clientId: "c1",
    windowStart: "2026-08-10",
    windowEnd: "2026-08-14",
  });
  assert.equal(extras.listOpenExtraRequests("c1").length, 1);

  extras.fulfillMatchingExtraRequest("c1", "2026-08-20", "send-1");
  assert.equal(extras.listOpenExtraRequests("c1").length, 1);

  extras.fulfillExpiredOpenExtraRequest("c1", "2026-08-18", "send-1");
  assert.equal(extras.listOpenExtraRequests("c1").length, 0);
  const closed = extras.getExtraRequest(created.id);
  assert.equal(closed?.fulfilled_send_id, "send-1");
});
