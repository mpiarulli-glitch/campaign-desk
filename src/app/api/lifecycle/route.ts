import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { buildLifecycleDashboard } from "@/lib/lifecycle-dashboard";
import { getRefreshSettings } from "@/lib/lifecycle";

// The Lifecycle dashboard is admin-only: it aggregates every client's
// approvals, automations and outreach performance in one place.
export async function GET(request: Request) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const force = new URL(request.url).searchParams.get("refresh") === "1";
  const dashboard = await buildLifecycleDashboard(force);
  return NextResponse.json({ ...dashboard, refreshSettings: getRefreshSettings() });
}
