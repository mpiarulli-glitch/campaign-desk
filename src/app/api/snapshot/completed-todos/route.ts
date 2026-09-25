import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import {
  basecampConnected,
  basecampTodoAppUrl,
  getBasecampProjectName,
  listProjectSnapshotTodos,
} from "@/lib/basecamp";
import { getRevClient } from "@/lib/revenue";
import { completedTodoScopeReason } from "@/lib/snapshot-completed-todo";

// Open and completed Basecamp to-dos for one client's linked project. Backs
// the "what happened" picker on the snapshot fill desk. Failures answer 200
// with an empty list plus a reason so the UI can explain without a hard error.
export async function GET(request: Request) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = new URL(request.url).searchParams.get("client") || "";
  const client = clientId ? getRevClient(clientId) : null;
  if (!client) {
    return NextResponse.json({ todos: [], reason: "unknown-client" });
  }

  const projectId = (client.basecamp_project_id || "").trim();
  if (!basecampConnected()) {
    return NextResponse.json({ todos: [], reason: "not-connected" });
  }
  if (!projectId) {
    return NextResponse.json({ todos: [], reason: "no-project" });
  }

  try {
    const projectName = await getBasecampProjectName(projectId);
    // Never serve Department Library / Deliverable Templates / HQ projects as
    // if they were this client's to-dos — even when the client record points at
    // one of those by mistake.
    const blocked = completedTodoScopeReason(projectName, client.name);
    if (blocked === "not-client-project") {
      return NextResponse.json({
        todos: [],
        projectId,
        projectName: projectName || null,
        clientName: client.name,
        reason: "not-client-project",
      });
    }

    const raw = await listProjectSnapshotTodos(projectId);
    // Always scope to this client's linked project id — never a shared bucket.
    const todos = raw.map((t) => ({
      id: t.id,
      title: t.title,
      list: t.list,
      completedAt: t.completedAt || null,
      url: basecampTodoAppUrl(projectId, t.id, t.appUrl),
      projectId,
    }));
    return NextResponse.json({
      todos,
      projectId,
      projectName: projectName || null,
      clientName: client.name,
      reason: blocked || (todos.length ? null : "no-todos"),
    });
  } catch {
    return NextResponse.json({ todos: [], reason: "failed" });
  }
}
