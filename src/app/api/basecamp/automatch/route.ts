import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { isAdminOrSyncAuthenticated } from "@/lib/auth";
import { basecampConnected } from "@/lib/basecamp";
import { reconcileClients } from "@/lib/basecamp-clients";
import {
  BASECAMP_DISCONNECTED_MESSAGE,
  BASECAMP_NO_PROJECTS_MESSAGE,
  BASECAMP_UNREACHABLE_MESSAGE,
  linkMissingBasecampProjects,
} from "@/lib/basecamp-client-links";

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
 * With no body, link blank basecamp_project_id values when the normalized
 * names match one project. Never overwrites an id that's already set.
 *
 * `{ createMissing: true }` also creates a client for every project that has
 * no client yet, skipping internal MEG workspaces. `{ dryRun: true }` returns
 * the same report without writing.
 *
 * Auth: an admin session, CAMPAIGN_DESK_SYNC_TOKEN, or CRON_SECRET (same
 * machine path as the other Basecamp sync jobs).
 */
export async function POST(request: Request) {
  if (!(await isAdminOrSyncAuthenticated(request)) && !cronSecretMatches(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!basecampConnected()) {
    return NextResponse.json({ error: BASECAMP_DISCONNECTED_MESSAGE }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  try {
    if (body?.createMissing === true) {
      const report = await reconcileClients({
        createMissing: true,
        dryRun: body?.dryRun === true,
      });
      if (!report.projects) {
        return NextResponse.json({ error: BASECAMP_NO_PROJECTS_MESSAGE }, { status: 502 });
      }
      return NextResponse.json({
        ...report,
        matched: report.linked,
        unmatched: report.noProject,
      });
    }

    const report = await linkMissingBasecampProjects({
      dryRun: body?.dryRun === true,
      force: true,
    });
    if (!report.ok) {
      return NextResponse.json({ error: report.error }, { status: 502 });
    }
    return NextResponse.json({
      dryRun: report.dryRun,
      createMissing: false,
      projects: report.projects.length,
      linked: report.linked,
      created: [],
      ambiguous: report.ambiguous,
      noProject: report.noProject,
      skippedInternal: [],
      internals: [],
      matched: report.linked,
      unmatched: report.noProject,
      missing: report.missing,
    });
  } catch (err) {
    console.error("[basecamp-automatch]", (err as Error).message);
    return NextResponse.json({ error: BASECAMP_UNREACHABLE_MESSAGE }, { status: 502 });
  }
}
