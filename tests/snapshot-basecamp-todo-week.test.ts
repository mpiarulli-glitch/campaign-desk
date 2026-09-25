import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A completed Basecamp to-do linked on a deliverable belongs to that week.
// Monthly items still show an earlier week's status and note, but not its to-do.

const TODO = {
  id: "todo-audit",
  projectId: "proj-ecoworkz",
  title: "Organic Attribution Audit (GTM & GA4)",
  url: "https://3.basecamp.com/todo-audit",
  completedAt: "2026-09-18T15:00:00.000Z",
};

test("a linked Basecamp to-do stays on the week it was attached", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-todo-week-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const snapshot = await import("../src/lib/snapshot");
  const { getDb, nowIso } = await import("../src/lib/db");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const now = nowIso();
  const WEEK_1 = "2026-09-14";
  const WEEK_2 = "2026-09-21";

  function client(id: string) {
    getDb()
      .prepare(`INSERT INTO rev_clients (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(id, `Client ${id}`, now, now);
    return id;
  }

  function row(clientId: string, deliverableId: string, week: string) {
    return snapshot.weekData(clientId, week).find((r) => r.deliverable_id === deliverableId)!;
  }

  await t.test("a later week in the month does not show last week's to-do", () => {
    const id = client("todo_month");
    const d = snapshot.createDeliverable({
      clientId: id,
      category: "SEO",
      name: "SEO Management",
      cadence: "15 hours/month",
      cadenceUnit: "monthly",
    });

    snapshot.upsertEntry({
      deliverableId: d.id,
      weekStart: WEEK_1,
      status: "in_progress",
      workDone: "Organic Attribution Audit (GTM & GA4)",
      basecampTodo: TODO,
    });

    const linked = row(id, d.id, WEEK_1);
    assert.equal(linked.basecamp_todo_id, TODO.id);
    assert.equal(linked.basecamp_todo_title, TODO.title);
    assert.equal(linked.week_start, WEEK_1);

    const later = row(id, d.id, WEEK_2);
    assert.equal(later.status, "in_progress");
    assert.equal(later.work_done, "");
    assert.equal(later.next_steps, "");
    assert.equal(later.notes, "");
    assert.equal(later.week_start, "");
    assert.equal(later.basecamp_todo_id, "");
    assert.equal(later.basecamp_todo_title, "");
    assert.equal(later.basecamp_project_id, "");
  });

  await t.test("saving the later week does not copy the earlier to-do onto it", () => {
    const id = client("todo_save");
    const d = snapshot.createDeliverable({
      clientId: id,
      category: "SEO",
      name: "SEO Management",
      cadence: "15 hours/month",
      cadenceUnit: "monthly",
    });

    snapshot.upsertEntry({
      deliverableId: d.id,
      weekStart: WEEK_1,
      status: "in_progress",
      workDone: "Audit",
      basecampTodo: TODO,
    });
    snapshot.upsertEntry({
      deliverableId: d.id,
      weekStart: WEEK_2,
      status: "in_progress",
      workDone: "This week's note",
    });

    const later = row(id, d.id, WEEK_2);
    assert.equal(later.week_start, WEEK_2);
    assert.equal(later.work_done, "This week's note");
    assert.equal(later.basecamp_todo_id, "");
    assert.equal(later.basecamp_todo_title, "");

    const earlier = row(id, d.id, WEEK_1);
    assert.equal(earlier.basecamp_todo_id, TODO.id);
    assert.equal(earlier.basecamp_todo_title, TODO.title);
  });

  await t.test("linking a to-do on the later week stays on that week", () => {
    const id = client("todo_this_week");
    const d = snapshot.createDeliverable({
      clientId: id,
      category: "SEO",
      name: "SEO Management",
      cadence: "15 hours/month",
      cadenceUnit: "monthly",
    });

    snapshot.upsertEntry({
      deliverableId: d.id,
      weekStart: WEEK_1,
      status: "in_progress",
      basecampTodo: TODO,
    });
    const thisWeek = {
      ...TODO,
      id: "todo-this-week",
      title: "September technical fixes",
    };
    snapshot.upsertEntry({
      deliverableId: d.id,
      weekStart: WEEK_2,
      status: "in_progress",
      basecampTodo: thisWeek,
    });

    assert.equal(row(id, d.id, WEEK_1).basecamp_todo_id, TODO.id);
    assert.equal(row(id, d.id, WEEK_2).basecamp_todo_id, thisWeek.id);
    assert.equal(row(id, d.id, WEEK_2).basecamp_todo_title, thisWeek.title);
  });
});
