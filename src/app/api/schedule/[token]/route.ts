import { NextResponse } from "next/server";
import { getClientByScheduleToken } from "@/lib/cadence";
import { getSchedulingStatus, submitProductionBooking } from "@/lib/scheduling";

type Params = { params: Promise<{ token: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  const client = getClientByScheduleToken(token);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(getSchedulingStatus(client));
}

export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  const client = getClientByScheduleToken(token);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const result = await submitProductionBooking(client, body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.httpStatus });
  }
  return NextResponse.json({ send: result.send }, { status: 201 });
}
