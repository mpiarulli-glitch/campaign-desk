import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import { SERVICE, basecampConnected, listProjectCatalog } from "@/lib/basecamp";
import {
  ensureForecastProject,
  forecastPickerForPerson,
} from "@/lib/basecamp-clients";
import { linkAllBasecampProjects } from "@/lib/basecamp-link-all";
import { isValidPerson } from "@/lib/forecast";

// Forecast add-task picker. The catalog is every active Basecamp project on
// the King Kashflow account, including ones with no client row yet. GET reads
// the short server cache. POST refreshes it, then links every project that
// does not already have a client. POST { action: "ensure" } links or creates
// the one project somebody just picked. Forecast access is enough for all
// three — this is how people add their own tasks, not an admin import.

async function pickerResponse(person: string, fresh: boolean) {
  if (fresh && basecampConnected()) {
    try {
      const catalog = await listProjectCatalog(SERVICE, { fresh: true });
      if (catalog.projects.length) {
        await linkAllBasecampProjects({
          projects: catalog.projects,
          fresh: true,
        });
      }
    } catch {
      // The picker still answers from the last complete list, or from clients.
    }
  }
  const picker = await forecastPickerForPerson(person);
  return NextResponse.json(picker);
}

async function authorize(person: string): Promise<NextResponse | null> {
  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidPerson(person)) {
    return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const person = url.searchParams.get("person") || "";
  const denied = await authorize(person);
  if (denied) return denied;
  try {
    return await pickerResponse(person, false);
  } catch {
    return NextResponse.json({
      clients: [],
      internals: [],
      warning: "Couldn't load the project list. Refresh to try again.",
      fromCache: false,
      stale: false,
    });
  }
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const person = url.searchParams.get("person") || "";
  const denied = await authorize(person);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  if (body?.action === "ensure") {
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    const ensured = await ensureForecastProject(projectId);
    if (!ensured.ok) {
      return NextResponse.json({ error: ensured.error }, { status: ensured.status });
    }
    return NextResponse.json(ensured);
  }

  if (!basecampConnected()) {
    const picker = await forecastPickerForPerson(person);
    return NextResponse.json({
      ...picker,
      warning: picker.warning || "Basecamp isn't connected. Saved clients are still listed.",
    });
  }

  try {
    return await pickerResponse(person, true);
  } catch {
    return NextResponse.json({ error: "Could not refresh projects." }, { status: 502 });
  }
}
