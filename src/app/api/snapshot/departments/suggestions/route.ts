import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { getVisibleSnapshotAccount } from "@/lib/snapshot";
import {
  dismissWeekSuggestion,
  weekBasecampSuggestions,
} from "@/lib/snapshot-basecamp-suggest";

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") || "";
  const week = url.searchParams.get("week") || "";
  if (!clientId || !WEEK_RE.test(week)) {
    return NextResponse.json(
      { error: "clientId and week (YYYY-MM-DD) are required" },
      { status: 400 }
    );
  }
  if (!getVisibleSnapshotAccount(clientId)) {
    return NextResponse.json({ suggestions: [] });
  }
  const suggestions = await weekBasecampSuggestions(clientId, week, {
    refresh: url.searchParams.get("refresh") === "1",
  });
  return NextResponse.json({ suggestions });
}

export async function POST(request: Request) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  const weekStart = typeof body.weekStart === "string" ? body.weekStart : "";
  const sourceKey = typeof body.sourceKey === "string" ? body.sourceKey : "";
  if (!clientId || !WEEK_RE.test(weekStart) || !sourceKey.trim()) {
    return NextResponse.json(
      { error: "clientId, weekStart, and sourceKey are required" },
      { status: 400 }
    );
  }
  if (!getVisibleSnapshotAccount(clientId)) {
    return NextResponse.json({ ok: true });
  }
  dismissWeekSuggestion({ clientId, weekStart, sourceKey });
  return NextResponse.json({ ok: true });
}
