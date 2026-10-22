import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import {
  BASECAMP_UNREACHABLE_MESSAGE,
  linkClientToBasecampProject,
  linkMissingBasecampProjects,
  listForecastClientsMissingBasecamp,
} from "@/lib/basecamp-client-links";

// Admin list of Forecast clients with no Basecamp project, and the actions that
// fill the gap. Nothing here runs at startup. GET only reads the database.
// POST match lists King Kashflow's projects (cached for a few minutes) and
// writes confident links. POST link saves the project an admin picked.

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
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
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
      // The Forecast page asks with lazy: true so a second view reuses the
      // project list. The Match button forces a fresh listing.
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
