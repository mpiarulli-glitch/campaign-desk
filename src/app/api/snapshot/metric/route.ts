import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { getVisibleSnapshotAccount, upsertMetric } from "@/lib/snapshot";

export async function POST(request: Request) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  const metric = typeof body.metric === "string" ? body.metric.trim() : "";
  const period = typeof body.period === "string" ? body.period.trim() : "";
  const value = typeof body.value === "number" ? body.value : Number(body.value);
  if (!clientId || !getVisibleSnapshotAccount(clientId)) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }
  if (!metric || !period || Number.isNaN(value)) {
    return NextResponse.json(
      { error: "metric, period and numeric value are required" },
      { status: 400 }
    );
  }
  // The period is canonicalised in the lib, which is also where an unreadable one
  // is refused. Passing that message through matters: "April 2026" and "Q2" fail
  // for different reasons and the person typing needs to know which.
  const result = upsertMetric({
    clientId,
    metric,
    period,
    value,
    unit: typeof body.unit === "string" ? body.unit : "",
    sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ metric: result.metric });
}
