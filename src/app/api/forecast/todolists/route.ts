import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import { asPerson, basecampConnected, hasConnection, listProjectTodolists } from "@/lib/basecamp";
import { isValidPerson } from "@/lib/forecast";
import { getRevClient } from "@/lib/revenue";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const person = url.searchParams.get("person") || "";
  const clientId = url.searchParams.get("client") || "";
  const rawProjectId = url.searchParams.get("project") || "";

  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidPerson(person)) {
    return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  }
  if (!basecampConnected() || !hasConnection(person)) {
    return NextResponse.json({ lists: [], reason: "not-connected" });
  }

  let projectId = rawProjectId.trim();
  if (!projectId && clientId) {
    if (clientId.startsWith("internal:")) {
      projectId = clientId.slice("internal:".length).trim();
    } else {
      projectId = (getRevClient(clientId)?.basecamp_project_id || "").trim();
    }
  }
  if (!projectId) {
    return NextResponse.json({ lists: [], reason: "no-project" });
  }

  try {
    const lists = await listProjectTodolists(projectId, asPerson(person));
    return NextResponse.json({
      lists: lists.map((l) => ({ id: l.id, name: l.label || l.title })),
      projectId,
      reason: lists.length ? null : "no-lists",
    });
  } catch {
    return NextResponse.json({ lists: [], reason: "failed" });
  }
}
