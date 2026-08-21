import assert from "node:assert/strict";
import test from "node:test";
import {
  bookedRecordingIds,
  queueTodoLinkage,
  queueTodoNotes,
  sortQueueTodos,
  type QueueTodo,
} from "../src/lib/forecast-queue";

const base: QueueTodo = {
  id: "todo_1",
  title: "Build the August email",
  list: "To Dos › Email",
  dueOn: null,
  projectId: "p1",
  clientId: "cl_1",
  clientName: "Humble Somm",
};

test("a to-do books against itself", () => {
  assert.deepEqual(queueTodoLinkage(base), {
    basecampTodoId: "todo_1",
    basecampStepId: "",
  });
  assert.equal(queueTodoNotes(base), "Build the August email");
});

test("a subtask books against itself and its parent", () => {
  const step: QueueTodo = {
    ...base,
    id: "step_9",
    title: "Send a2p application",
    kind: "step",
    parentId: "todo_4",
    parentTitle: "SMS Texting",
  };
  // Both ids travel: the step is what gets ticked, the parent to-do is the only
  // one of the two that accepts a timesheet entry.
  assert.deepEqual(queueTodoLinkage(step), {
    basecampTodoId: "todo_4",
    basecampStepId: "step_9",
  });
  assert.equal(queueTodoNotes(step), "SMS Texting › Send a2p application");
});

test("booked ids cover subtasks by their own id, not their parent's", () => {
  const booked = bookedRecordingIds([
    { basecamp_todo_id: "todo_4", basecamp_step_id: "step_9" },
    { basecamp_todo_id: "todo_1", basecamp_step_id: "" },
    { basecamp_todo_id: "", basecamp_step_id: "" },
  ]);
  assert.equal(booked.has("step_9"), true);
  assert.equal(booked.has("todo_1"), true);
  // Taking one subtask must not hide its siblings, so the parent stays pickable.
  assert.equal(booked.has("todo_4"), false);
  assert.equal(booked.size, 2);
});

test("the queue leads with assigned work, then the soonest due date", () => {
  const sorted = sortQueueTodos([
    { ...base, id: "a", dueOn: "2026-09-01" },
    { ...base, id: "b", dueOn: null, assigned: true },
    { ...base, id: "c", dueOn: "2026-08-22", assigned: true },
    { ...base, id: "d", dueOn: null },
  ]);
  assert.deepEqual(sorted.map((t) => t.id), ["c", "b", "a", "d"]);
});
