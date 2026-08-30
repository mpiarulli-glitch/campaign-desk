import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { buildEmailAnalyticsDashboard } from "@/lib/ghl-email-stats";

// Agency-wide email performance over GoHighLevel. Admin-only: it spans every
// linked client, same gate as the Lifecycle subject bank.
export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  return NextResponse.json(buildEmailAnalyticsDashboard());
}
