// Apply a planned week to one person's forecast: read their Basecamp
// assignments, run the planner, create missing rows and move existing ones
// when that is what gets leadership onto 10:00 or a to-do off its due date.
//
// Finished rows, running timers, and Basecamp meetings other than leadership
// are left alone. Clicking twice is still safe: a row already in the right
// slot is skipped.

import {
  asPerson,
  basecampConnected,
  hasConnection,
  listMyAssignments,
} from "./basecamp";
import { listRevClients } from "./revenue";
import {
  createTask,
  getWeekNote,
  listTasksForPersonWeek,
  savePlanUndo,
  updateTask,
  upsertWeekNote,
} from "./forecast";
import {
  diffPlannedBlocks,
  isPlannerNote,
  planWeek,
  type PlanAssignment,
  type PlanExisting,
  type PlanWeekResult,
} from "./forecast-plan";
import { OWNER_SLUG } from "./people";
import { currentWeek } from "./week";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function todayInAppZone(now = new Date()): string {
  const tz = process.env.APP_TIME_ZONE || "America/Los_Angeles";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

async function loadAssignments(person: string): Promise<{
  assignments: PlanAssignment[];
  reason: string | null;
}> {
  if (!basecampConnected()) {
    return { assignments: [], reason: "not-connected" };
  }
  if (!hasConnection(person)) {
    return { assignments: [], reason: "person-not-connected" };
  }

  const rows = await listMyAssignments(asPerson(person));
  const byProject = new Map<string, string>();
  for (const c of listRevClients(true)) {
    const pid = (c.basecamp_project_id || "").trim();
    if (pid) byProject.set(pid, c.name);
  }

  return {
    assignments: rows.map((r) => ({
      id: r.id,
      title: r.title,
      kind: r.kind,
      projectId: r.projectId,
      projectName: r.projectName,
      clientName: byProject.get(r.projectId) || r.projectName,
      dueOn: r.dueOn,
      parentId: r.parentId,
      parentTitle: r.parentTitle,
    })),
    reason: rows.length ? null : "none-assigned",
  };
}

function asExisting(
  tasks: ReturnType<typeof listTasksForPersonWeek>
): PlanExisting[] {
  return tasks.map((t) => ({
    id: t.id,
    notes: t.notes,
    client: t.client,
    taskDate: t.task_date,
    startTime: t.start_time,
    hours: t.hours,
    basecampTodoId: t.basecamp_todo_id,
    basecampStepId: t.basecamp_step_id,
    basecampEventId: t.basecamp_event_id,
    basecampProjectId: t.basecamp_project_id,
    color: t.color,
    completed: Boolean(t.completed),
    timerRunning: Boolean(t.timer_started_at),
  }));
}

export interface RunForecastPlanInput {
  person: string;
  week?: string;
  today?: string;
  dryRun?: boolean;
}

export interface RunForecastPlanResult extends PlanWeekResult {
  person: string;
  week: string;
  today: string;
  created: number;
  moved: number;
  skipped: number;
  canUndo: boolean;
  assignmentsReason: string | null;
  dryRun: boolean;
}

export async function runForecastPlan(
  input: RunForecastPlanInput
): Promise<RunForecastPlanResult> {
  const week = input.week || currentWeek();
  if (!DATE_RE.test(week)) {
    throw new Error("week must be YYYY-MM-DD");
  }
  const today = input.today || todayInAppZone();
  const existingTasks = listTasksForPersonWeek(input.person, week);
  const existing = asExisting(existingTasks);
  const { assignments, reason } = await loadAssignments(input.person);

  const planned = planWeek({
    weekStart: week,
    today,
    assignments,
    existing,
    includeOwnerRoutines: input.person === OWNER_SLUG,
  });

  const diff = diffPlannedBlocks(planned.blocks, existing);
  let created = 0;
  let moved = 0;
  let canUndo = false;
  if (!input.dryRun) {
    const noteBefore = getWeekNote(input.person, week);
    const undoMoved = diff.move
      .map((block) => {
        const before = existingTasks.find((t) => t.id === block.existingId);
        if (!before) return null;
        return {
          id: before.id,
          taskDate: before.task_date,
          startTime: before.start_time || "",
        };
      })
      .filter((row): row is { id: string; taskDate: string; startTime: string } => Boolean(row));
    const createdIds: string[] = [];
    for (const block of diff.create) {
      const row = createTask({
        person: input.person,
        taskDate: block.taskDate,
        client: block.client,
        notes: block.notes,
        hours: block.hours,
        color: block.color,
        startTime: block.startTime,
        basecampTodoId: block.basecampTodoId,
        basecampStepId: block.basecampStepId,
        basecampProjectId: block.basecampProjectId,
      });
      createdIds.push(row.id);
      created += 1;
    }
    for (const block of diff.move) {
      if (!block.existingId) continue;
      updateTask(block.existingId, {
        taskDate: block.taskDate,
        startTime: block.startTime,
      });
      moved += 1;
    }

    if (!noteBefore.trim() || isPlannerNote(noteBefore)) {
      upsertWeekNote(input.person, week, planned.note);
    }
    savePlanUndo(input.person, week, {
      createdIds,
      moved: undoMoved,
      note: noteBefore,
    });
    canUndo = createdIds.length > 0 || undoMoved.length > 0;
  }

  return {
    ...planned,
    person: input.person,
    week,
    today,
    created: input.dryRun ? 0 : created,
    moved: input.dryRun ? 0 : moved,
    skipped: diff.unchanged,
    canUndo: input.dryRun ? false : canUndo,
    assignmentsReason: reason,
    dryRun: Boolean(input.dryRun),
  };
}
