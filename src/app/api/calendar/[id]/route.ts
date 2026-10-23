import { NextResponse } from "next/server";
import { isAdminAuthenticated, isProductionAuthenticated } from "@/lib/auth";
import { cancelSend, deleteSend, getSend, updateSend } from "@/lib/calendar";
import { advanceLastProduction, appDateTime } from "@/lib/cadence";
import { getRevClient } from "@/lib/revenue";
import { sendProductionConfirmed } from "@/lib/production-emails";
import {
  isProductionRow,
  syncProductionScheduleEntry,
  videographerScheduleConflict,
} from "@/lib/production-schedule-sync";
import { BRIEF_FIELDS, MAX_FIELD_LENGTH } from "@/lib/scheduling";
import { isRealDate } from "@/lib/scheduling-rules";
import { listVideographers } from "@/lib/videographers";

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
  if (body.sendDate !== undefined && !isRealDate(body.sendDate)) {
    return NextResponse.json(
      { error: "sendDate must be a real date, as YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (typeof body.cancelled === "boolean") {
    if (!body.cancelled && before.cancelled_at && isProductionRow(before)) {
      const owner = before.client_id ? getRevClient(before.client_id) : null;
      const conflict = await videographerScheduleConflict({
        videographerId: owner?.videographer_id || "",
        date: before.send_date,
        time: before.send_time,
        duration: before.duration === "full" ? "full" : "half",
        today: appDateTime().date,
        audience: "admin",
        excludeEntryId: before.basecamp_schedule_entry_id,
      });
      if (!conflict.ok) {
        return NextResponse.json({ error: conflict.error }, { status: conflict.httpStatus });
      }
    }
    const send = cancelSend(id, body.cancelled);
    if (!send) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (isProductionRow(send)) void syncProductionScheduleEntry(send.id);
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
    if (Object.values(brief).some((value) => value.length > MAX_FIELD_LENGTH)) {
      return NextResponse.json(
        { error: `Keep each answer under ${MAX_FIELD_LENGTH} characters.` },
        { status: 400 }
      );
    }
    productionBrief = JSON.stringify(brief);
  }

  const nextDate = typeof body.sendDate === "string" ? body.sendDate : before.send_date;
  const nextTime = typeof body.sendTime === "string" ? body.sendTime : before.send_time;
  const nextDuration =
    body.duration === "full" || body.duration === "half"
      ? body.duration
      : before.duration === "full"
        ? "full"
        : "half";
  const slotChanged =
    nextDate !== before.send_date ||
    nextTime !== before.send_time ||
    nextDuration !== (before.duration === "full" ? "full" : "half");
  if (isProductionRow(before) && !before.cancelled_at && slotChanged) {
    const nextClientId =
      body.clientId === null || typeof body.clientId === "string"
        ? body.clientId
        : before.client_id;
    const owner = nextClientId ? getRevClient(nextClientId) : null;
    const conflict = await videographerScheduleConflict({
      videographerId: owner?.videographer_id || "",
      date: nextDate,
      time: nextTime,
      duration: nextDuration,
      today: appDateTime().date,
      audience: "admin",
      excludeEntryId: before.basecamp_schedule_entry_id,
    });
    if (!conflict.ok) {
      return NextResponse.json({ error: conflict.error }, { status: conflict.httpStatus });
    }
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

  if (send && isProductionRow(send)) void syncProductionScheduleEntry(send.id);

  return NextResponse.json({ send });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const before = getSend(id);
  if (before && isProductionRow(before) && !before.cancelled_at) {
    cancelSend(id, true);
  }
  if (before && isProductionRow(before)) {
    await syncProductionScheduleEntry(id);
  }
  const ok = deleteSend(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
