import { NextResponse } from "next/server";
import { can, sessionTeam } from "@/lib/auth";
import { createDeliverable, getVisibleSnapshotAccount, listDeliverables } from "@/lib/snapshot";
import type { CadenceUnit } from "@/lib/db";

const CADENCE_UNITS: CadenceUnit[] = ["weekly", "monthly", "quarterly"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getVisibleSnapshotAccount(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    deliverables: listDeliverables(id, { team: await sessionTeam() }),
  });
}

export async function POST(request: Request, { params }: Params) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getVisibleSnapshotAccount(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  const deliverable = createDeliverable({
    clientId: id,
    category: typeof body.category === "string" ? body.category : "",
    // Anything that isn't a known team slug is normalised to unassigned in the
    // lib, so a stale client can't write a bogus team.
    team: typeof body.team === "string" ? body.team : "",
    name,
    cadence: typeof body.cadence === "string" ? body.cadence : "",
    kind: body.kind === "one_time" ? "one_time" : "recurring",
    cadenceUnit: CADENCE_UNITS.includes(body.cadenceUnit) ? body.cadenceUnit : undefined,
    dueDate: typeof body.dueDate === "string" && DATE_RE.test(body.dueDate) ? body.dueDate : null,
  });
  return NextResponse.json({ deliverable }, { status: 201 });
}
