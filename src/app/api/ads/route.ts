import { NextResponse } from "next/server";
import { isAdsDashboardAuthenticated } from "@/lib/auth";
import { buildAdsDashboard } from "@/lib/ads-dashboard";

export async function GET() {
  if (!(await isAdsDashboardAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(buildAdsDashboard());
}
