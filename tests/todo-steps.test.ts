import assert from "node:assert/strict";
import test from "node:test";
import { attachTodoSteps, type TodoPickerItem } from "../src/lib/todo-steps";

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
