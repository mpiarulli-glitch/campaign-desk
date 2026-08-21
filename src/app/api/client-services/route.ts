import { NextResponse } from "next/server";
import { isAdminAuthenticated, isWorkflowAuthenticated } from "@/lib/auth";
import { getRevClient, updateRevClient } from "@/lib/revenue";
import {
  clientServiceRows,
  clientServiceSummary,
  currentWeekStart,
  outreachForClient,
  sendingEnabled,
  sendWeeklyAsk,
} from "@/lib/client-services";

// The Client Services Hub dashboard: one row per active client with this week's
// ask and how far it got.
export async function GET(request: Request) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId");
  // A single client's outreach history, for the row's expanded view.
  if (clientId) {
    return NextResponse.json({ history: outreachForClient(clientId) });
  }
  const rows = clientServiceRows();
  return NextResponse.json({
    weekStart: currentWeekStart(),
    rows,
    summary: clientServiceSummary(rows),
    sendingEnabled: sendingEnabled(),
  });
}

// Send one client's ask now, or pause/resume their outreach. Both are admin-only
// because both are outward-facing: one emails a client, the other stops them
// being contacted at all.
export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";
  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }
  const client = getRevClient(clientId);
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  if (action === "pause" || action === "resume") {
    updateRevClient(clientId, { outreachPaused: action === "pause" });
    const rows = clientServiceRows();
    return NextResponse.json({ ok: true, rows, summary: clientServiceSummary(rows) });
  }

  if (action === "send") {
    const result = await sendWeeklyAsk({
      client,
      weekStart: currentWeekStart(),
      appUrl: process.env.NEXT_PUBLIC_APP_URL || "",
      dryRun: body.dryRun === true,
    });
    const rows = clientServiceRows();
    return NextResponse.json({
      ok: result.email.ok || result.basecamp.ok,
      result,
      rows,
      summary: clientServiceSummary(rows),
      sendingEnabled: sendingEnabled(),
    });
  }

  return NextResponse.json(
    { error: "action must be send, pause, or resume" },
    { status: 400 }
  );
}
