import { NextResponse } from "next/server";
import { can, sessionTeam } from "@/lib/auth";
import { behindItemsForDesk, weekDesk } from "@/lib/snapshot";

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const week = new URL(request.url).searchParams.get("week") || "";
  if (!WEEK_RE.test(week)) {
    return NextResponse.json({ error: "week (YYYY-MM-DD) required" }, { status: 400 });
  }
  return NextResponse.json({
    week,
    rows: weekDesk(week, { team: await sessionTeam() }),
    behind: behindItemsForDesk(),
  });
}
