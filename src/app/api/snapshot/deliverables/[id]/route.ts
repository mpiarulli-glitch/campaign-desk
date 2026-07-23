import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import { deleteDeliverable, getDeliverable, updateDeliverable } from "@/lib/snapshot";
import type { CadenceUnit } from "@/lib/db";

const CADENCE_UNITS: CadenceUnit[] = ["weekly", "monthly", "quarterly"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getDeliverable(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  let dueDate: string | null | undefined;
  if ("dueDate" in body) {
    dueDate = typeof body.dueDate === "string" && DATE_RE.test(body.dueDate) ? body.dueDate : null;
  }
  const deliverable = updateDeliverable(id, {
    category: typeof body.category === "string" ? body.category : undefined,
    name: typeof body.name === "string" ? body.name : undefined,
    cadence: typeof body.cadence === "string" ? body.cadence : undefined,
    kind:
      body.kind === "one_time" || body.kind === "recurring"
        ? body.kind
        : undefined,
    cadenceUnit: CADENCE_UNITS.includes(body.cadenceUnit) ? body.cadenceUnit : undefined,
    dueDate,
    sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : undefined,
  });
  return NextResponse.json({ deliverable });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const ok = deleteDeliverable(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
