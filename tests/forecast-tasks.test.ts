import assert from "node:assert/strict";
import test from "node:test";
import {
  filterAssignedTasks,
  groupAssignedTasks,
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
