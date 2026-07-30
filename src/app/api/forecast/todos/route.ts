import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import { basecampConnected, listPersonProjectTodos } from "@/lib/basecamp";
import { isValidPerson, personLabel } from "@/lib/forecast";
import { getRevClient } from "@/lib/revenue";

// Open Basecamp todos for one client's project, narrowed to the forecast person
// where possible. Backs the task picker on the per-person forecast page.
//
// Every failure mode here answers 200 with an empty list plus a `reason`, not an
// error status: the picker always has a free-text fallback, so the page only
// needs to explain why there's nothing to pick.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const person = url.searchParams.get("person") || "";
  const clientId = url.searchParams.get("client") || "";

  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidPerson(person)) {
    return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  }

  const client = clientId ? getRevClient(clientId) : null;
  if (!client) {
    return NextResponse.json({ todos: [], reason: "unknown-client" });
  }
  if (!basecampConnected()) {
    return NextResponse.json({ todos: [], reason: "not-connected" });
  }
  const projectId = (client.basecamp_project_id || "").trim();
  if (!projectId) {
    return NextResponse.json({ todos: [], reason: "no-project" });
  }

  const { todos, filteredToPerson } = await listPersonProjectTodos(projectId, [
    personLabel(person),
    person,
  ]);
  return NextResponse.json({
    todos,
    filteredToPerson,
    projectId,
    reason: todos.length ? null : "no-todos",
  });
}
