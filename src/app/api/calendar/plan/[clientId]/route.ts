import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { getRevClient } from "@/lib/revenue";
import {
  clearApproval,
  getOrCreateCalendarToken,
  listFeedback,
  rotateCalendarToken,
} from "@/lib/plan";

type Params = { params: Promise<{ clientId: string }> };

// Admin view of a client's editorial-plan sharing: token, approval, notes.
export async function GET(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { clientId } = await params;
  const client = getRevClient(clientId);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    token: getOrCreateCalendarToken(clientId),
    approvedAt: client.calendar_approved_at,
    approvedBy: client.calendar_approved_by,
    feedback: listFeedback(clientId),
  });
}

// Rotate the share link, or clear a stale approval so the client re-signs off.
export async function POST(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { clientId } = await params;
  if (!getRevClient(clientId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  if (body.action === "rotate") {
    return NextResponse.json({ token: rotateCalendarToken(clientId) });
  }
  if (body.action === "clearApproval") {
    clearApproval(clientId);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
