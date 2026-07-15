import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { createSend, listSends } from "@/lib/calendar";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const start = url.searchParams.get("start") || "";
  const end = url.searchParams.get("end") || "";
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    return NextResponse.json(
      { error: "start and end (YYYY-MM-DD) are required" },
      { status: 400 }
    );
  }
  return NextResponse.json({ sends: listSends(start, end) });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const sendDate = typeof body.sendDate === "string" ? body.sendDate : "";
  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (!DATE_RE.test(sendDate)) {
    return NextResponse.json(
      { error: "sendDate must be YYYY-MM-DD" },
      { status: 400 }
    );
  }
  const send = createSend({
    clientId: typeof body.clientId === "string" ? body.clientId : null,
    clientName: typeof body.clientName === "string" ? body.clientName : "",
    title,
    sendDate,
    status: body.status,
    platform: typeof body.platform === "string" ? body.platform : "",
    note: typeof body.note === "string" ? body.note : "",
  });
  return NextResponse.json({ send }, { status: 201 });
}
