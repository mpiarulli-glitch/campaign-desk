import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import {
  buildEmailAnalyticsDashboard,
  parseEmailAnalyticsPeriod,
  syncGhlEmailStats,
} from "@/lib/ghl-email-stats";

// Pull fresh per-send stats from GoHighLevel into the local cache (six months),
// then return the dashboard for the requested window.
export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }

  const period = parseEmailAnalyticsPeriod(req.nextUrl.searchParams.get("period"));
  const sync = await syncGhlEmailStats();
  const dashboard = buildEmailAnalyticsDashboard(period);
  return NextResponse.json({ sync, dashboard }, { status: sync.ok || sync.configured ? 200 : 503 });
}
