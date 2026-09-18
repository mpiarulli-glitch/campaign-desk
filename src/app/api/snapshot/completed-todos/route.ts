import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import {
  basecampConnected,
  basecampTodoAppUrl,
  getBasecampProjectName,
  listProjectCompletedTodos,
} from "@/lib/basecamp";
import { getRevClient } from "@/lib/revenue";

function foldName(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[''`´]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Loose check that the linked Basecamp project is this client's, not another. */
function projectLooksLikeClient(projectName: string, clientName: string): boolean {
  const project = foldName(projectName);
  const client = foldName(clientName);
  if (!project || !client) return true;
  if (project === client) return true;
  if (project.includes(client) || client.includes(project)) return true;
  // Token overlap: "Cisco Restaurant Bar" vs "CISCo Restaurant + Bar"
  const pTokens = new Set(project.split(" ").filter((t) => t.length > 2));
  const cTokens = client.split(" ").filter((t) => t.length > 2);
  if (!cTokens.length) return true;
  const hits = cTokens.filter((t) => pTokens.has(t)).length;
  return hits >= Math.min(2, cTokens.length);
}

// Completed Basecamp to-dos for one client's linked project only. Backs the
// "what happened" picker on the snapshot fill desk. Failures answer 200 with
// an empty list plus a reason so the UI can explain without a hard error.
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
    const [raw, projectName] = await Promise.all([
      listProjectCompletedTodos(projectId),
      getBasecampProjectName(projectId),
    ]);
    // Always scope to this client's linked project id — never a shared bucket.
    const todos = raw.map((t) => ({
      id: t.id,
      title: t.title,
      list: t.list,
      completedAt: t.completedAt || null,
      url: basecampTodoAppUrl(projectId, t.id, t.appUrl),
      projectId,
    }));
    const mismatch =
      projectName && !projectLooksLikeClient(projectName, client.name)
        ? "project-mismatch"
        : null;
    return NextResponse.json({
      todos,
      projectId,
      projectName: projectName || null,
      clientName: client.name,
      reason: mismatch || (todos.length ? null : "no-todos"),
    });
  } catch {
    return NextResponse.json({ todos: [], reason: "failed" });
  }
}
