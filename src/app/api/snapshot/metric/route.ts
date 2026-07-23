import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import { getAccount, upsertMetric } from "@/lib/snapshot";

export async function POST(request: Request) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  const metric = typeof body.metric === "string" ? body.metric.trim() : "";
  const period = typeof body.period === "string" ? body.period.trim() : "";
  const value = typeof body.value === "number" ? body.value : Number(body.value);
  if (!clientId || !getAccount(clientId)) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  if (!metric || !period || Number.isNaN(value)) {
    return NextResponse.json(
      { error: "metric, period and numeric value are required" },
      { status: 400 }
    );
  }
  const saved = upsertMetric({
    clientId,
    metric,
    period,
    value,
    unit: typeof body.unit === "string" ? body.unit : "",
    sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : undefined,
  });
  return NextResponse.json({ metric: saved });
}
