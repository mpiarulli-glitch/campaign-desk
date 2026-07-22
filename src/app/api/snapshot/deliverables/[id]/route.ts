import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { deleteDeliverable, getDeliverable, updateDeliverable } from "@/lib/snapshot";
import type { CadenceUnit } from "@/lib/db";

const CADENCE_UNITS: CadenceUnit[] = ["weekly", "monthly", "quarterly"];

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getDeliverable(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const deliverable = updateDeliverable(id, {
    category: typeof body.category === "string" ? body.category : undefined,
    name: typeof body.name === "string" ? body.name : undefined,
    cadence: typeof body.cadence === "string" ? body.cadence : undefined,
    kind:
      body.kind === "one_time" || body.kind === "recurring"
        ? body.kind
        : undefined,
    cadenceUnit: CADENCE_UNITS.includes(body.cadenceUnit) ? body.cadenceUnit : undefined,
    sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : undefined,
  });
  return NextResponse.json({ deliverable });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const ok = deleteDeliverable(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
