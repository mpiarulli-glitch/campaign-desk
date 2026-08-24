import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("forecast plan undo", async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cd-plan-undo-"));
  const originalCwd = process.cwd();
  process.chdir(tmp);

  const forecast = await import("../src/lib/forecast");

  t.after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  await t.test("undo deletes created rows and puts moved ones back", () => {
    const kept = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-25",
      client: "Acme",
      notes: "Existing work",
      hours: 1,
      startTime: "09:00",
    });
    const created = forecast.createTask({
      person: "michael",
      taskDate: "2026-08-26",
      client: "MEG",
      notes: "MEG cold outreach",
      hours: 1.5,
      startTime: "13:00",
    });
    forecast.updateTask(kept.id, { taskDate: "2026-08-27", startTime: "14:00" });
    forecast.upsertWeekNote("michael", "2026-08-24", "Weekly plan · scratch");

    forecast.savePlanUndo("michael", "2026-08-24", {
      createdIds: [created.id],
      moved: [{ id: kept.id, taskDate: "2026-08-25", startTime: "09:00" }],
      note: "",
    });
    assert.equal(forecast.hasPlanUndo("michael", "2026-08-24"), true);

    const result = forecast.applyPlanUndo("michael", "2026-08-24");
    assert.ok(result);
    assert.equal(result!.deleted, 1);
    assert.equal(result!.restored, 1);
    assert.equal(forecast.getTask(created.id), null);
    const back = forecast.getTask(kept.id);
    assert.equal(back?.task_date, "2026-08-25");
    assert.equal(back?.start_time, "09:00");
    assert.equal(forecast.getWeekNote("michael", "2026-08-24"), "");
    assert.equal(forecast.hasPlanUndo("michael", "2026-08-24"), false);
  });

  await t.test("a week with no snapshot cannot be undone", () => {
    assert.equal(forecast.applyPlanUndo("cassidy", "2026-08-24"), null);
  });
});
