import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import { upsertEntry } from "@/lib/snapshot";

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;
const optStr = (v: unknown) => (typeof v === "string" ? v : undefined);

export async function POST(request: Request) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const deliverableId = typeof body.deliverableId === "string" ? body.deliverableId : "";
  const weekStart = typeof body.weekStart === "string" ? body.weekStart : "";
  if (!deliverableId || !WEEK_RE.test(weekStart)) {
    return NextResponse.json(
      { error: "deliverableId and weekStart (YYYY-MM-DD) required" },
      { status: 400 }
    );
  }
  const result = upsertEntry({
    deliverableId,
    weekStart,
    status: body.status,
    workDone: optStr(body.workDone),
    nextSteps: optStr(body.nextSteps),
    notes: optStr(body.notes),
  });
  if (!result.ok) {
    return NextResponse.json({ error: "Deliverable not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
