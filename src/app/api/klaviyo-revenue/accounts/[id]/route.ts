import { NextResponse } from "next/server";
import { KlaviyoError } from "@/lib/klaviyo";
import {
  getRevenueAccount,
  removeRevenueAccount,
  updateRevenueAccount,
  type MetricPatch,
} from "@/lib/klaviyo-revenue/accounts";
import { clearRevenueCache } from "@/lib/klaviyo-revenue/dashboard";
import { klaviyoOwner, klaviyoViewer } from "../../guard";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const denied = await klaviyoViewer();
  if (denied) return denied;
  const { id } = await params;
  const account = getRevenueAccount(id);
  if (!account) return NextResponse.json({ error: "That account is not connected." }, { status: 404 });
  return NextResponse.json({ account });
}

export async function PATCH(request: Request, { params }: Params) {
  const denied = await klaviyoOwner();
  if (denied) return denied;
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: MetricPatch = {};
  if (typeof body.name === "string") patch.name = body.name;
  for (const key of ["bookingMetricId", "formMetricId", "conversionMetricId", "smsMetricId"] as const) {
    if (body[key] === null || body[key] === "") patch[key] = null;
    else if (typeof body[key] === "string") patch[key] = body[key];
  }
  try {
    const account = updateRevenueAccount(id, patch);
    clearRevenueCache();
    return NextResponse.json({ account });
  } catch (err) {
    const message = err instanceof KlaviyoError ? err.message : "Could not update that account.";
    const status = err instanceof KlaviyoError && err.status ? err.status : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const denied = await klaviyoOwner();
  if (denied) return denied;
  const { id } = await params;
  removeRevenueAccount(id);
  clearRevenueCache();
  return NextResponse.json({ ok: true });
}
