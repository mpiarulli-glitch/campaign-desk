import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { snapshotTodoHit } from "../src/lib/snapshot-basecamp-suggestions";

test("a Basecamp to-do search hit picks a department and a status", () => {
  const lifecycle = snapshotTodoHit(
    {
      id: 42,
      type: "Todo",
      title: "Move the mystery discount",
      completed: false,
      parent: { title: "Email / SMS / LinkedIn / Automations" },
    },
    "2026-11-06"
  );
  assert.equal(lifecycle?.department, "lifecycle");
  assert.equal(lifecycle?.status, "in_progress");
  assert.equal(lifecycle?.sourceKey, "todo:42");

  const done = snapshotTodoHit(
    {
      id: 7,
      title: "Launch the retargeting set",
      completed: true,
      parent: { title: "Meta Ads" },
    },
    "2026-11-06"
  );
  assert.equal(done?.department, "ads");
  assert.equal(done?.status, "completed");

  const later = snapshotTodoHit(
    {
      id: 8,
      title: "Film the testimonial",
      completed: false,
      starts_on: "2026-11-20",
      parent: { title: "General" },
    },
    "2026-11-06"
  );
  assert.equal(later?.department, "unsorted");
  assert.equal(later?.status, "scheduled");

  assert.equal(snapshotTodoHit({ id: 1, type: "Message", title: "Hello" }, "2026-11-06"), null);
});

test("department items keep in progress, scheduled, and completed", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-item-status-"));
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

  const client = revenue.createRevClient({ name: "12 Volt Power", businessModel: "home_service" });
  const week = "2026-11-02";

  const typed = depts.addDepartmentItem({
    clientId: client.id,
    weekStart: week,
    department: "web",
    body: "Rewrite the hero",
  });
  assert.equal(typed?.status, "in_progress");
  assert.equal(typed?.completed, false);

  const finished = depts.addDepartmentItem({
    clientId: client.id,
    weekStart: week,
    department: "ads",
    body: "Launch the set",
    completed: true,
    sourceKey: "todo:9",
  });
  assert.equal(finished?.status, "completed");

  const sent = depts.addDepartmentItem({
    clientId: client.id,
    weekStart: week,
    department: "social",
    body: "Reel for approval",
    mark: "sent",
    sourceKey: "card:3",
  });
  assert.equal(sent?.status, "scheduled");

  const changed = depts.updateDepartmentItem({ itemId: typed!.id, status: "scheduled" });
  assert.equal(changed?.status, "scheduled");
  assert.equal(changed?.completed, false);

  const notes = depts.departmentNotesForWeek(client.id, week);
  const web = notes.find((note) => note.department === "web")?.items[0];
  assert.equal(web?.status, "scheduled");
  assert.equal(depts.departmentHasSourceKey(client.id, week, "todo:9"), true);
});
