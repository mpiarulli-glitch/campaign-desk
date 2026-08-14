import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import { asPerson, basecampConnected, hasConnection } from "@/lib/basecamp";
import { listInternalProjects } from "@/lib/basecamp-clients";

// Internal MEG Basecamp projects the signed-in person can actually open.
// Listed as them, not the shared service account, so a project like Empire
// Leadership HQ only appears for members. Same degrade-to-empty contract as
// /api/forecast/todos.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const person = url.searchParams.get("person") || "";

  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!basecampConnected() || !hasConnection(person)) {
    return NextResponse.json({ projects: [] });
  }

  try {
    const projects = await listInternalProjects(asPerson(person));
    return NextResponse.json({ projects });
  } catch {
    return NextResponse.json({ projects: [] });
  }
}
