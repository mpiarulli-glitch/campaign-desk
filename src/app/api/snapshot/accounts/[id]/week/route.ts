import { NextResponse } from "next/server";
import { isWorkflowAuthenticated, sessionTeam } from "@/lib/auth";
import { getAccount, listWins, metricsSeries, weekData } from "@/lib/snapshot";

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getAccount(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const week = new URL(request.url).searchParams.get("week") || "";
  if (!WEEK_RE.test(week)) {
    return NextResponse.json({ error: "week (YYYY-MM-DD) required" }, { status: 400 });
  }
  return NextResponse.json({
    week,
    // Scoped to the viewer's team, matching the deliverable list they manage.
    // Admins and the owner get everything.
    rows: weekData(id, week, { team: await sessionTeam() }),
    wins: listWins(id),
    metrics: metricsSeries(id),
  });
}
