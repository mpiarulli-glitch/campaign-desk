import { NextResponse } from "next/server";
import { isAdsDashboardAuthenticated } from "@/lib/auth";
import { parseAdsAnalyticsPatch, upsertAdsAnalytics } from "@/lib/ads-dashboard";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  if (!(await isAdsDashboardAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { clientId } = await params;
  if (!clientId) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }
  const body = await request.json().catch(() => null);
  const parsed = parseAdsAnalyticsPatch(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const month = upsertAdsAnalytics(clientId, parsed);
  if (!month) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }
  return NextResponse.json({ month });
}
