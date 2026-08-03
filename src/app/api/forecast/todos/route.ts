import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import { basecampConnected, listPersonProjectTodos } from "@/lib/basecamp";
import { getConnection } from "@/lib/basecamp-identity";
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
  // Set instead of `client` for internal MEG projects (e.g. Empire Leadership
  // HQ) that aren't rev_clients — a raw Basecamp project id straight from
  // /api/forecast/internal-projects, bypassing the rev_client lookup below.
  const rawProjectId = url.searchParams.get("project") || "";

  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidPerson(person)) {
    return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  }

  let projectId = "";
  if (rawProjectId) {
    projectId = rawProjectId.trim();
  } else {
    const client = clientId ? getRevClient(clientId) : null;
    if (!client) {
      return NextResponse.json({ todos: [], reason: "unknown-client" });
    }
    projectId = (client.basecamp_project_id || "").trim();
  }
  if (!basecampConnected()) {
    return NextResponse.json({ todos: [], reason: "not-connected" });
  }
  if (!projectId) {
    return NextResponse.json({ todos: [], reason: "no-project" });
  }

  try {
    // With their own connection, "assigned to you" is their actual Basecamp id
    // rather than a name match. Without one the picker still works off the
    // service token — a read is harmless to attribute to the app.
    const conn = getConnection(person);
    const { todos, assignedCount } = await listPersonProjectTodos(
      projectId,
      [personLabel(person), person],
      conn ? { bcPersonId: conn.bc_person_id } : undefined
    );
    return NextResponse.json({
      todos,
      assignedCount,
      projectId,
      // Lets the picker say whether "assigned to you" is exact or a guess.
      exactAssignees: Boolean(conn),
      reason: todos.length ? null : "no-todos",
    });
  } catch {
    // Every internal Basecamp call already degrades to an empty list on its
    // own failure — this is a last-resort net so an unexpected throw still
    // answers with the free-text fallback instead of a hung request or 500.
    return NextResponse.json({ todos: [], reason: "failed" });
  }
}
