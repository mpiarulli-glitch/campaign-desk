import { NextResponse } from "next/server";
import { can, sessionActor } from "@/lib/auth";
import { catchUpDeliverable } from "@/lib/snapshot";
import { isYmd } from "@/lib/snapshot-entry-date";

export async function POST(request: Request) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const deliverableId = typeof body.deliverableId === "string" ? body.deliverableId : "";
  const from = typeof body.from === "string" ? body.from.trim() : "";
  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (!deliverableId || !isYmd(from) || !isYmd(to)) {
    return NextResponse.json(
      { error: "deliverableId, from, and to (YYYY-MM-DD) required" },
      { status: 400 }
    );
  }
  const result = catchUpDeliverable({
    deliverableId,
    from,
    to,
    loggedBy: await sessionActor(),
  });
  if (!result.ok) {
    if (result.error === "not_found") {
      return NextResponse.json({ error: "Deliverable not found" }, { status: 404 });
    }
    if (result.error === "one_time") {
      return NextResponse.json(
        { error: "Catch-up is for recurring work, not one-off setup." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "No due periods in that range." }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    marked: result.marked,
    skipped: result.skipped,
    periods: result.periods,
  });
}
