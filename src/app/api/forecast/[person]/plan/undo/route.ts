import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import { applyPlanUndo, isValidPerson } from "@/lib/forecast";
import { currentWeek } from "@/lib/week";

type Params = { params: Promise<{ person: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request, { params }: Params) {
  const { person } = await params;
  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidPerson(person)) {
    return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const week = typeof body.week === "string" && DATE_RE.test(body.week) ? body.week : currentWeek();
  const result = applyPlanUndo(person, week);
  if (!result) {
    return NextResponse.json({ error: "Nothing to undo." }, { status: 404 });
  }
  return NextResponse.json({
    week,
    deleted: result.deleted,
    restored: result.restored,
    canUndo: false,
  });
}
