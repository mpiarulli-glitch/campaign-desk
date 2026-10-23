import { NextResponse } from "next/server";
import { getClientByDashboardToken } from "@/lib/dashboard";
import {
  attachVideographerSchedule,
  getSchedulingStatus,
  submitOutOfCycleBooking,
  submitProductionBooking,
} from "@/lib/scheduling";

type Params = { params: Promise<{ token: string }> };

// Public, read/write via the dashboard token — same booking rules as
// /api/schedule/[token] (see src/lib/scheduling.ts), just resolved by a
// different token so the client dashboard doesn't need a second link.
export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  const client = getClientByDashboardToken(token);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(await attachVideographerSchedule(client, getSchedulingStatus(client)));
}

export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  const client = getClientByDashboardToken(token);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const result =
    body.mode === "extra"
      ? await submitOutOfCycleBooking(client, body)
      : await submitProductionBooking(client, body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.httpStatus });
  }
  return NextResponse.json({ send: result.send }, { status: 201 });
}
