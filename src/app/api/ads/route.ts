import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { buildAdsDashboard } from "@/lib/ads-dashboard";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  return NextResponse.json(buildAdsDashboard());
}
