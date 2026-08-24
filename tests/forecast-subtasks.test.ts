import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("forecast subtasks", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-forecast-sub-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const forecast = await import("../src/lib/forecast");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await t.test("a step lands on its parent task and defaults to done", () => {
    const parent = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-24",
      client: "Vitratherapy",
      notes: "Welcome series",
      hours: 2,
    });
    const step = forecast.createSubtask({
      taskId: parent.id,
      notes: "Built the popup that captures contacts for the welcome series",
    });
    assert.ok(step);
    assert.equal(step!.completed, 1);
    const listed = forecast.listTasksForPersonWeek("michael", "2026-08-24");
    assert.equal(listed.length, 1);
    assert.equal(listed[0].subtasks.length, 1);
    assert.equal(
      listed[0].subtasks[0].notes,
      "Built the popup that captures contacts for the welcome series"
    );
  });

  await t.test("blank notes are rejected", () => {
    const parent = forecast.createTask({
      person: "cassidy",
      taskDate: "2026-08-24",
      notes: "Parent",
      hours: 1,
    });
    assert.equal(forecast.createSubtask({ taskId: parent.id, notes: "   " }), null);
  });

  await t.test("a step can be unmarked and then removed", () => {
    const parent = forecast.createTask({
      person: "jack",
      taskDate: "2026-08-25",
      notes: "Parent",
      hours: 1,
    });
    const step = forecast.createSubtask({
      taskId: parent.id,
      notes: "Drafted the form",
    });
    const updated = forecast.updateSubtask(step!.id, { completed: false });
    assert.equal(updated!.completed, 0);
    assert.equal(forecast.deleteSubtask(step!.id), true);
    const listed = forecast.listTasksForPersonWeek("jack", "2026-08-25");
    assert.equal(listed[0].subtasks.length, 0);
  });

  await t.test("deleting a task also deletes its steps", () => {
    const parent = forecast.createTask({
      person: "paula",
      taskDate: "2026-08-26",
      notes: "Parent",
      hours: 1,
    });
    const step = forecast.createSubtask({
      taskId: parent.id,
      notes: "A step",
    });
    assert.equal(forecast.deleteTask(parent.id), true);
    assert.equal(forecast.getSubtask(step!.id), null);
  });

  await t.test("a Basecamp step id can be linked after create", () => {
    const parent = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-27",
      notes: "Welcome series",
      hours: 1,
      basecampTodoId: "todo-9",
      basecampProjectId: "proj-1",
    });
    const step = forecast.createSubtask({
      taskId: parent.id,
      notes: "Built the popup",
    });
    assert.equal(step!.basecamp_step_id, "");
    const linked = forecast.linkSubtaskBasecamp(step!.id, "step-42");
    assert.equal(linked!.basecamp_step_id, "step-42");
    assert.equal(forecast.getSubtask(step!.id)!.basecamp_step_id, "step-42");
  });

  await t.test("an unlinked task does not try to create a Basecamp subtask", async () => {
    const sync = await import("../src/lib/forecast-subtask-sync");
    const parent = forecast.createTask({
      person: "cassidy",
      taskDate: "2026-08-28",
      notes: "Typed by hand",
      hours: 1,
    });
    const step = forecast.createSubtask({
      taskId: parent.id,
      notes: "A local-only step",
    });
    const result = await sync.mirrorCreatedSubtask("cassidy", parent, step!);
    assert.equal(result.skipped, true);
    assert.equal(result.synced, false);
    assert.equal(forecast.getSubtask(step!.id)!.basecamp_step_id, "");
  });

  await t.test("a later Basecamp link can be saved on the parent row", () => {
    const parent = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-24",
      client: "ALL-IN-1 Construction",
      notes: "First Batch of Emails",
      hours: 1,
    });
    const linked = forecast.linkTaskBasecamp(parent.id, "10152277900", "48158835");
    assert.equal(linked!.basecamp_todo_id, "10152277900");
    assert.equal(linked!.basecamp_project_id, "48158835");
  });

  await t.test("todo titles match ignoring suffixes and nested labels", async () => {
    const sync = await import("../src/lib/forecast-subtask-sync");
    assert.equal(sync.todoMatchTitle("First Batch of Emails"), "first batch of emails");
    assert.equal(
      sync.todoMatchTitle("Set Up AI Chatbot › Embed script for it"),
      "set up ai chatbot"
    );
    assert.equal(
      sync.todoMatchTitle("Authenticate Domain · Due today · ~10 min"),
      "authenticate domain"
    );
  });
});
