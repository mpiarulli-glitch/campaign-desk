import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
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
  return NextResponse.json({
    week,
    people:
      session.role === "forecast"
        ? people.filter((p) => p.person === session.person)
        : people,
  });
}
