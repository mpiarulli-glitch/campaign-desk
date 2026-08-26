import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import {
  WEEKLY_CAPACITY_HOURS,
  createTask,
  getWeekNote,
  hasPlanUndo,
  isValidPerson,
  listTasksForPersonWeek,
  loggedHoursByDate,
  personLabel,
  reorderDayTasks,
  upsertWeekNote,
} from "@/lib/forecast";
import { bookTypedMeetingOnBasecamp } from "@/lib/forecast-schedule";
import { parseTimeInput } from "@/lib/forecast-time";
import { addWeeks, currentWeek } from "@/lib/week";

type Params = { params: Promise<{ person: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request, { params }: Params) {
  const { person } = await params;
  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidPerson(person)) {
    return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  }
  const url = new URL(request.url);
  const week = url.searchParams.get("week") || currentWeek();
  const tasks = listTasksForPersonWeek(person, week);
  const hours = tasks.reduce((sum, t) => sum + t.hours, 0);
  // Logged totals are keyed by the day the hours were written, not where the
  // task currently sits — so a Monday log still counts on Monday after a move.
  const loggedByDate = loggedHoursByDate(person, week, addWeeks(week, 1));
  return NextResponse.json({
    person,
    label: personLabel(person),
    week,
    tasks,
    hours,
    loggedByDate,
    capacity: WEEKLY_CAPACITY_HOURS,
    allocationPct: Math.round((hours / WEEKLY_CAPACITY_HOURS) * 100),
    note: getWeekNote(person, week),
    canUndoPlan: hasPlanUndo(person, week),
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const { person } = await params;
  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidPerson(person)) {
    return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));

  // { taskDate, order: [id, ...] } rearranges that day's list, and will move a
  // named task onto this date if it currently lives on another.
  if (Array.isArray(body.order)) {
    const taskDate = typeof body.taskDate === "string" ? body.taskDate : "";
    if (!DATE_RE.test(taskDate)) {
      return NextResponse.json({ error: "taskDate must be YYYY-MM-DD" }, { status: 400 });
    }
    const order = body.order.filter((id: unknown): id is string => typeof id === "string");
    if (order.length === 0) {
      return NextResponse.json({ error: "order must list at least one task" }, { status: 400 });
    }
    const ok = reorderDayTasks(person, taskDate, order);
    if (!ok) {
      return NextResponse.json({ error: "Could not reorder those tasks" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  const week = typeof body.week === "string" ? body.week : "";
  if (!DATE_RE.test(week)) {
    return NextResponse.json({ error: "week must be YYYY-MM-DD" }, { status: 400 });
  }
  const note = typeof body.note === "string" ? upsertWeekNote(person, week, body.note) : getWeekNote(person, week);
  return NextResponse.json({ note });
}

export async function POST(request: Request, { params }: Params) {
  const { person } = await params;
  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidPerson(person)) {
    return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const taskDate = typeof body.taskDate === "string" ? body.taskDate : "";
  if (!DATE_RE.test(taskDate)) {
    return NextResponse.json({ error: "taskDate must be YYYY-MM-DD" }, { status: 400 });
  }
  const hours = Number(body.hours);
  if (!Number.isFinite(hours) || hours <= 0) {
    return NextResponse.json({ error: "hours must be a positive number" }, { status: 400 });
  }
  const startRaw = typeof body.startTime === "string" ? body.startTime : "";
  const startTime = parseTimeInput(startRaw);
  if (startRaw.trim() && !startTime) {
    return NextResponse.json({ error: "startTime must be a time" }, { status: 400 });
  }
  const notes = typeof body.notes === "string" ? body.notes : "";
  const client = typeof body.client === "string" ? body.client : "";
  const kind = body.kind === "meeting" ? "meeting" : "work";
  let eventId =
    typeof body.basecampEventId === "string" ? body.basecampEventId : "";
  let projectId =
    typeof body.basecampProjectId === "string" ? body.basecampProjectId : "";
  // Optional: a client already chosen at add time can still write the calendar
  // entry immediately. Completing a typed meeting without one asks then.
  if (body.createScheduleEntry === true && !eventId.trim()) {
    const booked = await bookTypedMeetingOnBasecamp({
      person,
      taskDate,
      startTime,
      hours,
      title: notes,
      clientId: typeof body.clientId === "string" ? body.clientId : "",
      clientName: client,
      basecampProjectId: projectId,
    });
    if (!booked.ok) {
      return NextResponse.json(
        { error: booked.error, needsBasecamp: booked.needsBasecamp },
        { status: booked.status }
      );
    }
    eventId = booked.eventId;
    projectId = booked.projectId;
  }
  const task = createTask({
    person,
    taskDate,
    client,
    notes,
    hours,
    color: typeof body.color === "string" ? body.color : undefined,
    // Present only when the task text came from the Basecamp todo picker.
    basecampTodoId: typeof body.basecampTodoId === "string" ? body.basecampTodoId : "",
    // Present as well when the picked item was a subtask, in which case
    // basecampTodoId is its parent to-do — see createTask.
    basecampStepId: typeof body.basecampStepId === "string" ? body.basecampStepId : "",
    basecampProjectId: projectId,
    // Present instead when it came from the meeting picker, or after a typed
    // meeting was written onto that project's Basecamp calendar.
    basecampEventId: eventId,
    kind: eventId || kind === "meeting" ? "meeting" : "work",
    startTime,
  });
  return NextResponse.json({ task }, { status: 201 });
}
