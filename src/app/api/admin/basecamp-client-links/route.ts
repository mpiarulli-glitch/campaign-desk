import { NextResponse } from "next/server";
import { isAdminAuthenticated, isForecastAuthenticated } from "@/lib/auth";
import {
  BASECAMP_UNREACHABLE_MESSAGE,
  linkClientToBasecampProject,
  linkMissingBasecampProjects,
  listForecastClientsMissingBasecamp,
} from "@/lib/basecamp-client-links";

// Admin list of real clients with no Basecamp project, and the actions that
// fill the gap. Nothing here runs at startup. GET only reads the database.
// POST match lists King Kashflow's projects (cached for a few minutes) and
// writes confident links. POST link saves the project an admin picked.
// POST { silent: true } is the Forecast page load: any signed-in user may
// trigger it, it is throttled, and the response carries no project list.

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const missing = listForecastClientsMissingBasecamp();
    return NextResponse.json({ missing, count: missing.length });
  } catch (err) {
    console.error("[basecamp-client-links] list failed", (err as Error).message);
    return NextResponse.json({ error: "Couldn't load clients." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const silent = body?.silent === true && body?.action !== "link";
  if (silent) {
    if (!(await isForecastAuthenticated())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    try {
      const report = await linkMissingBasecampProjects({ silent: true });
      return NextResponse.json({
        ok: report.ok,
        skipped: report.skipped === true,
        linked: report.linked.map((row) => ({ clientId: row.clientId })),
      });
    } catch (err) {
      console.error("[basecamp-client-links] silent match failed", (err as Error).message);
      return NextResponse.json({ ok: false, skipped: false, linked: [] });
    }
  }
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    if (body?.action === "link") {
      const saved = await linkClientToBasecampProject(
        typeof body.clientId === "string" ? body.clientId : "",
        typeof body.projectId === "string" ? body.projectId : ""
      );
      if (!saved.ok) {
        return NextResponse.json(
          { ok: false, error: saved.error, missing: listForecastClientsMissingBasecamp() },
          { status: saved.status }
        );
      }
      return NextResponse.json({
        ok: true,
        clientId: saved.clientId,
        projectId: saved.projectId,
        missing: listForecastClientsMissingBasecamp(),
      });
    }

    const report = await linkMissingBasecampProjects({
      dryRun: body?.dryRun === true,
      // The admin section's first look reuses the project list. Match by name
      // forces a fresh listing. Forecast itself calls with silent: true.
      force: body?.lazy !== true,
    });
    return NextResponse.json(report);
  } catch (err) {
    console.error("[basecamp-client-links] failed", (err as Error).message);
    return NextResponse.json({
      ok: false,
      error: BASECAMP_UNREACHABLE_MESSAGE,
      linked: [],
      ambiguous: [],
      noProject: [],
      missing: [],
      projects: [],
    });
  }
}
