import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import { isValidPerson } from "@/lib/forecast";
import { runForecastPlan } from "@/lib/forecast-plan-run";

type Params = { params: Promise<{ person: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Fill this person's week from their Basecamp assignments, plus Michael's
// standing blocks (leadership, outreach, campaign audits). Incomplete work
// already on the calendar can be moved to make room for 10:00 leadership or
// to get a to-do off its due date. Finished rows stay put.
export async function POST(request: Request, { params }: Params) {
  const { person } = await params;
  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidPerson(person)) {
    return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const week = typeof body.week === "string" ? body.week : "";
  if (week && !DATE_RE.test(week)) {
    return NextResponse.json({ error: "week must be YYYY-MM-DD" }, { status: 400 });
  }
  const today = typeof body.today === "string" ? body.today : "";
  if (today && !DATE_RE.test(today)) {
    return NextResponse.json({ error: "today must be YYYY-MM-DD" }, { status: 400 });
  }

  const result = await runForecastPlan({
    person,
    week: week || undefined,
    today: today || undefined,
    dryRun: body.dryRun === true,
  });

  return NextResponse.json({
    week: result.week,
    created: result.created,
    moved: result.moved,
    skipped: result.skipped,
    canUndo: result.canUndo,
    unplaced: result.unplaced,
    note: result.note,
    assignmentsReason: result.assignmentsReason,
    dryRun: result.dryRun,
    blocks: result.blocks,
  });
}
