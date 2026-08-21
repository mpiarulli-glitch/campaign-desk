import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAutomationTree,
  coercePresentation,
  coerceTriggerKind,
  delayLabel,
  delayToMs,
  splitDelay,
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
