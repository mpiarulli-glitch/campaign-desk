import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { deleteSend, getSend, updateSend } from "@/lib/calendar";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getSend(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  if (body.sendDate !== undefined && !DATE_RE.test(body.sendDate)) {
    return NextResponse.json(
      { error: "sendDate must be YYYY-MM-DD" },
      { status: 400 }
    );
  }
  const send = updateSend(id, {
    clientId:
      body.clientId === null || typeof body.clientId === "string"
        ? body.clientId
        : undefined,
    clientName: typeof body.clientName === "string" ? body.clientName : undefined,
    title: typeof body.title === "string" ? body.title : undefined,
    sendDate: typeof body.sendDate === "string" ? body.sendDate : undefined,
    status: body.status,
    platform: typeof body.platform === "string" ? body.platform : undefined,
    note: typeof body.note === "string" ? body.note : undefined,
  });
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
