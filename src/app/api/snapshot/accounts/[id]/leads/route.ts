import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import { addLead, getAccount, listLeads, type LeadSource } from "@/lib/snapshot";

type Params = { params: Promise<{ id: string }> };

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

// Leads for an account. ?week=YYYY-MM-DD narrows to that week; omitting it
// (or passing week=all) returns every lead.
export async function GET(request: Request, { params }: Params) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getAccount(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const week = new URL(request.url).searchParams.get("week") || "";
  return NextResponse.json({
    leads: listLeads(id, WEEK_RE.test(week) ? { week } : undefined),
  });
}

export async function POST(request: Request, { params }: Params) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getAccount(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  if (!firstName) {
    return NextResponse.json({ error: "First name is required" }, { status: 400 });
  }
  const receivedOn = typeof body.receivedOn === "string" ? body.receivedOn : "";
  if (receivedOn && !WEEK_RE.test(receivedOn)) {
    return NextResponse.json({ error: "receivedOn must be YYYY-MM-DD" }, { status: 400 });
  }
  const lead = addLead({
    clientId: id,
    firstName,
    lastName: typeof body.lastName === "string" ? body.lastName : "",
    email: typeof body.email === "string" ? body.email : "",
    phone: typeof body.phone === "string" ? body.phone : "",
    source: body.source as LeadSource,
    receivedOn,
    notes: typeof body.notes === "string" ? body.notes : "",
  });
  return NextResponse.json({ lead }, { status: 201 });
}
