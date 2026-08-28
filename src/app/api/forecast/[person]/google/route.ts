import { NextResponse } from "next/server";
import { isForecastAuthenticated, sessionUserSlug } from "@/lib/auth";
import { isValidPerson } from "@/lib/forecast";
import {
  forecastGoogleEnabled,
  googleStatusFor,
  pullGoogleMeetingsForWeek,
} from "@/lib/forecast-google";
import { currentWeek } from "@/lib/week";

type Params = { params: Promise<{ person: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request, { params }: Params) {
  if (!forecastGoogleEnabled()) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  const { person } = await params;
  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidPerson(person)) {
    return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  }
  const self = await sessionUserSlug();
  return NextResponse.json(googleStatusFor(person, self === person));
}

export async function POST(request: Request, { params }: Params) {
  if (!forecastGoogleEnabled()) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  const { person } = await params;
  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidPerson(person)) {
    return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  }
  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const week =
    (typeof body.week === "string" && body.week) ||
    url.searchParams.get("week") ||
    currentWeek();
  if (!DATE_RE.test(week)) {
    return NextResponse.json({ error: "week must be YYYY-MM-DD" }, { status: 400 });
  }
  const pulled = await pullGoogleMeetingsForWeek(person, week, { force: true });
  const self = await sessionUserSlug();
  return NextResponse.json({
    ...googleStatusFor(person, self === person),
    pull: pulled,
  });
}
