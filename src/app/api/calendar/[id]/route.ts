import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import { deleteSend, getSend, updateSend } from "@/lib/calendar";
import { advanceLastProduction } from "@/lib/cadence";
import { getRevClient } from "@/lib/revenue";
import { sendProductionConfirmed } from "@/lib/production-emails";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const before = getSend(id);
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  if (body.sendDate !== undefined && !DATE_RE.test(body.sendDate)) {
    return NextResponse.json(
      { error: "sendDate must be YYYY-MM-DD" },
      { status: 400 }
    );
  }
  const optStr = (v: unknown) => (typeof v === "string" ? v : undefined);
  const send = updateSend(id, {
    clientId:
      body.clientId === null || typeof body.clientId === "string"
        ? body.clientId
        : undefined,
    clientName: optStr(body.clientName),
    title: optStr(body.title),
    sendDate: optStr(body.sendDate),
    sendTime: optStr(body.sendTime),
    status: body.status,
    platform: optStr(body.platform),
    assetType: body.assetType,
    note: optStr(body.note),
    audience: optStr(body.audience),
    purpose: optStr(body.purpose),
    offer: optStr(body.offer),
    subject: optStr(body.subject),
    previewText: optStr(body.previewText),
  });

  if (
    send &&
    send.status === "sent" &&
    before.status !== "sent" &&
    send.client_id &&
    send.cadence_window_start
  ) {
    advanceLastProduction(send.client_id, send.send_date);
  }

  // A production request just got locked in — let the client know.
  if (
    send &&
    before.status === "requested" &&
    (send.status === "scheduled" || send.status === "planned") &&
    send.client_id
  ) {
    const client = getRevClient(send.client_id);
    if (client) void sendProductionConfirmed(client, send);
  }

  return NextResponse.json({ send });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const ok = deleteSend(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
