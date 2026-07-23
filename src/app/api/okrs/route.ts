import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { createOkr, listOkrs, OKR_STATUSES, type OkrKeyResult } from "@/lib/okrs";

const STATUS_VALUES = OKR_STATUSES.map((s) => s.value);

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

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  if (!clientId) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }
  return NextResponse.json({ okrs: listOkrs(clientId) });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  if (typeof body.clientId !== "string" || !body.clientId) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }
  if (typeof body.objective !== "string" || !body.objective.trim()) {
    return NextResponse.json({ error: "objective required" }, { status: 400 });
  }
  const okr = createOkr(body.clientId, {
    objective: body.objective,
    keyResults: parseKeyResults(body.keyResults),
    targetDate: typeof body.targetDate === "string" ? body.targetDate : null,
    status: STATUS_VALUES.includes(body.status) ? body.status : undefined,
  });
  return NextResponse.json({ okr });
}
