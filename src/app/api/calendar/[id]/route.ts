import { NextResponse } from "next/server";
import { isAdminAuthenticated, isProductionAuthenticated } from "@/lib/auth";
import { archiveSend, deleteSend, getSend, updateSend } from "@/lib/calendar";
import { advanceLastProduction } from "@/lib/cadence";
import { getRevClient } from "@/lib/revenue";
import { sendProductionConfirmed } from "@/lib/production-emails";
import { BRIEF_FIELDS } from "@/lib/scheduling";
import { listVideographers } from "@/lib/videographers";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!(await isProductionAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const send = getSend(id);
  if (!send) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const client = send.client_id ? getRevClient(send.client_id) : null;
  const videographer = client?.videographer_id
    ? listVideographers(true).find((person) => person.id === client.videographer_id)
    : null;
  return NextResponse.json({
    send,
    client: client
      ? {
          id: client.id,
          name: client.name,
          accountManager: client.account_manager,
          videographer: videographer?.name || "",
        }
      : null,
  });
}

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
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
  if (typeof body.archived === "boolean") {
    const send = archiveSend(id, body.archived);
    if (!send) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ send });
  }

  const optStr = (v: unknown) => (typeof v === "string" ? v : undefined);

  // Production brief. Sent as an object and stored as JSON, filtered to the
  // known fields so an admin form can't write arbitrary keys into the record.
  // Absent means "leave the brief alone"; an empty object clears it.
  let productionBrief: string | undefined;
  if (body.brief && typeof body.brief === "object") {
    const raw = body.brief as Record<string, unknown>;
    const brief: Record<string, string> = {};
    for (const key of BRIEF_FIELDS) {
      const v = raw[key];
      if (typeof v === "string" && v.trim()) brief[key] = v.trim();
    }
    productionBrief = JSON.stringify(brief);
  }

  const send = updateSend(id, {
    duration: body.duration === "full" || body.duration === "half" ? body.duration : undefined,
    productionBrief,
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
    if (client) await sendProductionConfirmed(client, send);
  }

  return NextResponse.json({ send });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const ok = deleteSend(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
