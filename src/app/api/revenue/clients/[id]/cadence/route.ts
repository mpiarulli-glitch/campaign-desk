import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { getRevClient } from "@/lib/revenue";
import { computeCycleStatus, findSendForWindow, nextWindow, todayYmd } from "@/lib/cadence";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const client = getRevClient(id);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const today = todayYmd();
  const window = nextWindow(client, today);
  const status = computeCycleStatus(client, window, today);
  const existing = window ? findSendForWindow(client.id, window.start) : null;

  return NextResponse.json({
    window,
    status,
    existingSend: existing
      ? {
          sendDate: existing.send_date,
          sendTime: existing.send_time,
          status: existing.status,
        }
      : null,
  });
}
