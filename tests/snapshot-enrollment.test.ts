import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("snapshot enrollment seed, enroll, and unenroll", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-snap-enroll-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const { getDb, nowIso } = await import("../src/lib/db");
  const enrollment = await import("../src/lib/snapshot-enrollment");
  const revenue = await import("../src/lib/revenue");

  const now = nowIso();
  getDb()
    .prepare(`INSERT INTO rev_clients (id, name, outreach_paused, production_enrolled, created_at, updated_at) VALUES (?, ?, 1, 1, ?, ?)`)
    .run("kent", "Kentina Hospitality", now, now);
  getDb()
    .prepare(`INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run("pipe", "Pipe It Right", now, now);
  getDb()
    .prepare(`INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run("off", "Chaparral Junk Removal & Handyman Services", now, now);

  await t.test("the allowlist seeds once and leaves everyone else off", () => {
    const first = enrollment.seedSnapshotEnrollment();
    assert.equal(first.seeded, true);
    assert.equal(first.enrolled, 2);
    assert.equal(enrollment.isSnapshotEnrolled("kent"), true);
    assert.equal(enrollment.isSnapshotEnrolled("pipe"), true);
    assert.equal(enrollment.isSnapshotEnrolled("off"), false);
    const paused = getDb()
      .prepare(`SELECT outreach_paused, production_enrolled FROM rev_clients WHERE id = ?`)
      .get("kent") as { outreach_paused: number; production_enrolled: number };
    assert.equal(paused.outreach_paused, 1);
    assert.equal(paused.production_enrolled, 1);

    enrollment.unenrollSnapshotClient("pipe");
    const again = enrollment.seedSnapshotEnrollment();
    assert.equal(again.seeded, false);
    assert.equal(enrollment.isSnapshotEnrolled("pipe"), false);
    assert.deepEqual(
      getDb().prepare(`SELECT id FROM rev_clients WHERE id = ?`).get("pipe"),
      { id: "pipe" }
    );
  });

  await t.test("a removed client can be enrolled again without wiping their account", () => {
    const later = revenue.createRevClient({ name: "Sierra Sprinkler", businessModel: "home_service" });
    revenue.updateRevClient(later.id, {
      outreachPaused: true,
      productionEnrolled: true,
      basecampProjectId: "42",
    });
    assert.equal(enrollment.isSnapshotEnrolled(later.id), false);
    assert.equal(enrollment.enrollSnapshotClient(later.id, "michael"), true);
    assert.equal(enrollment.isSnapshotEnrolled(later.id), true);
    const row = revenue.getRevClient(later.id)!;
    assert.equal(row.outreach_paused, 1);
    assert.equal(row.production_enrolled, 1);
    assert.equal(row.basecamp_project_id, "42");
    assert.equal(enrollment.unenrollSnapshotClient(later.id), true);
    assert.equal(enrollment.isSnapshotEnrolled(later.id), false);
    const kept = revenue.getRevClient(later.id)!;
    assert.equal(kept.outreach_paused, 1);
    assert.equal(kept.production_enrolled, 1);
    assert.equal(kept.basecamp_project_id, "42");
    assert.equal(enrollment.enrollSnapshotClient(later.id, "michael"), true);
    assert.equal(enrollment.isSnapshotEnrolled(later.id), true);
  });

  await t.test("an unknown client cannot be enrolled", () => {
    assert.equal(enrollment.enrollSnapshotClient("missing"), false);
  });
});
