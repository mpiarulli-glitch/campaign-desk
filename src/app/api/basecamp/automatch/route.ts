import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { isAdminOrSyncAuthenticated } from "@/lib/auth";
import { basecampConnected } from "@/lib/basecamp";
import { reconcileClients } from "@/lib/basecamp-clients";

function cronSecretMatches(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const url = new URL(request.url);
  const header = request.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7) : null;
  const provided = bearer || url.searchParams.get("secret");
  if (!provided) return false;
  const a = createHmac("sha256", expected).update(provided).digest();
  const b = createHmac("sha256", expected).update(expected).digest();
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

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
 *
 * Auth: an admin session, CAMPAIGN_DESK_SYNC_TOKEN, or CRON_SECRET (same
 * machine path as the other Basecamp sync jobs).
 */
export async function POST(request: Request) {
  if (!(await isAdminOrSyncAuthenticated(request)) && !cronSecretMatches(request)) {
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
