import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIT_NOTES,
  COLD_OUTREACH_NOTES,
  DEFAULT_TASK_HOURS,
  LEADERSHIP_NOTES,
  QUICK_TASK_HOURS,
  WARM_OUTREACH_NOTES,
  WEEK_NOTE_PREFIX,
  addDays,
  blocksNotYetPlaced,
  estimateTaskHours,
  findSlot,
  isPlannerNote,
  planWeek,
  planWeekdays,
  previousWeekday,
  type PlanAssignment,
  type PlanExisting,
} from "../src/lib/forecast-plan";

const WEEK = "2026-08-24"; // Monday
const TODAY = "2026-08-24";

function todo(partial: Partial<PlanAssignment> & Pick<PlanAssignment, "id" | "title">): PlanAssignment {
  return {
    kind: "todo",
    projectId: "111",
    projectName: "Acme Growth OS",
    clientName: "Acme",
    dueOn: null,
    ...partial,
  };
}

test("upload email and authenticate domain are 15-minute slots; everything else is an hour", () => {
  assert.equal(estimateTaskHours("Upload email to Klaviyo"), QUICK_TASK_HOURS);
  assert.equal(estimateTaskHours("Upload the emails"), QUICK_TASK_HOURS);
  assert.equal(estimateTaskHours("Authenticate domain"), QUICK_TASK_HOURS);
  assert.equal(estimateTaskHours("Authenticating the domain in GHL"), QUICK_TASK_HOURS);
  assert.equal(estimateTaskHours("Build welcome flow"), DEFAULT_TASK_HOURS);
  assert.equal(QUICK_TASK_HOURS, 0.25);
});

test("previousWeekday skips the weekend so Saturday due dates land on Friday", () => {
  assert.equal(previousWeekday("2026-08-26"), "2026-08-25"); // Wed -> Tue
  assert.equal(previousWeekday("2026-08-24"), "2026-08-21"); // Mon -> Fri
  assert.equal(previousWeekday("2026-08-29"), "2026-08-28"); // Sat -> Fri
  assert.equal(previousWeekday("2026-08-30"), "2026-08-28"); // Sun -> Fri
});

test("findSlot skips lunch and already-occupied hours", () => {
  assert.equal(findSlot([], 1, "10:00"), "10:00");
  // 11:00–13:00 would cover lunch.
  assert.equal(findSlot([], 2, "11:00"), "08:00");
  const busy = [{ start: 10 * 60, end: 11 * 60 }];
  assert.equal(findSlot(busy, 1, "10:00"), "08:00");
  assert.equal(findSlot(busy, 1, "11:00"), "11:00");
});

test("planWeekdays is Mon–Fri of the keyed week", () => {
  assert.deepEqual(planWeekdays(WEEK), [
    "2026-08-24",
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
  ]);
});

test("owner week gets leadership at 10am, a 3h outreach block, and daily audits", () => {
  const { blocks } = planWeek({
    weekStart: WEEK,
    today: TODAY,
    assignments: [],
    existing: [],
    includeOwnerRoutines: true,
  });

  const leadership = blocks.filter((b) => b.notes === LEADERSHIP_NOTES);
  assert.deepEqual(
    leadership.map((b) => `${b.taskDate} ${b.startTime}`),
    ["2026-08-24 10:00", "2026-08-26 10:00", "2026-08-28 10:00"]
  );
  assert.ok(leadership.every((b) => b.hours === 1 && b.color === "violet"));

  const outreach = blocks.filter((b) => b.kind === "outreach");
  assert.equal(outreach.reduce((s, b) => s + b.hours, 0), 3);
  assert.equal(outreach[0].taskDate, "2026-08-25");
  assert.equal(outreach[0].startTime, "13:00");
  assert.equal(outreach[0].notes, COLD_OUTREACH_NOTES);
  assert.equal(outreach[1].notes, WARM_OUTREACH_NOTES);
  assert.equal(outreach[1].startTime, "14:30");

  const audits = blocks.filter((b) => b.notes === AUDIT_NOTES);
  assert.equal(audits.length, 5);
  assert.ok(audits.every((b) => b.startTime === "16:00" && b.hours === 1));
});

test("non-owner weeks do not invent leadership meetings or MEG outreach", () => {
  const { blocks } = planWeek({
    weekStart: WEEK,
    today: TODAY,
    assignments: [],
    existing: [],
    includeOwnerRoutines: false,
  });
  assert.equal(blocks.filter((b) => b.kind === "leadership" || b.kind === "outreach").length, 0);
  assert.ok(blocks.every((b) => b.kind === "audit"));
});

test("a to-do is booked the weekday before it is due", () => {
  const { blocks } = planWeek({
    weekStart: WEEK,
    today: TODAY,
    assignments: [todo({ id: "t1", title: "Build welcome flow", dueOn: "2026-08-26" })],
    existing: [],
    includeOwnerRoutines: true,
  });
  const work = blocks.find((b) => b.kind === "todo");
  assert.ok(work);
  assert.equal(work.taskDate, "2026-08-25");
  assert.equal(work.hours, 1);
  assert.equal(work.basecampTodoId, "t1");
  assert.equal(work.client, "Acme");
});

test("a Saturday due date is worked on Friday, not the weekend", () => {
  const { blocks } = planWeek({
    weekStart: WEEK,
    today: TODAY,
    assignments: [todo({ id: "t1", title: "Weekend send", dueOn: "2026-08-29" })],
    existing: [],
    includeOwnerRoutines: false,
  });
  const work = blocks.find((b) => b.kind === "todo");
  assert.equal(work?.taskDate, "2026-08-28");
});

test("overdue and due-today work lands first thing on the remaining week", () => {
  const { blocks } = planWeek({
    weekStart: WEEK,
    today: TODAY,
    assignments: [
      todo({ id: "late", title: "Finish last week's email", dueOn: "2026-08-21" }),
      todo({ id: "today", title: "Send the Monday campaign", dueOn: "2026-08-24" }),
    ],
    existing: [],
    includeOwnerRoutines: true,
  });
  const work = blocks.filter((b) => b.kind === "todo");
  assert.equal(work[0].taskDate, "2026-08-24");
  assert.equal(work[0].notes, "Finish last week's email");
  assert.equal(work[0].color, "amber");
  assert.equal(work[0].startTime, "08:00");
  assert.equal(work[1].notes, "Send the Monday campaign");
  assert.equal(work[1].taskDate, "2026-08-24");
  // Leadership holds 10:00, so the second hour is 09:00.
  assert.equal(work[1].startTime, "09:00");
});

test("upload-email tasks take a 15-minute slot instead of an hour", () => {
  const { blocks } = planWeek({
    weekStart: WEEK,
    today: TODAY,
    assignments: [todo({ id: "u1", title: "Upload email", dueOn: "2026-08-25" })],
    existing: [],
    includeOwnerRoutines: false,
  });
  const work = blocks.find((b) => b.kind === "todo");
  assert.equal(work?.hours, QUICK_TASK_HOURS);
  assert.equal(work?.taskDate, "2026-08-24");
});

test("open subtasks replace their parent so the same job is not booked twice", () => {
  const { blocks } = planWeek({
    weekStart: WEEK,
    today: TODAY,
    assignments: [
      todo({
        id: "parent",
        title: "Onboard client",
        dueOn: "2026-08-27",
      }),
      todo({
        id: "step1",
        title: "Authenticate domain",
        kind: "step",
        parentId: "parent",
        parentTitle: "Onboard client",
        dueOn: "2026-08-27",
      }),
      todo({
        id: "step2",
        title: "Build welcome flow",
        kind: "step",
        parentId: "parent",
        parentTitle: "Onboard client",
        dueOn: "2026-08-27",
      }),
    ],
    existing: [],
    includeOwnerRoutines: false,
  });
  const work = blocks.filter((b) => b.kind === "todo");
  assert.deepEqual(
    work.map((b) => b.notes),
    ["Onboard client › Authenticate domain", "Onboard client › Build welcome flow"]
  );
  assert.equal(work[0].basecampStepId, "step1");
  assert.equal(work[0].basecampTodoId, "parent");
  assert.equal(work[0].hours, QUICK_TASK_HOURS);
  assert.equal(work[1].hours, 1);
  assert.ok(work.every((b) => b.taskDate === "2026-08-26"));
});

test("already-booked Basecamp ids and standing titles are not duplicated", () => {
  const existing: PlanExisting[] = [
    {
      notes: "Build welcome flow",
      client: "Acme",
      taskDate: "2026-08-24",
      startTime: "08:00",
      hours: 1,
      basecampTodoId: "t1",
      basecampStepId: "",
    },
    {
      notes: LEADERSHIP_NOTES,
      client: "Empire Leadership HQ",
      taskDate: "2026-08-24",
      startTime: "10:00",
      hours: 1,
      basecampTodoId: "",
      basecampStepId: "",
    },
  ];
  const { blocks } = planWeek({
    weekStart: WEEK,
    today: TODAY,
    assignments: [todo({ id: "t1", title: "Build welcome flow", dueOn: "2026-08-26" })],
    existing,
    includeOwnerRoutines: true,
  });
  assert.equal(blocks.filter((b) => b.kind === "todo").length, 0);
  assert.equal(
    blocks.filter((b) => b.notes === LEADERSHIP_NOTES && b.taskDate === "2026-08-24").length,
    0
  );
  const leftover = blocksNotYetPlaced(blocks, existing);
  assert.equal(
    leftover.filter((b) => b.notes === LEADERSHIP_NOTES && b.taskDate === "2026-08-24").length,
    0
  );
});

test("a to-do is left unplaced rather than booked on its due date", () => {
  // Fill Monday so the Tuesday-due to-do cannot land a day early.
  const existing: PlanExisting[] = [];
  for (let h = 8; h <= 16; h++) {
    if (h === 12) continue;
    existing.push({
      notes: `Busy ${h}`,
      client: "Acme",
      taskDate: "2026-08-24",
      startTime: `${String(h).padStart(2, "0")}:00`,
      hours: 1,
      basecampTodoId: "",
      basecampStepId: "",
    });
  }
  const { blocks, unplaced } = planWeek({
    weekStart: WEEK,
    today: TODAY,
    assignments: [todo({ id: "t1", title: "Client email", dueOn: "2026-08-25" })],
    existing,
    includeOwnerRoutines: false,
  });
  assert.equal(blocks.filter((b) => b.kind === "todo").length, 0);
  assert.equal(unplaced.length, 1);
  assert.match(unplaced[0].reason, /due date/);
});

test("planning mid-week does not put work on days that have already passed", () => {
  const { blocks } = planWeek({
    weekStart: WEEK,
    today: "2026-08-26",
    assignments: [todo({ id: "t1", title: "Late email", dueOn: "2026-08-25" })],
    existing: [],
    includeOwnerRoutines: true,
  });
  assert.ok(blocks.every((b) => b.taskDate >= "2026-08-26"));
  const leadership = blocks.filter((b) => b.kind === "leadership");
  assert.deepEqual(
    leadership.map((b) => b.taskDate),
    ["2026-08-26", "2026-08-28"]
  );
});

test("the week note is tagged so a later run can replace it", () => {
  const { note } = planWeek({
    weekStart: WEEK,
    today: TODAY,
    assignments: [],
    existing: [],
    includeOwnerRoutines: true,
  });
  assert.ok(note.startsWith(WEEK_NOTE_PREFIX));
  assert.ok(isPlannerNote(note));
  assert.equal(isPlannerNote("PTO Thursday"), false);
});

test("addDays crosses month boundaries", () => {
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addDays("2026-08-24", 4), "2026-08-28");
});
