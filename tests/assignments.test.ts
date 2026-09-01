import assert from "node:assert/strict";
import test from "node:test";
import { shapeAssignments } from "../src/lib/assignments";

// Shapes copied from a real /my/assignments.json response: note `title: null`
// with the text in `content`, the lowercase `type`, and subtasks arriving as
// `children` rather than as assignments of their own.

test("a to-do comes through with its project and list", () => {
  const out = shapeAssignments({
    non_priorities: [
      {
        id: 9855166235,
        type: "todo",
        title: null,
        content: "ABM for Sales Team ",
        due_on: "2026-08-07",
        completed: false,
        app_url: "https://app.basecamp.com/5338018/buckets/28110364/todos/9855166235",
        bucket: { id: 28110364, name: "Empire Leadership HQ" },
        parent: { id: 7840832649, title: "Michael's To-Do's" },
      },
    ],
  });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    id: "9855166235",
    // Text comes from `content`, and is trimmed — the live payload has a
    // trailing space on this one.
    title: "ABM for Sales Team",
    kind: "todo",
    projectId: "28110364",
    projectName: "Empire Leadership HQ",
    list: "Michael's To-Do's",
    dueOn: "2026-08-07",
    appUrl: "https://app.basecamp.com/5338018/buckets/28110364/todos/9855166235",
  });
});

test("card-table cards are assignments too", () => {
  const out = shapeAssignments({
    non_priorities: [
      {
        id: 10080337974,
        type: "card",
        content: "JG Seamless Gutters launch",
        completed: false,
        bucket: { id: 48019705, name: "JG Seamless Gutters" },
        parent: { id: 10080337972, title: "Empire Blueprint: Internal Brief" },
      },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "card");
  assert.equal(out[0].list, "Empire Blueprint: Internal Brief");
});

test("subtasks follow their parent and inherit its context", () => {
  const out = shapeAssignments({
    non_priorities: [
      {
        id: 10080337974,
        type: "card",
        content: "JG Seamless Gutters launch",
        due_on: "2026-09-01",
        completed: false,
        bucket: { id: 48019705, name: "JG Seamless Gutters" },
        parent: { id: 1, title: "Internal Brief" },
        children: [
          { id: 10080337991, type: "step", content: "Gather Data / Analytics", completed: false },
          { id: 10080338011, type: "step", content: "Build Strategy", completed: true },
        ],
      },
    ],
  });
  assert.deepEqual(
    out.map((a) => `${a.kind}:${a.title}`),
    ["card:JG Seamless Gutters launch", "step:Gather Data / Analytics"]
  );
  const step = out[1];
  assert.equal(step.parentId, "10080337974");
  assert.equal(step.parentTitle, "JG Seamless Gutters launch");
  // No date of its own, so it falls due when its parent does.
  assert.equal(step.dueOn, "2026-09-01");
  assert.equal(step.projectId, "48019705");
});

test("template placeholders like [Business Name] are left out with their steps", () => {
  const out = shapeAssignments({
    non_priorities: [
      {
        id: 10080337974,
        type: "card",
        content: "[Business Name]",
        due_on: "2026-09-01",
        completed: false,
        bucket: { id: 48019705, name: "Some Client Project" },
        parent: { id: 1, title: "Empire Blueprint: Internal Brief" },
        children: [
          { id: 10080337991, type: "step", content: "Gather Data / Analytics", completed: false },
          { id: 10080338011, type: "step", content: "Build Strategy", completed: false },
        ],
      },
      {
        id: 99,
        type: "todo",
        content: "Real client work",
        completed: false,
        bucket: { id: 1, name: "Top Notch Auto" },
        parent: { id: 2, title: "Email" },
      },
    ],
  });
  assert.deepEqual(
    out.map((a) => `${a.kind}:${a.title}`),
    ["todo:Real client work"]
  );
});

test("shared to-do library projects are left out even without placeholders", () => {
  const out = shapeAssignments({
    non_priorities: [
      {
        id: 10,
        type: "todo",
        content: "Build Editorial Calendar",
        completed: false,
        bucket: { id: 48019705, name: "Department To-Do's Library" },
        parent: { id: 1, title: "Internal Onboarding" },
      },
      {
        id: 11,
        type: "todo",
        content: "Weekly Email",
        completed: false,
        bucket: { id: 2, name: "Top Notch Auto" },
        parent: { id: 3, title: "Strategy / Client Comms" },
      },
    ],
  });
  assert.deepEqual(
    out.map((a) => a.title),
    ["Weekly Email"]
  );
});

test("priorities are listed ahead of everything else", () => {
  const out = shapeAssignments({
    priorities: [
      { id: 1, type: "todo", content: "Urgent thing", bucket: { id: 9, name: "P" } },
    ],
    non_priorities: [
      { id: 2, type: "todo", content: "Normal thing", bucket: { id: 9, name: "P" } },
    ],
  });
  assert.deepEqual(out.map((a) => a.title), ["Urgent thing", "Normal thing"]);
});

test("completed work is left out, but its open subtasks are not", () => {
  const out = shapeAssignments({
    non_priorities: [
      {
        id: 1,
        type: "todo",
        content: "Done parent",
        completed: true,
        bucket: { id: 9, name: "P" },
        children: [{ id: 2, type: "step", content: "Still open", completed: false }],
      },
    ],
  });
  // The parent is gone; the subtask nobody ticked is still work.
  assert.deepEqual(out.map((a) => `${a.kind}:${a.title}`), ["step:Still open"]);
});

test("rows with no text, no bucket, or an unknown type are skipped", () => {
  const out = shapeAssignments({
    non_priorities: [
      { id: 1, type: "todo", content: "   ", bucket: { id: 9 } },
      { id: 2, type: "todo", content: "No project" },
      { id: 3, type: "message", content: "Not a task", bucket: { id: 9 } },
      { id: 4, type: "step", content: "Orphan step", bucket: { id: 9 } },
    ],
  });
  assert.deepEqual(out, []);
});

test("an empty payload is not an error", () => {
  assert.deepEqual(shapeAssignments({}), []);
});
