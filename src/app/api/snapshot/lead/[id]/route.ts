import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import {
  answerLead,
  deleteLead,
  getLead,
  updateLead,
  type LeadConverted,
  type LeadSource,
} from "@/lib/snapshot";

type Params = { params: Promise<{ id: string }> };

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

// Team-side edit. `converted` is normally the client's to set from the shared
// link, but the team can fill it in here for a client who answered on a call.
export async function PATCH(request: Request, { params }: Params) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const existing = getLead(id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  if (typeof body.receivedOn === "string" && body.receivedOn && !YMD_RE.test(body.receivedOn)) {
    return NextResponse.json({ error: "receivedOn must be YYYY-MM-DD" }, { status: 400 });
  }
  const patch: Parameters<typeof updateLead>[1] = {};
  if (typeof body.firstName === "string") patch.firstName = body.firstName;
  if (typeof body.lastName === "string") patch.lastName = body.lastName;
  if (typeof body.email === "string") patch.email = body.email;
  if (typeof body.phone === "string") patch.phone = body.phone;
  if (typeof body.source === "string") patch.source = body.source as LeadSource;
  if (typeof body.receivedOn === "string" && body.receivedOn) patch.receivedOn = body.receivedOn;
  if (typeof body.notes === "string") patch.notes = body.notes;

  let lead = Object.keys(patch).length ? updateLead(id, patch) : existing;
  if (typeof body.converted === "string") {
    lead =
      answerLead(
        existing.client_id,
        id,
        body.converted as LeadConverted,
        typeof body.clientNote === "string" ? body.clientNote : undefined
      ) || lead;
  }
  return NextResponse.json({ lead });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!deleteLead(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
