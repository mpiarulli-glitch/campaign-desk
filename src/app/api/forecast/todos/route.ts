import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import {
  asPerson,
  basecampConnected,
  hasConnection,
  listPersonProjectTodos,
} from "@/lib/basecamp";
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

  // Read as them, not as the app. The shared service token is the mascot
  // account and is reserved for work with no human behind it; borrowing it here
  // would show this person whatever the mascot can see rather than what they
  // can, and would put their browsing on the mascot's token. Without their own
  // connection the picker says so and falls back to free text.
  // hasConnection, not just "a row exists": a stored token that can no longer
  // be decrypted is not a connection, and saying "reconnect" beats failing with
  // a generic error once the read is attempted.
  const conn = getConnection(person);
  if (!conn || !hasConnection(person)) {
    return NextResponse.json({ todos: [], reason: "person-not-connected" });
  }

  try {
    const { todos, assignedCount } = await listPersonProjectTodos(
      projectId,
      [personLabel(person), person],
      { bcPersonId: conn.bc_person_id, identity: asPerson(person) }
    );
    return NextResponse.json({
      todos,
      assignedCount,
      projectId,
      // Always exact now: the read runs on their own connection, so assignment
      // is an id comparison rather than a name match.
      exactAssignees: true,
      reason: todos.length ? null : "no-todos",
    });
  } catch {
    // Every internal Basecamp call already degrades to an empty list on its
    // own failure — this is a last-resort net so an unexpected throw still
    // answers with the free-text fallback instead of a hung request or 500.
    return NextResponse.json({ todos: [], reason: "failed" });
  }
}
