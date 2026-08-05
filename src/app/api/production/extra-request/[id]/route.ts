import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { getRevClient } from "@/lib/revenue";
import {
  cancelExtraRequest,
  getExtraRequest,
  sendExtraRequestOutreach,
} from "@/lib/extra-requests";

type Params = { params: Promise<{ id: string }> };

// Resends the outreach for an existing, still-open window — for when the
// card or email failed, or the client just needs a nudge.
export async function POST(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const extraRequest = getExtraRequest(id);
  if (!extraRequest) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (extraRequest.fulfilled_at || extraRequest.cancelled_at) {
    return NextResponse.json(
      { error: "This request is already closed." },
      { status: 409 }
    );
  }
  const client = getRevClient(extraRequest.client_id);
  if (!client) {
    return NextResponse.json({ error: "Client not found." }, { status: 404 });
  }
  const outreach = await sendExtraRequestOutreach(extraRequest, client);
  return NextResponse.json({ outreach });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getExtraRequest(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  cancelExtraRequest(id);
  return NextResponse.json({ ok: true });
}
