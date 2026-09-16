import { NextResponse } from "next/server";
import { isForecastAuthenticated } from "@/lib/auth";
import {
  asPerson,
  basecampConnected,
  createAssignedTodo,
  hasConnection,
  listMyAssignments,
  OPS_TODOLIST_NAME,
  updateAssignmentDue,
} from "@/lib/basecamp";
import { getConnection } from "@/lib/basecamp-identity";
import { isValidPerson } from "@/lib/forecast";
import { getRevClient, listRevClients } from "@/lib/revenue";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function projectIdForClient(clientId: string): { projectId: string; error?: string } {
  const raw = clientId.trim();
  if (raw.startsWith("internal:")) {
    const projectId = raw.slice("internal:".length).trim();
    if (!projectId) return { projectId: "", error: "Missing Basecamp project." };
    return { projectId };
  }
  const client = getRevClient(raw);
  if (!client) return { projectId: "", error: "Unknown client." };
  const projectId = (client.basecamp_project_id || "").trim();
  if (!projectId) return { projectId: "", error: "That client has no Basecamp project." };
  return { projectId };
}

function emptyAssignments(reason: string) {
  return NextResponse.json({ assignments: [], reason });
}

// Everything Basecamp says is assigned to this person, across every project.
//
// Backs the "assigned to me" list in the forecast queue, which is the answer to
// having to pick a client before you could see any of your own work — most
// people do not think "which client is that under", they think "what's on me".
//
// Like the other pickers, every empty case answers 200 with a `reason` rather
// than an error: the sidebar always has the per-client tab and free text to fall
// back on, and only needs to explain why there is nothing here.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const person = url.searchParams.get("person") || "";

  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidPerson(person)) {
    return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  }
  if (!basecampConnected()) {
    return emptyAssignments("not-connected");
  }
  // /my/assignments.json answers for whoever's token asks. On the shared service
  // token it would hand back the mascot account's work, which is worse than
  // saying nothing, so this refuses rather than falling back.
  if (!hasConnection(person)) {
    return emptyAssignments("person-not-connected");
  }

  try {
    const rows = await listMyAssignments(asPerson(person));

    // Project id -> billing client, so a booked row lands under the client name
    // the rest of the forecast uses rather than the Basecamp project title.
    const byProject = new Map<string, { id: string; name: string }>();
    for (const c of listRevClients(true)) {
      const pid = (c.basecamp_project_id || "").trim();
      if (pid) byProject.set(pid, { id: c.id, name: c.name });
    }

    const assignments = rows.map((r) => {
      const client = byProject.get(r.projectId);
      return {
        ...r,
        clientId: client?.id || "",
        // Internal projects (Empire Leadership HQ and friends) are not
        // rev_clients, so they keep the Basecamp project name.
        clientName: client?.name || r.projectName,
      };
    });

    return NextResponse.json({
      assignments,
      reason: assignments.length ? null : "none-assigned",
    });
  } catch {
    return emptyAssignments("failed");
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const person = typeof body.person === "string" ? body.person.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  const listId = typeof body.listId === "string" ? body.listId.trim() : "";
  const dueRaw = typeof body.dueOn === "string" ? body.dueOn.trim() : "";
  const dueOn = dueRaw && DATE_RE.test(dueRaw) ? dueRaw : null;

  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidPerson(person)) {
    return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  }
  if (!title) {
    return NextResponse.json({ error: "A to-do needs a title." }, { status: 400 });
  }
  if (!basecampConnected()) {
    return NextResponse.json({ error: "Basecamp isn't connected." }, { status: 400 });
  }
  const conn = getConnection(person);
  if (!conn || !hasConnection(person)) {
    return NextResponse.json(
      {
        error: "Connect your Basecamp account so this is assigned as you.",
        needsBasecamp: true,
      },
      { status: 400 }
    );
  }

  const resolved = projectIdForClient(clientId);
  if (resolved.error || !resolved.projectId) {
    return NextResponse.json({ error: resolved.error || "Pick a client." }, { status: 400 });
  }

  const created = await createAssignedTodo({
    projectId: resolved.projectId,
    title,
    assigneeIds: [conn.bc_person_id],
    dueOn,
    identity: asPerson(person),
    listId: listId || undefined,
    listName: listId ? undefined : OPS_TODOLIST_NAME,
    notify: false,
  });
  if (!created.ok) {
    return NextResponse.json({ error: created.error }, { status: 502 });
  }

  return NextResponse.json(
    {
      ok: true,
      todoId: created.todoId,
      todoUrl: created.todoUrl,
      dueOn,
    },
    { status: 201 }
  );
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const person = typeof body.person === "string" ? body.person.trim() : "";
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const kind =
    body.kind === "card" || body.kind === "step" || body.kind === "todo"
      ? body.kind
      : "todo";
  const titleHint = typeof body.title === "string" ? body.title.trim() : "";
  const dueSent = Object.prototype.hasOwnProperty.call(body, "dueOn");
  const dueRaw = typeof body.dueOn === "string" ? body.dueOn.trim() : "";
  const dueOn = dueSent ? (dueRaw && DATE_RE.test(dueRaw) ? dueRaw : null) : undefined;

  if (!(await isForecastAuthenticated(person))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isValidPerson(person)) {
    return NextResponse.json({ error: "Unknown person" }, { status: 404 });
  }
  if (!projectId || !id) {
    return NextResponse.json({ error: "Missing project or recording id." }, { status: 400 });
  }
  if (!dueSent) {
    return NextResponse.json({ error: "Missing due date." }, { status: 400 });
  }
  if (!basecampConnected()) {
    return NextResponse.json({ error: "Basecamp isn't connected." }, { status: 400 });
  }
  const conn = getConnection(person);
  if (!conn || !hasConnection(person)) {
    return NextResponse.json(
      {
        error: "Connect your Basecamp account so this updates as you.",
        needsBasecamp: true,
      },
      { status: 400 }
    );
  }

  const identity = asPerson(person);
  const updated = await updateAssignmentDue({
    projectId,
    id,
    kind,
    dueOn: dueOn ?? null,
    identity,
  });
  if (!updated.ok) {
    return NextResponse.json({ error: updated.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    dueOn: dueOn ?? null,
    title: updated.title || titleHint,
  });
}
