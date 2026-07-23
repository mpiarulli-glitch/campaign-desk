import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { deleteOkr, OKR_STATUSES, updateOkr, type OkrKeyResult } from "@/lib/okrs";

const STATUS_VALUES = OKR_STATUSES.map((s) => s.value);

type Params = { params: Promise<{ id: string }> };

function parseKeyResults(body: unknown): OkrKeyResult[] | undefined {
  if (!Array.isArray(body)) return undefined;
  return body
    .filter((kr) => kr && typeof kr === "object")
    .map((kr) => ({
      id: typeof kr.id === "string" ? kr.id : "",
      description: typeof kr.description === "string" ? kr.description : "",
      target: typeof kr.target === "number" ? kr.target : 0,
      current: typeof kr.current === "number" ? kr.current : 0,
      unit: typeof kr.unit === "string" ? kr.unit : "",
    }));
}

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const okr = updateOkr(id, {
    objective: typeof body.objective === "string" ? body.objective : undefined,
    keyResults: parseKeyResults(body.keyResults),
    targetDate:
      body.targetDate === null || typeof body.targetDate === "string"
        ? body.targetDate
        : undefined,
    status: STATUS_VALUES.includes(body.status) ? body.status : undefined,
    sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : undefined,
  });
  if (!okr) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ okr });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const ok = deleteOkr(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
