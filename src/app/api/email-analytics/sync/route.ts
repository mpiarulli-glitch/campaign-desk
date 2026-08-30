import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import {
  buildEmailAnalyticsDashboard,
  syncGhlEmailStats,
} from "@/lib/ghl-email-stats";

// Pull fresh per-send stats from GoHighLevel into the local cache, then return
// the rebuilt dashboard so the UI can refresh in one round trip.
export async function POST() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }

  const sync = await syncGhlEmailStats();
  const dashboard = buildEmailAnalyticsDashboard();
  return NextResponse.json({ sync, dashboard }, { status: sync.ok || sync.configured ? 200 : 503 });
}
