import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

test("the desk no longer imports Basecamp to-dos on its own", async () => {
  const week = fs.readFileSync(
    path.join(root, "src/components/SnapshotWeekDepartments.tsx"),
    "utf8"
  );
  assert.doesNotMatch(week, /departments\/suggestions/);
  assert.doesNotMatch(week, /From Basecamp/);
  assert.doesNotMatch(week, /<strong>Unsorted<\/strong>/);
  assert.equal(
    fs.existsSync(path.join(root, "src/app/api/snapshot/departments/suggestions/route.ts")),
    false
  );
  assert.equal(fs.existsSync(path.join(root, "src/lib/snapshot-basecamp-recordings.ts")), false);
  const suggestSrc = fs.readFileSync(
    path.join(root, "src/lib/snapshot-basecamp-suggest.ts"),
    "utf8"
  );
  assert.doesNotMatch(suggestSrc, /weekBasecampSuggestions/);
  assert.match(suggestSrc, /export async function listClientSnapshotTodos/);
  assert.match(suggestSrc, /export async function searchClientBasecampTodos/);
});

test("a Basecamp line already on this week stays, and a later week stays empty", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-snap-keep-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);
  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const { closeDbForTests } = await import("../src/lib/db");
  const revenue = await import("../src/lib/revenue");
  const depts = await import("../src/lib/snapshot-departments");
  t.after(() => closeDbForTests());

  const client = revenue.createRevClient({
    name: "Fixture Cafe",
    businessModel: "home_service",
  });
  const thisWeek = "2026-11-09";
  const nextWeek = "2026-11-16";
  const kept = depts.addDepartmentItem({
    clientId: client.id,
    weekStart: thisWeek,
    department: "video",
    body: "Edited the November reel",
    sourceKey: "todo:9001",
    status: "completed",
    completed: true,
  });
  assert.ok(kept);

  const video = depts
    .departmentNotesForWeek(client.id, thisWeek)
    .find((note) => note.department === "video");
  assert.equal(video?.items.length, 1);
  assert.equal(video?.items[0].id, kept.id);
  assert.equal(video?.items[0].body, "Edited the November reel");
  assert.equal(video?.items[0].sourceKey, "todo:9001");
  assert.equal(video?.items[0].status, "completed");

  const filled = depts.filledDepartmentNotes(client.id, thisWeek);
  assert.equal(filled.length, 1);
  assert.equal(filled[0].items[0].sourceKey, "todo:9001");

  const later = depts.departmentNotesForWeek(client.id, nextWeek);
  assert.equal(
    later.every((note) => note.items.length === 0),
    true
  );

  const again = depts
    .departmentNotesForWeek(client.id, thisWeek)
    .find((note) => note.department === "video");
  assert.equal(again?.items[0].id, kept.id);
  assert.equal(again?.items[0].sourceKey, "todo:9001");
});
