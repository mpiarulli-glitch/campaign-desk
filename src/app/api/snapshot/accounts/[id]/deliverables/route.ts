import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { createDeliverable, getAccount, listDeliverables } from "@/lib/snapshot";
import type { CadenceUnit } from "@/lib/db";

const CADENCE_UNITS: CadenceUnit[] = ["weekly", "monthly", "quarterly"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getAccount(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ deliverables: listDeliverables(id) });
}

export async function POST(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getAccount(id)) {
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
    name,
    cadence: typeof body.cadence === "string" ? body.cadence : "",
    kind: body.kind === "one_time" ? "one_time" : "recurring",
    cadenceUnit: CADENCE_UNITS.includes(body.cadenceUnit) ? body.cadenceUnit : undefined,
    dueDate: typeof body.dueDate === "string" && DATE_RE.test(body.dueDate) ? body.dueDate : null,
  });
  return NextResponse.json({ deliverable }, { status: 201 });
}
