import { NextResponse } from "next/server";
import { can, sessionActor } from "@/lib/auth";
import { upsertEntry } from "@/lib/snapshot";
import { isYmd } from "@/lib/snapshot-entry-date";

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;
const optStr = (v: unknown) => (typeof v === "string" ? v : undefined);

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
