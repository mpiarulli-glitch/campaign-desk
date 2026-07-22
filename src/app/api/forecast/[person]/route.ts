import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import {
  WEEKLY_CAPACITY_HOURS,
  createTask,
  isValidPerson,
  listTasksForPersonWeek,
  personLabel,
} from "@/lib/forecast";
import { currentWeek } from "@/lib/week";

type Params = { params: Promise<{ person: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { person } = await params;
  if (!isValidPerson(person)) {
    return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  }
  const url = new URL(request.url);
  const week = url.searchParams.get("week") || currentWeek();
  const tasks = listTasksForPersonWeek(person, week);
  const hours = tasks.reduce((sum, t) => sum + t.hours, 0);
  return NextResponse.json({
    person,
    label: personLabel(person),
    week,
    tasks,
    hours,
    capacity: WEEKLY_CAPACITY_HOURS,
    allocationPct: Math.round((hours / WEEKLY_CAPACITY_HOURS) * 100),
  });
}

export async function POST(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { person } = await params;
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
  const task = createTask({
    person,
    taskDate,
    client: typeof body.client === "string" ? body.client : "",
    notes: typeof body.notes === "string" ? body.notes : "",
    hours,
  });
  return NextResponse.json({ task }, { status: 201 });
}
