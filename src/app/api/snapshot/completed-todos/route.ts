import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import {
  basecampConnected,
  basecampTodoAppUrl,
  listProjectCompletedTodos,
} from "@/lib/basecamp";
import { getRevClient } from "@/lib/revenue";

// Completed Basecamp to-dos for one client's project. Backs the "what happened"
// picker on the snapshot fill desk. Failures answer 200 with an empty list plus
// a reason so the UI can explain without treating it as a hard error.
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
    const raw = await listProjectCompletedTodos(projectId);
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
      reason: todos.length ? null : "no-todos",
    });
  } catch {
    return NextResponse.json({ todos: [], reason: "failed" });
  }
}
