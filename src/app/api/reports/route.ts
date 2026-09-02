import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import {
  REPORTS,
  buildReport,
  isReportType,
  reportToCsv,
} from "@/lib/reports";

// Reports aggregate across every client and every person, so they are owner and
// admin only. Read-only: there is no POST here by design.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  if (!(await can("page.reports"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "";

  // No type: tell the client what it can ask for, so the picker is driven by
  // the same list the builders are.
  if (!type) {
    return NextResponse.json({ reports: REPORTS });
  }
  if (!isReportType(type)) {
    return NextResponse.json({ error: "Unknown report" }, { status: 400 });
  }

  const start = url.searchParams.get("start") || "";
  const end = url.searchParams.get("end") || "";
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    return NextResponse.json(
      { error: "start and end (YYYY-MM-DD) are required" },
      { status: 400 }
    );
  }
  if (start > end) {
    return NextResponse.json(
      { error: "The start date is after the end date." },
      { status: 400 }
    );
  }

  const report = buildReport(type, start, end);

  if (url.searchParams.get("format") === "csv") {
    const name = `${type}-${start}-to-${end}.csv`;
    return new NextResponse(reportToCsv(report), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  }

  return NextResponse.json({ report });
}
