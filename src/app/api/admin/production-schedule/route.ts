import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { backfillProductionSchedule } from "@/lib/production-schedule-sync";

// Adds future productions that are not on the Video Editing Team schedule yet.
// An admin action, never startup: Railway's health check cannot wait on Basecamp.

export async function POST() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await backfillProductionSchedule();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
