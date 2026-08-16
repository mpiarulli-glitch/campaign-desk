import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import { autofillForecastFromTodos } from "@/lib/forecast-autofill";
import { isValidPerson } from "@/lib/forecast";

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
  const week = typeof body.week === "string" ? body.week : "";
  if (!DATE_RE.test(week)) {
    return NextResponse.json({ error: "week must be YYYY-MM-DD" }, { status: 400 });
  }

  const result = await autofillForecastFromTodos(person, week);
  return NextResponse.json(result);
}
