import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";

test("production schedule card lookup prefers the booked window reminder", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-prod-card-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { getDb, nowIso } = await import("../src/lib/db");
  const sync = await import("../src/lib/production-card-sync");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO rev_clients (id, name, basecamp_project_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run("c1", "Cisco Restaurant + Bar", "proj-1", now, now);

  getDb()
    .prepare(
      `INSERT INTO schedule_reminders
        (id, client_id, window_start, last_sent, count, bc_card_at, bc_card_id,
         bc_last_nudge, bc_nudge_count, created_at, updated_at)
       VALUES (?, ?, ?, '', 0, ?, ?, '', 0, ?, ?)`
    )
    .run(nanoid(12), "c1", "2026-09-15", now, "card-window", now, now);

  getDb()
    .prepare(
      `INSERT INTO extra_production_requests
        (id, client_id, kind, window_start, window_end, note, created_by,
         bc_card_id, bc_card_at, created_at, updated_at)
       VALUES (?, ?, 'extra', ?, ?, '', '', ?, ?, ?, ?)`
    )
    .run(
      nanoid(12),
      "c1",
      "2026-09-01",
      "2026-09-30",
      "card-extra",
      now,
      now,
      now
    );

  assert.equal(
    sync.findProductionScheduleCardId("c1", { windowStart: "2026-09-15" }),
    "card-window"
  );
  assert.equal(
    sync.findProductionScheduleCardId("c1", {}),
    "card-extra"
  );
});

test("production schedule card lookup finds a just-fulfilled extra invite", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-prod-card2-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { getDb, nowIso } = await import("../src/lib/db");
  const sync = await import("../src/lib/production-card-sync");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`
    )
    .run("c2", "Guardian Plumbers", now, now);

  getDb()
    .prepare(
      `INSERT INTO extra_production_requests
        (id, client_id, kind, window_start, window_end, note, created_by,
         bc_card_id, bc_card_at, fulfilled_send_id, fulfilled_at, created_at, updated_at)
       VALUES (?, ?, 'first', ?, ?, '', '', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      nanoid(12),
      "c2",
      "2026-08-01",
      "2026-08-31",
      "card-first",
      now,
      "send-99",
      now,
      now,
      now
    );

  assert.equal(
    sync.findProductionScheduleCardId("c2", { sendId: "send-99" }),
    "card-first"
  );
});

test("syncProductionScheduleCard is a silent skip when no card exists", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-prod-card3-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { getDb, nowIso } = await import("../src/lib/db");
  const failures = await import("../src/lib/failures");
  const sync = await import("../src/lib/production-card-sync");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO rev_clients (id, name, basecamp_project_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run("c3", "Hendos Barrel House", "proj-3", now, now);

  await sync.syncProductionScheduleCard({
    client: getDb()
      .prepare(`SELECT * FROM rev_clients WHERE id = ?`)
      .get("c3") as import("../src/lib/db").RevClient,
  });
  assert.equal(failures.openFailureCount(), 0);
});
