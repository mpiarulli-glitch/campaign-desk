import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import {
  LINK_ALL_UNAVAILABLE,
  linkAllBasecampProjects,
  readLinkAllReport,
} from "@/lib/basecamp-link-all";

// Admin-only. GET returns the last link-all report (startup, Refresh
// projects, or this route). POST runs it again. Dry-run writes nothing.
// There is no page banner; Forecast shows the summary only after an admin
// clicks Link all projects.

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ report: readLinkAllReport() });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    const report = await linkAllBasecampProjects({
      dryRun: body?.dryRun === true,
      fresh: true,
      share: body?.dryRun !== true,
    });
    return NextResponse.json(report, { status: report.ok ? 200 : 502 });
  } catch (err) {
    console.error("[link-all] failed", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { ok: false, error: LINK_ALL_UNAVAILABLE, summary: LINK_ALL_UNAVAILABLE },
      { status: 502 }
    );
  }
}
