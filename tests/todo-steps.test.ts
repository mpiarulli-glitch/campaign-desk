import assert from "node:assert/strict";
import test from "node:test";
import {
  attachTodoSteps,
  flagAssignedWithSteps,
  type TodoPickerItem,
} from "../src/lib/todo-steps";

const parent: TodoPickerItem = {
  id: "10",
  title: "Build homepage",
  list: "To Dos › Web",
  assigneeIds: [1],
  dueOn: null,
};
const other: TodoPickerItem = {
  id: "11",
  title: "Write copy",
  list: "To Dos › Web",
  assigneeIds: [],
  dueOn: "2026-08-20",
};

test("open subtasks sit under their parent todo", () => {
  const out = attachTodoSteps(
    [parent, other],
    [
      {
        id: "s1",
        title: "Hero image",
        parentId: "10",
        parentType: "Todo",
        parentTitle: "Build homepage",
        completed: false,
        assigneeIds: [2],
        dueOn: "2026-08-18",
      },
      {
        id: "s2",
        title: "Already done",
        parentId: "10",
        parentType: "Todo",
        parentTitle: "Build homepage",
        completed: true,
        assigneeIds: [],
        dueOn: null,
      },
    ]
  );
  assert.deepEqual(
    out.map((t) => `${t.kind}:${t.title}`),
    ["todo:Build homepage", "step:Hero image", "todo:Write copy"]
  );
  assert.equal(out[1].parentTitle, "Build homepage");
  assert.equal(out[1].list, "To Dos › Web");
  assert.equal(out[1].dueOn, "2026-08-18");
});

test("card-table steps are ignored unless their parent is a listed todo", () => {
  const out = attachTodoSteps([parent], [
    {
      id: "card-step",
      title: "Card checklist item",
      parentId: "999",
      parentType: "Kanban::Card",
      parentTitle: "Some card",
      completed: false,
      assigneeIds: [],
      dueOn: null,
    },
  ]);
  assert.deepEqual(out.map((t) => t.id), ["10"]);
});

test("a subtask falls due when its parent does", () => {
  const out = attachTodoSteps([other], [
    {
      id: "s3",
      title: "Draft the headline",
      parentId: "11",
      parentType: "Todo",
      parentTitle: "Write copy",
      completed: false,
      assigneeIds: [],
      dueOn: null,
    },
  ]);
  // Basecamp sets no due date on a step, so it reads its parent's rather than
  // showing up as undated work.
  assert.equal(out[1].dueOn, "2026-08-20");
});

test("subtasks of your to-do count as yours", () => {
  const items = attachTodoSteps(
    [parent, other],
    [
      {
        id: "s1",
        title: "Hero image",
        parentId: "10",
        parentType: "Todo",
        parentTitle: "Build homepage",
        completed: false,
        assigneeIds: [],
        dueOn: null,
      },
      {
        id: "s2",
        title: "Proofread",
        parentId: "11",
        parentType: "Todo",
        parentTitle: "Write copy",
        completed: false,
        assigneeIds: [],
        dueOn: null,
      },
    ]
  );
  // Person 1 owns "Build homepage" (id 10) but not "Write copy" (id 11).
  const { todos, assignedCount } = flagAssignedWithSteps(items, (t) =>
    t.assigneeIds.includes(1)
  );
  assert.deepEqual(
    todos.filter((t) => t.assigned).map((t) => t.id),
    ["10", "s1"]
  );
  assert.equal(assignedCount, 2);
});

test("a subtask with its own assignee is judged on that, not the parent's", () => {
  const items = attachTodoSteps([parent], [
    {
      id: "s1",
      title: "Hero image",
      parentId: "10",
      parentType: "Todo",
      parentTitle: "Build homepage",
      completed: false,
      assigneeIds: [2],
      dueOn: null,
    },
  ]);
  const { todos } = flagAssignedWithSteps(items, (t) => t.assigneeIds.includes(1));
  assert.equal(todos.find((t) => t.id === "10")?.assigned, true);
  assert.equal(todos.find((t) => t.id === "s1")?.assigned, false);
});
