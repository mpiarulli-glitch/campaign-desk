import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { weekSummaryForAllPeople } from "@/lib/forecast";
import { currentWeek } from "@/lib/week";

// Master allocation dashboard: forecasted hours vs capacity per person.
export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const week = url.searchParams.get("week") || currentWeek();
  return NextResponse.json({ week, people: weekSummaryForAllPeople(week) });
}
