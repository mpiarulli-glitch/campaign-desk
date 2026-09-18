import { NextResponse } from "next/server";
import { can, sessionActor } from "@/lib/auth";
import { getDeliverable, upsertEntry, type SnapshotBasecampTodoLink } from "@/lib/snapshot";
import { getRevClient } from "@/lib/revenue";
import { isYmd } from "@/lib/snapshot-entry-date";

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;
const optStr = (v: unknown) => (typeof v === "string" ? v : undefined);

function parseBasecampTodo(raw: unknown): SnapshotBasecampTodoLink | null | undefined {
  // Omitted from the body → leave the existing link alone.
  if (raw === undefined) return undefined;
  // Explicit null → clear the link.
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const projectId = typeof o.projectId === "string" ? o.projectId.trim() : "";
  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (!id || !projectId || !title) return undefined;
  return {
    id,
    projectId,
    title,
    url: typeof o.url === "string" ? o.url.trim() : "",
    completedAt: typeof o.completedAt === "string" ? o.completedAt.trim() : "",
  };
}

export async function POST(request: Request) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const deliverableId = typeof body.deliverableId === "string" ? body.deliverableId : "";
  const weekStart = typeof body.weekStart === "string" ? body.weekStart : "";
  const loggedFor = typeof body.loggedFor === "string" ? body.loggedFor.trim() : "";
  if (!deliverableId || !WEEK_RE.test(weekStart)) {
    return NextResponse.json(
      { error: "deliverableId and weekStart (YYYY-MM-DD) required" },
      { status: 400 }
    );
  }
  if (loggedFor && !isYmd(loggedFor)) {
    return NextResponse.json(
      { error: "loggedFor must be YYYY-MM-DD when provided" },
      { status: 400 }
    );
  }
  // Distinguish "basecampTodo omitted" from "basecampTodo: null" (clear).
  const hasBasecampTodo = Object.prototype.hasOwnProperty.call(body, "basecampTodo");
  const basecampTodo = hasBasecampTodo ? parseBasecampTodo(body.basecampTodo) : undefined;
  if (hasBasecampTodo && body.basecampTodo != null && basecampTodo === undefined) {
    return NextResponse.json(
      { error: "basecampTodo requires id, projectId, and title" },
      { status: 400 }
    );
  }
  if (basecampTodo) {
    const deliverable = getDeliverable(deliverableId);
    if (!deliverable) {
      return NextResponse.json({ error: "Deliverable not found" }, { status: 404 });
    }
    const client = getRevClient(deliverable.client_id);
    const linked = (client?.basecamp_project_id || "").trim();
    if (!linked) {
      return NextResponse.json(
        { error: "This client has no Basecamp project linked." },
        { status: 400 }
      );
    }
    if (basecampTodo.projectId !== linked) {
      return NextResponse.json(
        { error: "That to-do is not from this client’s Basecamp project." },
        { status: 400 }
      );
    }
  }
  const result = upsertEntry({
    deliverableId,
    weekStart,
    loggedFor: loggedFor || undefined,
    status: body.status,
    workDone: optStr(body.workDone),
    nextSteps: optStr(body.nextSteps),
    notes: optStr(body.notes),
    // Taken from the session, never from the request body: an audit trail the
    // caller can set is not an audit trail.
    loggedBy: await sessionActor(),
    basecampTodo: hasBasecampTodo ? (body.basecampTodo === null ? null : basecampTodo) : undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: "Deliverable not found" }, { status: 404 });
  }
  // Echoed back so the editor can show who owns the row without a full reload.
  return NextResponse.json({
    ok: true,
    loggedBy: result.loggedBy,
    updatedAt: result.updatedAt,
  });
}
