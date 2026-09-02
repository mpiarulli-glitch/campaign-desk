import { NextResponse } from "next/server";
import { isAdsDashboardAuthenticated } from "@/lib/auth";
import { buildAdsRow, listAdsAnalytics, parseAdsPatch, upsertAdsAccount } from "@/lib/ads-dashboard";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  if (!(await isAdsDashboardAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { clientId } = await params;
  const row = clientId ? buildAdsRow(clientId) : null;
  if (!row) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }
  return NextResponse.json({ row, analytics: listAdsAnalytics(clientId) });
}

export async function PATCH(
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
  const parsed = parseAdsPatch(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const row = upsertAdsAccount(clientId, parsed);
  if (!row) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }
  return NextResponse.json({ row });
}
