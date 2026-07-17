import { NextResponse } from "next/server";
import { approvePlan, getClientByCalendarToken } from "@/lib/plan";

type Params = { params: Promise<{ token: string }> };

// Public: the client signs off on the shared editorial calendar.
export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  const client = getClientByCalendarToken(token);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name : "";
  const result = approvePlan(client.id, name);
  return NextResponse.json({ ok: true, ...result });
}
