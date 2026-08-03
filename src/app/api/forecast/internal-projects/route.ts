import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import { basecampConnected } from "@/lib/basecamp";
import { listInternalProjects } from "@/lib/basecamp-clients";

// Internal MEG Basecamp projects (e.g. Empire Leadership HQ) that the forecast
// todo picker can reach directly, without them being rev_clients. Same
// degrade-to-empty contract as /api/forecast/todos: never an error status, the
// dropdown just has nothing extra to show.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const person = url.searchParams.get("person") || "";

  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!basecampConnected()) {
    return NextResponse.json({ projects: [] });
  }

  try {
    const projects = await listInternalProjects();
    return NextResponse.json({ projects });
  } catch {
    return NextResponse.json({ projects: [] });
  }
}
