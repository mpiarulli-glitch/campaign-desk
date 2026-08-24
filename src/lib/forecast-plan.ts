// Build a week of forecast rows from Basecamp assignments and a few standing
// blocks (leadership, outreach, campaign audits).
//
// Pure: no DB, no Basecamp. The run-layer fetches assignments and writes the
// rows this returns. Kept separate so the rules can be tested against a fake
// week without standing up SQLite or an OAuth token.
//
// Rules, as used for Michael's Monday plan:
//   • work a to-do at least one weekday before it is due
//   • every task is an hour unless it is "upload email" or "authenticate domain"
//     (those take ten minutes, stored as a 15-minute calendar slot)
//   • leadership meetings Mon/Wed/Fri at 10:00 — always, even if that means
//     sliding something else out of the way
//   • at least 3 hours of MEG cold + warm outreach, as one focus block
//   • leave a hour a day for campaign audits, updates, and check-ins
//   • do not land on lunch (12–1) or past 5pm, and do not overfill an 8-hour day
//
// Incomplete work already on the week can be moved when that is what gets
// leadership onto 10:00, a to-do off its due date, or the outreach block a
// contiguous afternoon. Finished rows, running timers, and Basecamp meetings
// (other than leadership) stay where they are.

import {
  bookedRecordingIds,
  queueTodoLinkage,
  queueTodoNotes,
} from "./forecast-queue";
import {
  addHoursToTime,
  CAL_SNAP_MINUTES,
  minutesFromMidnight,
  minutesToTime,
} from "./forecast-time";
import { addWeeks, weekLabel } from "./week";

export const DEFAULT_TASK_HOURS = 1;
// Ten minutes of work, rounded up to the calendar's 15-minute snap so a block
// still has a height on the grid. The estimate is the snap, not a 10-minute
// timer — Forecast cannot place a block between quarter-hours.
export const QUICK_TASK_HOURS = CAL_SNAP_MINUTES / 60;
export const DAY_CAPACITY_HOURS = 8;
export const AUDIT_HOURS = 1;
export const OUTREACH_HOURS = 3;
export const COLD_OUTREACH_HOURS = 1.5;
export const WARM_OUTREACH_HOURS = 1.5;
export const LEADERSHIP_START = "10:00";

export const DAY_START_MIN = 8 * 60;
export const DAY_END_MIN = 17 * 60;
export const LUNCH_START_MIN = 12 * 60;
export const LUNCH_END_MIN = 13 * 60;

export const LEADERSHIP_NOTES = "Leadership meeting";
export const COLD_OUTREACH_NOTES = "MEG cold outreach";
export const WARM_OUTREACH_NOTES = "MEG warm outreach";
export const AUDIT_NOTES = "Campaign audit, updates & check-in";
export const LEADERSHIP_CLIENT = "Empire Leadership HQ";
export const MEG_CLIENT = "MEG";

export const WEEK_NOTE_PREFIX = "Weekly plan";

export type PlanAssignment = {
  id: string;
  title: string;
  kind: "todo" | "card" | "step";
  projectId: string;
  projectName: string;
  clientName: string;
  dueOn: string | null;
  parentId?: string;
  parentTitle?: string;
};

export type PlanExisting = {
  id?: string;
  notes: string;
  client: string;
  taskDate: string;
  startTime: string;
  hours: number;
  basecampTodoId: string;
  basecampStepId: string;
  basecampEventId?: string;
  basecampProjectId?: string;
  color?: string;
  completed?: boolean;
  timerRunning?: boolean;
};

export type PlannedKind = "leadership" | "outreach" | "audit" | "todo";

export type PlannedBlock = {
  taskDate: string;
  startTime: string;
  hours: number;
  client: string;
  notes: string;
  color: string;
  basecampTodoId: string;
  basecampStepId: string;
  basecampProjectId: string;
  kind: PlannedKind;
  // Set when this block is an existing forecast row that should be moved (or
  // left in place if the slot already matches).
  existingId?: string;
};

export type PlanWeekInput = {
  weekStart: string;
  today: string;
  assignments: PlanAssignment[];
  existing: PlanExisting[];
  // Standing meetings + MEG outreach. Off for anyone who is not Michael —
  // those blocks are his week, not a team-wide template.
  includeOwnerRoutines: boolean;
};

export type PlanWeekResult = {
  blocks: PlannedBlock[];
  note: string;
  unplaced: Array<{ title: string; dueOn: string | null; reason: string }>;
};

export type PlanDiff = {
  create: PlannedBlock[];
  move: PlannedBlock[];
  unchanged: number;
};

type Occupied = { start: number; end: number };

type WorkItem = {
  existingId?: string;
  hours: number;
  client: string;
  notes: string;
  dueOn: string | null;
  projectId: string;
  basecampTodoId: string;
  basecampStepId: string;
  color: string;
};

export function estimateTaskHours(title: string): number {
  const t = (title || "").toLowerCase();
  if (
    /upload\s+(the\s+)?emails?/.test(t) ||
    /authenticat(?:e|ing)\s+(the\s+)?domain/.test(t)
  ) {
    return QUICK_TASK_HOURS;
  }
  return DEFAULT_TASK_HOURS;
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + n);
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function planWeekdays(weekStart: string): string[] {
  return [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i));
}

function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1).getDay();
}

// The last weekday strictly before `ymd`. Saturday/Sunday due dates land on
// the Friday before, so "a day before" never means the weekend.
export function previousWeekday(ymd: string): string {
  let cursor = addDays(ymd, -1);
  for (let i = 0; i < 3; i++) {
    const day = weekdayOf(cursor);
    if (day !== 0 && day !== 6) return cursor;
    cursor = addDays(cursor, -1);
  }
  return cursor;
}

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

function durationMinutes(hours: number): number {
  return Math.max(CAL_SNAP_MINUTES, Math.round(hours * 60));
}

export function findSlot(
  occupied: Occupied[],
  hours: number,
  preferStart?: string
): string {
  const span = durationMinutes(hours);
  const candidates: number[] = [];
  if (preferStart) {
    const prefer = minutesFromMidnight(preferStart);
    if (prefer != null) candidates.push(prefer);
  }
  for (let start = DAY_START_MIN; start + span <= DAY_END_MIN; start += CAL_SNAP_MINUTES) {
    if (!candidates.includes(start)) candidates.push(start);
  }

  for (const start of candidates) {
    const end = start + span;
    if (start < DAY_START_MIN || end > DAY_END_MIN) continue;
    if (overlaps(start, end, LUNCH_START_MIN, LUNCH_END_MIN)) continue;
    if (occupied.some((o) => overlaps(start, end, o.start, o.end))) continue;
    return minutesToTime(start);
  }
  return "";
}

function occupy(occupied: Occupied[], startTime: string, hours: number) {
  const start = minutesFromMidnight(startTime);
  if (start == null) return;
  occupied.push({ start, end: start + durationMinutes(hours) });
}

function notesMatch(value: string, expected: string): boolean {
  return (value || "").trim().toLowerCase() === expected.toLowerCase();
}

export function isLeadershipNotes(notes: string): boolean {
  return /\bleadership\b/i.test(notes || "");
}

function isColdOutreachNotes(notes: string): boolean {
  return notesMatch(notes, COLD_OUTREACH_NOTES) || /cold outreach/i.test(notes || "");
}

function isWarmOutreachNotes(notes: string): boolean {
  return notesMatch(notes, WARM_OUTREACH_NOTES) || /warm outreach/i.test(notes || "");
}

function isAuditNotes(notes: string): boolean {
  return notesMatch(notes, AUDIT_NOTES) || /campaign audit/i.test(notes || "");
}

function isStandingNotes(notes: string): boolean {
  return (
    isLeadershipNotes(notes) ||
    isColdOutreachNotes(notes) ||
    isWarmOutreachNotes(notes) ||
    isAuditNotes(notes)
  );
}

function isPinned(task: PlanExisting, earliest: string): boolean {
  if (task.completed) return true;
  if (task.timerRunning) return true;
  if (task.taskDate < earliest) return true;
  // Real Basecamp meetings keep their time, except leadership, which we will
  // slide onto 10:00 if it is already on the week.
  if (task.basecampEventId && !isLeadershipNotes(task.notes)) return true;
  return false;
}

function takeExisting(
  pool: PlanExisting[],
  predicate: (task: PlanExisting) => boolean
): PlanExisting | undefined {
  const index = pool.findIndex(predicate);
  if (index < 0) return undefined;
  return pool.splice(index, 1)[0];
}

function workItems(assignments: PlanAssignment[]): PlanAssignment[] {
  // When a to-do has open subtasks, the subtasks are the work. Scheduling the
  // parent as well would double-count the same job.
  const parentsWithSteps = new Set(
    assignments
      .filter((a) => a.kind === "step" && a.parentId)
      .map((a) => a.parentId as string)
  );
  return assignments.filter((a) => a.kind === "step" || !parentsWithSteps.has(a.id));
}

function sortWork(items: WorkItem[], today: string): WorkItem[] {
  return [...items].sort((a, b) => {
    const aDue = a.dueOn || "";
    const bDue = b.dueOn || "";
    const aOver = Boolean(aDue && aDue <= today);
    const bOver = Boolean(bDue && bDue <= today);
    if (aOver !== bOver) return aOver ? -1 : 1;
    if (aDue && bDue && aDue !== bDue) return aDue.localeCompare(bDue);
    if (aDue !== bDue) return aDue ? -1 : 1;
    return a.notes.localeCompare(b.notes);
  });
}

function clampToWeek(date: string, days: string[], earliest: string): string | null {
  if (!days.includes(date)) {
    if (date < days[0]) return earliest;
    return null;
  }
  return date < earliest ? earliest : date;
}

type DayState = { occupied: Occupied[]; hours: number };

function placeBlock(
  days: Record<string, DayState>,
  date: string,
  hours: number,
  preferStart: string | undefined,
  remainingBudget: number
): string {
  if (hours > remainingBudget + 1e-9) return "";
  const slot = findSlot(days[date].occupied, hours, preferStart);
  if (!slot) return "";
  occupy(days[date].occupied, slot, hours);
  days[date].hours += hours;
  return slot;
}

function formatRange(startTime: string, hours: number): string {
  const end = addHoursToTime(startTime, hours);
  const pretty = (hhmm: string) => {
    const mins = minutesFromMidnight(hhmm);
    if (mins == null) return hhmm;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return m ? `${h12}:${String(m).padStart(2, "0")} ${period}` : `${h12} ${period}`;
  };
  return end ? `${pretty(startTime)}–${pretty(end)}` : pretty(startTime);
}

function assignmentFor(task: PlanExisting, assignments: PlanAssignment[]): PlanAssignment | undefined {
  const ids = [task.basecampStepId, task.basecampTodoId].filter(Boolean);
  return assignments.find((a) => ids.includes(a.id));
}

function workFromExisting(task: PlanExisting, assignments: PlanAssignment[]): WorkItem {
  const match = assignmentFor(task, assignments);
  const link = match
    ? queueTodoLinkage(match)
    : { basecampTodoId: task.basecampTodoId, basecampStepId: task.basecampStepId };
  return {
    existingId: task.id,
    hours: task.hours || estimateTaskHours(task.notes),
    client: task.client || match?.clientName || match?.projectName || "",
    notes: task.notes || (match ? queueTodoNotes(match) : ""),
    dueOn: match?.dueOn || null,
    projectId: task.basecampProjectId || match?.projectId || "",
    basecampTodoId: link.basecampTodoId,
    basecampStepId: link.basecampStepId,
    color: task.color || "blue",
  };
}

export function planWeek(input: PlanWeekInput): PlanWeekResult {
  const daysList = planWeekdays(input.weekStart);
  const weekEnd = addWeeks(input.weekStart, 1);
  const earliest =
    input.today > daysList[4]
      ? daysList[0]
      : input.today < daysList[0]
        ? daysList[0]
        : daysList.includes(input.today)
          ? input.today
          : daysList[0];

  const pinned: PlanExisting[] = [];
  const movable: PlanExisting[] = [];
  for (const task of input.existing) {
    (isPinned(task, earliest) ? pinned : movable).push(task);
  }

  const days: Record<string, DayState> = {};
  for (const date of daysList) {
    const occupied: Occupied[] = [];
    let hours = 0;
    for (const t of pinned.filter((row) => row.taskDate === date)) {
      hours += Number(t.hours) || 0;
      if (t.startTime) occupy(occupied, t.startTime, t.hours);
    }
    days[date] = { occupied, hours };
  }

  const blocks: PlannedBlock[] = [];
  const unplaced: PlanWeekResult["unplaced"] = [];
  const leadershipPool = movable.filter((t) => isLeadershipNotes(t.notes));
  const coldPool = movable.filter((t) => isColdOutreachNotes(t.notes));
  const warmPool = movable.filter((t) => isWarmOutreachNotes(t.notes));
  const auditPool = movable.filter((t) => isAuditNotes(t.notes));

  function push(block: PlannedBlock) {
    blocks.push(block);
  }

  if (input.includeOwnerRoutines) {
    for (const date of daysList) {
      if (date < earliest) continue;
      const dow = weekdayOf(date);
      if (dow !== 1 && dow !== 3 && dow !== 5) continue;
      // Leadership is the one immovable appointment: 10:00 even if a pinned
      // meeting already sits there. Movable work has already been lifted, so
      // this is usually a free hour; overlapping a real Basecamp event is
      // still preferable to dropping the meeting.
      const start = findSlot(days[date].occupied, 1, LEADERSHIP_START) || LEADERSHIP_START;
      occupy(days[date].occupied, start, 1);
      days[date].hours += 1;
      const existing =
        takeExisting(leadershipPool, (t) => t.taskDate === date) ||
        takeExisting(leadershipPool, () => true);
      push({
        taskDate: date,
        startTime: start,
        hours: 1,
        client: existing?.client || LEADERSHIP_CLIENT,
        notes: existing?.notes || LEADERSHIP_NOTES,
        color: existing?.color || "violet",
        basecampTodoId: existing?.basecampTodoId || "",
        basecampStepId: existing?.basecampStepId || "",
        basecampProjectId: existing?.basecampProjectId || "",
        kind: "leadership",
        existingId: existing?.id,
      });
    }

    const preferDates = [
      daysList[1],
      daysList[3],
      daysList[2],
      daysList[4],
      daysList[0],
    ].filter((date) => date >= earliest);

    let placedOutreach = false;
    for (const date of preferDates) {
      const room = DAY_CAPACITY_HOURS - days[date].hours;
      if (room < OUTREACH_HOURS) continue;
      const coldStart = placeBlock(days, date, COLD_OUTREACH_HOURS, "13:00", room);
      if (!coldStart) continue;
      const warmStart = placeBlock(
        days,
        date,
        WARM_OUTREACH_HOURS,
        addHoursToTime(coldStart, COLD_OUTREACH_HOURS) || "14:30",
        DAY_CAPACITY_HOURS - days[date].hours
      );
      if (!warmStart) {
        const coldMin = minutesFromMidnight(coldStart);
        if (coldMin != null) {
          days[date].occupied = days[date].occupied.filter((o) => o.start !== coldMin);
          days[date].hours -= COLD_OUTREACH_HOURS;
        }
        continue;
      }
      const coldExisting = takeExisting(coldPool, () => true);
      const warmExisting = takeExisting(warmPool, () => true);
      push({
        taskDate: date,
        startTime: coldStart,
        hours: COLD_OUTREACH_HOURS,
        client: coldExisting?.client || MEG_CLIENT,
        notes: coldExisting?.notes || COLD_OUTREACH_NOTES,
        color: coldExisting?.color || "green",
        basecampTodoId: "",
        basecampStepId: "",
        basecampProjectId: coldExisting?.basecampProjectId || "",
        kind: "outreach",
        existingId: coldExisting?.id,
      });
      push({
        taskDate: date,
        startTime: warmStart,
        hours: WARM_OUTREACH_HOURS,
        client: warmExisting?.client || MEG_CLIENT,
        notes: warmExisting?.notes || WARM_OUTREACH_NOTES,
        color: warmExisting?.color || "green",
        basecampTodoId: "",
        basecampStepId: "",
        basecampProjectId: warmExisting?.basecampProjectId || "",
        kind: "outreach",
        existingId: warmExisting?.id,
      });
      placedOutreach = true;
      break;
    }
    if (!placedOutreach) {
      unplaced.push({
        title: "MEG cold + warm outreach",
        dueOn: null,
        reason: "no 3-hour focus block left this week",
      });
    }
  }

  const already = bookedRecordingIds(
    input.existing.map((t) => ({
      basecamp_todo_id: t.basecampTodoId,
      basecamp_step_id: t.basecampStepId,
    }))
  );
  const movableWork = movable.filter((t) => !isStandingNotes(t.notes));
  const work: WorkItem[] = movableWork.map((t) => workFromExisting(t, input.assignments));
  for (const todo of workItems(input.assignments)) {
    if (already.has(todo.id)) continue;
    const link = queueTodoLinkage(todo);
    const overdue = Boolean(todo.dueOn && todo.dueOn < input.today);
    work.push({
      hours: estimateTaskHours(todo.title),
      client: todo.clientName || todo.projectName,
      notes: queueTodoNotes(todo),
      dueOn: todo.dueOn,
      projectId: todo.projectId,
      basecampTodoId: link.basecampTodoId,
      basecampStepId: link.basecampStepId,
      color: overdue ? "amber" : "blue",
    });
  }

  for (const item of sortWork(work, input.today)) {
    const dueOn = item.dueOn;
    const dueThisHorizon = !dueOn || dueOn < addDays(weekEnd, 7);
    if (!dueThisHorizon) {
      if (item.existingId) {
        unplaced.push({
          title: item.notes,
          dueOn,
          reason: "due too far out to keep on this week",
        });
      }
      continue;
    }

    const mustDoSoon = Boolean(dueOn && dueOn <= input.today);
    const latest = dueOn
      ? clampToWeek(previousWeekday(dueOn), daysList, earliest)
      : daysList[4];
    const latestDay = latest || earliest;

    const tryDates: string[] = [];
    if (mustDoSoon) {
      for (const date of daysList) if (date >= earliest) tryDates.push(date);
    } else {
      for (let i = daysList.indexOf(latestDay); i >= 0; i--) {
        if (daysList[i] >= earliest) tryDates.push(daysList[i]);
      }
    }

    let placedOn = "";
    let start = "";
    for (const date of tryDates) {
      const keepAudit = mustDoSoon ? 0 : AUDIT_HOURS;
      const budget = DAY_CAPACITY_HOURS - days[date].hours - keepAudit;
      start = placeBlock(days, date, item.hours, undefined, budget);
      if (start) {
        placedOn = date;
        break;
      }
    }

    if (!placedOn) {
      unplaced.push({
        title: item.notes,
        dueOn,
        reason:
          mustDoSoon || !dueOn
            ? "no room left this week"
            : "would have landed on or after the due date",
      });
      continue;
    }

    const overdue = Boolean(dueOn && dueOn < input.today);
    push({
      taskDate: placedOn,
      startTime: start,
      hours: item.hours,
      client: item.client,
      notes: item.notes,
      color: overdue ? "amber" : item.color || "blue",
      basecampTodoId: item.basecampTodoId,
      basecampStepId: item.basecampStepId,
      basecampProjectId: item.projectId,
      kind: "todo",
      existingId: item.existingId,
    });
  }

  for (const date of daysList) {
    if (date < earliest) continue;
    const budget = DAY_CAPACITY_HOURS - days[date].hours;
    if (budget < AUDIT_HOURS) continue;
    const start = placeBlock(days, date, AUDIT_HOURS, "16:00", budget);
    if (!start) continue;
    const existing =
      takeExisting(auditPool, (t) => t.taskDate === date) ||
      takeExisting(auditPool, () => true);
    push({
      taskDate: date,
      startTime: start,
      hours: AUDIT_HOURS,
      client: existing?.client || MEG_CLIENT,
      notes: existing?.notes || AUDIT_NOTES,
      color: existing?.color || "teal",
      basecampTodoId: "",
      basecampStepId: "",
      basecampProjectId: existing?.basecampProjectId || "",
      kind: "audit",
      existingId: existing?.id,
    });
  }

  return {
    blocks,
    note: buildWeekNote(input.weekStart, blocks, unplaced),
    unplaced,
  };
}

function buildWeekNote(
  weekStart: string,
  blocks: PlannedBlock[],
  unplaced: PlanWeekResult["unplaced"]
): string {
  const lines: string[] = [
    `${WEEK_NOTE_PREFIX} · ${weekLabel(weekStart)}`,
    "Work is booked at least a weekday before each due date. Upload-email and authenticate-domain tasks are 15 minutes; everything else is an hour. Leadership meetings stay at 10:00 Mon/Wed/Fri.",
  ];

  const leadership = blocks.filter((b) => b.kind === "leadership");
  if (leadership.length) {
    lines.push(
      `Leadership meetings: ${leadership
        .map((b) => `${weekdayName(b.taskDate)} ${b.startTime === "10:00" ? "10:00" : b.startTime}`)
        .join(", ")}.`
    );
  }

  const outreach = blocks.filter((b) => b.kind === "outreach");
  if (outreach.length) {
    const first = outreach[0];
    const hours = outreach.reduce((s, b) => s + b.hours, 0);
    lines.push(
      `MEG outreach: ${hours}h on ${weekdayName(first.taskDate)} (${formatRange(
        first.startTime,
        hours
      )}).`
    );
  }

  const audits = blocks.filter((b) => b.kind === "audit");
  if (audits.length) {
    lines.push(
      `Campaign audit / updates / check-in: ${audits.length}h held across the week.`
    );
  }

  const todos = blocks.filter((b) => b.kind === "todo");
  if (todos.length) {
    lines.push(`Basecamp to-dos placed: ${todos.length}.`);
  }

  if (unplaced.length) {
    lines.push(
      `Left unplaced: ${unplaced
        .map((u) => `${u.title}${u.dueOn ? ` (due ${u.dueOn})` : ""} — ${u.reason}`)
        .join("; ")}.`
    );
  }

  return lines.join("\n");
}

function weekdayName(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString("en-US", {
    weekday: "short",
  });
}

export function isPlannerNote(body: string): boolean {
  return (body || "").trim().startsWith(WEEK_NOTE_PREFIX);
}

function sameSlot(block: PlannedBlock, task: PlanExisting): boolean {
  return task.taskDate === block.taskDate && (task.startTime || "") === (block.startTime || "");
}

function matchExisting(block: PlannedBlock, existing: PlanExisting[]): PlanExisting | undefined {
  if (block.existingId) {
    const byId = existing.find((t) => t.id === block.existingId);
    if (byId) return byId;
  }
  if (block.basecampStepId) {
    const byStep = existing.find((t) => t.basecampStepId === block.basecampStepId);
    if (byStep) return byStep;
  }
  if (block.basecampTodoId) {
    const byTodo = existing.find(
      (t) => !t.basecampStepId && t.basecampTodoId === block.basecampTodoId
    );
    if (byTodo) return byTodo;
  }
  return existing.find(
    (t) => t.taskDate === block.taskDate && notesMatch(t.notes, block.notes)
  );
}

export function diffPlannedBlocks(
  planned: PlannedBlock[],
  existing: PlanExisting[]
): PlanDiff {
  const used = new Set<string>();
  const create: PlannedBlock[] = [];
  const move: PlannedBlock[] = [];
  let unchanged = 0;

  for (const block of planned) {
    const match = matchExisting(
      block,
      existing.filter((t) => !t.id || !used.has(t.id))
    );
    if (!match) {
      create.push(block);
      continue;
    }
    if (match.id) used.add(match.id);
    if (sameSlot(block, match)) {
      unchanged += 1;
      continue;
    }
    move.push({ ...block, existingId: match.id || block.existingId });
  }

  return { create, move, unchanged };
}
