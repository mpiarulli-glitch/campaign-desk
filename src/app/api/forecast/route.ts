import { NextResponse } from "next/server";
import { getSession, sessionForecastSubjects } from "@/lib/auth";
import { FORECAST_ALL } from "@/lib/access";
import { weekSummaryForAllPeople } from "@/lib/forecast";
import { currentWeek } from "@/lib/week";

// Master allocation dashboard: forecasted hours vs capacity per person.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const week = url.searchParams.get("week") || currentWeek();
  const people = weekSummaryForAllPeople(week);
  // Whose rows come back is the same set the per-person endpoint would allow, so
  // the board cannot become a way to read a week you cannot open.
  const visible = await sessionForecastSubjects();
  return NextResponse.json({
    week,
    people:
      visible === FORECAST_ALL
        ? people
        : people.filter((p) => visible.includes(p.person)),
  });
}
