import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { basecampConnected } from "@/lib/basecamp";
import { reconcileClients } from "@/lib/basecamp-clients";

/**
 * Reconcile clients against Basecamp projects.
 *
 * Always links: any client with no basecamp_project_id gets one if a project
 * matches. Never overwrites an id that's already set, so this is safe to re-run.
 *
 * `{ createMissing: true }` also creates a client for every project that has no
 * client yet, skipping internal MEG workspaces. `{ dryRun: true }` returns the
 * same report without writing.
 *
 * The logic lives in lib/basecamp-clients so this and the one-time startup
 * backfill share a single implementation.
 */
export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!basecampConnected()) {
    return NextResponse.json({ error: "Connect Basecamp first." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const report = await reconcileClients({
    createMissing: body?.createMissing === true,
    dryRun: body?.dryRun === true,
  });

  if (!report.projects) {
    return NextResponse.json({ error: "No Basecamp projects returned." }, { status: 502 });
  }

  return NextResponse.json({
    ...report,
    // Kept so the existing production-page button's message still renders.
    matched: report.linked,
    unmatched: report.noProject,
  });
}
