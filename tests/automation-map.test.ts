import assert from "node:assert/strict";
import test from "node:test";
import {
  atLabel,
  buildAutomationTree,
  coercePresentation,
  coerceTriggerKind,
  delayLabel,
  delayToMs,
  splitDelay,
  summarizeFlow,
} from "../src/lib/automation-map";

test("presentation and trigger kind coerce to known values", () => {
  assert.equal(coercePresentation("automation"), "automation");
  assert.equal(coercePresentation("package"), "package");
  assert.equal(coercePresentation("nope"), "package");
  assert.equal(coerceTriggerKind("tag"), "tag");
  assert.equal(coerceTriggerKind("mystery"), "custom");
});

test("delay labels read the way a client would say them", () => {
  assert.equal(delayLabel(0), "Immediately");
  assert.equal(delayLabel(delayToMs(1, "days")), "1 day");
  assert.equal(delayLabel(delayToMs(3, "days")), "3 days");
  assert.equal(delayLabel(delayToMs(2, "hours")), "2 hours");
  assert.equal(delayLabel(delayToMs(45, "minutes")), "45 minutes");
});

test("splitDelay picks the largest exact unit", () => {
  assert.deepEqual(splitDelay(0), { amount: 0, unit: "days" });
  assert.deepEqual(splitDelay(delayToMs(2, "days")), { amount: 2, unit: "days" });
  assert.deepEqual(splitDelay(delayToMs(3, "hours")), { amount: 3, unit: "hours" });
  assert.deepEqual(splitDelay(delayToMs(15, "minutes")), {
    amount: 15,
    unit: "minutes",
  });
});

test("fallback map only inserts waits when delay_ms is set", () => {
  const tree = buildAutomationTree({
    triggerLabel: "Tag added: New patient",
    triggerKind: "tag",
    emails: [
      { id: "e1", title: "Welcome", delay_ms: 0 },
      { id: "e2", title: "Day 3 check-in", delay_ms: delayToMs(3, "days") },
    ],
  });
  assert.equal(tree.trigger.label, "Tag added: New patient");
  assert.equal(tree.nodes.length, 3);
  assert.equal(tree.nodes[0]?.type, "email");
  assert.equal(tree.nodes[1]?.type, "wait");
  if (tree.nodes[1]?.type === "wait") assert.equal(tree.nodes[1].label, "3 days");
  assert.equal(tree.nodes[2]?.type, "email");
});

test("stored steps can wait, email, then split if/else", () => {
  const tree = buildAutomationTree({
    triggerLabel: "Form submitted",
    triggerKind: "form",
    emails: [
      { id: "e1", title: "Welcome" },
      { id: "e2", title: "Clicked" },
      { id: "e3", title: "Didn't click" },
    ],
    steps: [
      {
        id: "w1",
        parent_id: null,
        branch: "",
        sort_order: 0,
        step_type: "wait",
        delay_ms: delayToMs(1, "days"),
        email_id: null,
        condition_kind: "custom",
        condition_label: "",
      },
      {
        id: "m1",
        parent_id: null,
        branch: "",
        sort_order: 1,
        step_type: "email",
        delay_ms: 0,
        email_id: "e1",
        condition_kind: "custom",
        condition_label: "",
      },
      {
        id: "c1",
        parent_id: null,
        branch: "",
        sort_order: 2,
        step_type: "condition",
        delay_ms: 0,
        email_id: null,
        condition_kind: "clicked",
        condition_label: "Clicked the booking link?",
      },
      {
        id: "m2",
        parent_id: "c1",
        branch: "yes",
        sort_order: 0,
        step_type: "email",
        delay_ms: 0,
        email_id: "e2",
        condition_kind: "custom",
        condition_label: "",
      },
      {
        id: "w2",
        parent_id: "c1",
        branch: "no",
        sort_order: 0,
        step_type: "wait",
        delay_ms: delayToMs(2, "days"),
        email_id: null,
        condition_kind: "custom",
        condition_label: "",
      },
      {
        id: "m3",
        parent_id: "c1",
        branch: "no",
        sort_order: 1,
        step_type: "email",
        delay_ms: 0,
        email_id: "e3",
        condition_kind: "custom",
        condition_label: "",
      },
    ],
  });

  assert.equal(tree.nodes.length, 3);
  assert.equal(tree.nodes[0]?.type, "wait");
  assert.equal(tree.nodes[1]?.type, "email");
  const fork = tree.nodes[2];
  assert.equal(fork?.type, "condition");
  if (fork?.type !== "condition") return;
  assert.equal(fork.label, "Clicked the booking link?");
  assert.equal(fork.yes.length, 1);
  assert.equal(fork.no.length, 2);
  assert.equal(fork.yes[0]?.type, "email");
  assert.equal(fork.no[0]?.type, "wait");
  assert.equal(fork.no[1]?.type, "email");
});

test("blank trigger falls back to the kind label", () => {
  const tree = buildAutomationTree({
    triggerLabel: "  ",
    triggerKind: "form",
    emails: [],
  });
  assert.equal(tree.trigger.label, "Form submitted");
  assert.equal(tree.nodes.length, 0);
});

test("atLabel reads as a spot on the calendar, not a duration", () => {
  assert.equal(atLabel(0), "Day 0");
  assert.equal(atLabel(delayToMs(1, "days")), "Day 1");
  assert.equal(atLabel(delayToMs(9, "days")), "Day 9");
  assert.equal(atLabel(delayToMs(2, "hours")), "2 hrs in");
  assert.equal(atLabel(delayToMs(1, "hours")), "1 hr in");
  assert.equal(atLabel(delayToMs(30, "minutes")), "30 mins in");
  assert.equal(
    atLabel(delayToMs(3, "days") + delayToMs(4, "hours")),
    "Day 3 · 4h"
  );
});

test("waits accumulate down the path so every email knows its day", () => {
  const step = (
    id: string,
    order: number,
    type: string,
    extra: Record<string, unknown> = {}
  ) => ({
    id,
    parent_id: null,
    branch: "",
    sort_order: order,
    step_type: type,
    delay_ms: 0,
    email_id: null,
    condition_kind: "custom",
    condition_label: "",
    ...extra,
  });

  const tree = buildAutomationTree({
    triggerKind: "tag",
    emails: [
      { id: "e1", title: "One" },
      { id: "e2", title: "Two" },
      { id: "e3", title: "Three" },
    ],
    steps: [
      step("m1", 0, "email", { email_id: "e1" }),
      step("w1", 1, "wait", { delay_ms: delayToMs(3, "days") }),
      step("m2", 2, "email", { email_id: "e2" }),
      step("w2", 3, "wait", { delay_ms: delayToMs(2, "days") }),
      step("m3", 4, "email", { email_id: "e3" }),
    ],
  });

  assert.deepEqual(
    tree.nodes.map((node) => node.atMs),
    [
      0,
      delayToMs(3, "days"),
      delayToMs(3, "days"),
      delayToMs(5, "days"),
      delayToMs(5, "days"),
    ]
  );
});

test("a branch counts from the split, and the summary takes the longest path", () => {
  const tree = buildAutomationTree({
    triggerKind: "form",
    emails: [
      { id: "e1", title: "Welcome" },
      { id: "e2", title: "Clicked" },
      { id: "e3", title: "Did not click" },
    ],
    steps: [
      {
        id: "w1",
        parent_id: null,
        branch: "",
        sort_order: 0,
        step_type: "wait",
        delay_ms: delayToMs(1, "days"),
        email_id: null,
        condition_kind: "custom",
        condition_label: "",
      },
      {
        id: "c1",
        parent_id: null,
        branch: "",
        sort_order: 1,
        step_type: "condition",
        delay_ms: 0,
        email_id: null,
        condition_kind: "clicked",
        condition_label: "Clicked?",
      },
      {
        id: "m2",
        parent_id: "c1",
        branch: "yes",
        sort_order: 0,
        step_type: "email",
        delay_ms: 0,
        email_id: "e2",
        condition_kind: "custom",
        condition_label: "",
      },
      {
        id: "w2",
        parent_id: "c1",
        branch: "no",
        sort_order: 0,
        step_type: "wait",
        delay_ms: delayToMs(4, "days"),
        email_id: null,
        condition_kind: "custom",
        condition_label: "",
      },
      {
        id: "m3",
        parent_id: "c1",
        branch: "no",
        sort_order: 1,
        step_type: "email",
        delay_ms: 0,
        email_id: "e3",
        condition_kind: "custom",
        condition_label: "",
      },
    ],
  });

  const fork = tree.nodes[1];
  assert.equal(fork?.type, "condition");
  if (fork?.type !== "condition") return;
  // Both branches start the day the split happens.
  assert.equal(fork.atMs, delayToMs(1, "days"));
  assert.equal(fork.yes[0]?.atMs, delayToMs(1, "days"));
  assert.equal(fork.no[1]?.atMs, delayToMs(5, "days"));

  const summary = summarizeFlow(tree.nodes);
  assert.equal(summary.emails, 2);
  assert.equal(summary.spanMs, delayToMs(5, "days"));
});

test("the legacy per-email delay path also accumulates", () => {
  const tree = buildAutomationTree({
    triggerKind: "tag",
    emails: [
      { id: "e1", title: "One", delay_ms: 0 },
      { id: "e2", title: "Two", delay_ms: delayToMs(3, "days") },
      { id: "e3", title: "Three", delay_ms: delayToMs(4, "days") },
    ],
  });
  const summary = summarizeFlow(tree.nodes);
  assert.equal(summary.emails, 3);
  assert.equal(summary.spanMs, delayToMs(7, "days"));
});
