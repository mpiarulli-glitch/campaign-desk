import assert from "node:assert/strict";
import test from "node:test";
import { dayBeforeDue } from "../src/lib/week";
import { AUTO_TODO_HOURS, planAutofill } from "../src/lib/forecast-autofill-plan";

test("day before a due date is the previous workday", () => {
  assert.equal(dayBeforeDue("2026-08-18"), "2026-08-17"); // Tue -> Mon
  assert.equal(dayBeforeDue("2026-08-14"), "2026-08-13"); // Fri -> Thu
  assert.equal(dayBeforeDue("2026-08-17"), "2026-08-14"); // Mon -> Fri
  assert.equal(dayBeforeDue("2026-08-15"), "2026-08-14"); // Sat -> Fri
  assert.equal(dayBeforeDue("2026-08-16"), "2026-08-14"); // Sun -> Fri
});

test("autofill plans todos onto the week they would be worked", () => {
  const weekStart = "2026-08-10";
  const plan = planAutofill({
    weekStart,
    existingTodoIds: ["already"],
    candidates: [
      {
        todoId: "already",
        title: "Already on the board",
        dueOn: "2026-08-12",
        projectId: "1",
        client: "Krak Boba Corporate",
      },
      {
        todoId: "tue",
        title: "Cut the Temecula spot",
        dueOn: "2026-08-11",
        projectId: "2",
        client: "Video Editing Team",
      },
      {
        todoId: "next-mon",
        title: "Too far out",
        dueOn: "2026-08-18",
        projectId: "2",
        client: "Video Editing Team",
      },
      {
        todoId: "this-fri",
        title: "Upload media",
        dueOn: "2026-08-14",
        projectId: "3",
        client: "Krak Boba Corporate",
      },
    ],
  });

  assert.equal(plan.skippedExisting, 1);
  assert.equal(plan.skippedOtherWeek, 1);
  assert.equal(plan.items.length, 2);
  assert.equal(plan.items[0].basecampTodoId, "tue");
  assert.equal(plan.items[0].taskDate, "2026-08-10");
  assert.equal(plan.items[0].hours, AUTO_TODO_HOURS);
  assert.equal(plan.items[1].basecampTodoId, "this-fri");
  assert.equal(plan.items[1].taskDate, "2026-08-13");
});
