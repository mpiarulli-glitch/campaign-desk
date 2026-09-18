import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mondayOf } from "../src/lib/week";

test("snapshot entry can link a completed Basecamp to-do", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-snap-todo-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const { getDb, nowIso } = await import("../src/lib/db");
  const snapshot = await import("../src/lib/snapshot");
  const { isThisWeeksWork } = await import("../src/lib/snapshot-status");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  getDb()
    .prepare(`INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run("c1", "Client One", now, now);
  const d = snapshot.createDeliverable({
    clientId: "c1",
    category: "Email",
    name: "Broadcast emails",
    cadence: "",
    cadenceUnit: "weekly",
  });
  const week = mondayOf(new Date());

  snapshot.upsertEntry({
    deliverableId: d.id,
    weekStart: week,
    status: "completed",
    workDone: "Sent the September newsletter",
    loggedBy: "randi",
    basecampTodo: {
      id: "todo-99",
      projectId: "proj-1",
      title: "Send September newsletter",
      url: "https://3.basecamp.com/1/buckets/proj-1/todos/todo-99",
      completedAt: "2026-09-17T18:00:00.000Z",
    },
  });

  const row = snapshot.weekData("c1", week).find((r) => r.deliverable_id === d.id)!;
  assert.equal(row.basecamp_todo_id, "todo-99");
  assert.equal(row.basecamp_project_id, "proj-1");
  assert.equal(row.basecamp_todo_title, "Send September newsletter");
  assert.equal(row.basecamp_todo_url, "https://3.basecamp.com/1/buckets/proj-1/todos/todo-99");
  assert.equal(row.basecamp_todo_completed_at, "2026-09-17T18:00:00.000Z");
  assert.equal(row.work_done, "Sent the September newsletter");
  assert.equal(isThisWeeksWork(row, week), true);

  // Saving an unrelated field must not drop the link.
  snapshot.upsertEntry({
    deliverableId: d.id,
    weekStart: week,
    nextSteps: "Plan October",
    loggedBy: "randi",
  });
  const kept = snapshot.weekData("c1", week).find((r) => r.deliverable_id === d.id)!;
  assert.equal(kept.basecamp_todo_id, "todo-99");
  assert.equal(kept.next_steps, "Plan October");

  // Explicit null clears it.
  snapshot.upsertEntry({
    deliverableId: d.id,
    weekStart: week,
    basecampTodo: null,
    loggedBy: "randi",
  });
  const cleared = snapshot.weekData("c1", week).find((r) => r.deliverable_id === d.id)!;
  assert.equal(cleared.basecamp_todo_id, "");
  assert.equal(cleared.basecamp_todo_title, "");
  assert.equal(cleared.work_done, "Sent the September newsletter");
});

test("a linked completed to-do alone counts as this week's work", async () => {
  const { isThisWeeksWork } = await import("../src/lib/snapshot-status");
  assert.equal(
    isThisWeeksWork(
      {
        week_start: "2026-09-15",
        created_at: "2026-09-17T12:00:00.000Z",
        status: "not_started",
        work_done: "",
        next_steps: "",
        notes: "",
        basecamp_todo_id: "todo-1",
        basecamp_todo_title: "Finished the audit",
      },
      "2026-09-15"
    ),
    true
  );
});
