import { NextResponse } from "next/server";
import { isOwnerToolsAuthenticated } from "@/lib/auth";
import { buildAdsDashboard } from "@/lib/ads-dashboard";

export async function GET() {
  if (!(await isOwnerToolsAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(buildAdsDashboard());
}
