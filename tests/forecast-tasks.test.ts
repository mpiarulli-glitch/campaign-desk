import assert from "node:assert/strict";
import test from "node:test";
import {
  assignedTaskHref,
  filterAssignedTasks,
  groupAssignedTasks,
  groupAssignedTasksByDue,
} from "../src/lib/forecast-tasks";
import type { QueueTodo } from "../src/lib/forecast-queue";

function todo(partial: Partial<QueueTodo> & Pick<QueueTodo, "id" | "title">): QueueTodo {
  return {
    list: "",
    dueOn: null,
    projectId: "p1",
    clientId: "",
    clientName: "Client A",
    ...partial,
  };
}

test("dated filter keeps only tasks with a due date", () => {
  const rows = [
    todo({ id: "1", title: "Dated", dueOn: "2026-09-02" }),
    todo({ id: "2", title: "Open-ended" }),
  ];
  assert.deepEqual(
    filterAssignedTasks(rows, "dated").map((t) => t.id),
    ["1"]
  );
  assert.equal(filterAssignedTasks(rows, "all").length, 2);
});

test("groupAssignedTasks clusters by client name", () => {
  const rows = [
    todo({ id: "1", title: "A", clientName: "CIPO", clientId: "c1" }),
    todo({ id: "2", title: "B", clientName: "Ecoworkz", clientId: "c2" }),
    todo({ id: "3", title: "C", clientName: "CIPO", clientId: "c1" }),
  ];
  const groups = groupAssignedTasks(rows);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].label, "CIPO");
  assert.deepEqual(
    groups[0].items.map((t) => t.id),
    ["1", "3"]
  );
  assert.equal(groups[1].label, "Ecoworkz");
});

test("groupAssignedTasksByDue buckets overdue, today, upcoming, and no date", () => {
  const today = "2026-09-09";
  const rows = [
    todo({ id: "1", title: "Late", dueOn: "2026-09-01" }),
    todo({ id: "2", title: "Today", dueOn: "2026-09-09" }),
    todo({ id: "3", title: "Later", dueOn: "2026-09-15" }),
    todo({ id: "4", title: "Open" }),
  ];
  const groups = groupAssignedTasksByDue(rows, today);
  assert.deepEqual(
    groups.map((g) => [g.key, g.items.map((t) => t.id)]),
    [
      ["overdue", ["1"]],
      ["today", ["2"]],
      ["upcoming", ["3"]],
      ["none", ["4"]],
    ]
  );
});

test("assignedTaskHref prefers appUrl and falls back for steps to the parent", () => {
  assert.equal(
    assignedTaskHref(
      todo({
        id: "99",
        title: "Has url",
        appUrl: "https://app.basecamp.com/1/buckets/2/todos/99",
      })
    ),
    "https://app.basecamp.com/1/buckets/2/todos/99"
  );
  assert.equal(
    assignedTaskHref(
      todo({
        id: "step-1",
        title: "Step",
        kind: "step",
        parentId: "parent-9",
        projectId: "bucket-3",
      })
    ),
    "https://3.basecamp.com/5338018/buckets/bucket-3/todos/parent-9"
  );
});
