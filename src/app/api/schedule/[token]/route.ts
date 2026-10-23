import { NextResponse } from "next/server";
import { getClientByScheduleToken } from "@/lib/cadence";
import { SAMPLE_SCHEDULE_TOKEN } from "@/lib/production-sms";
import {
  attachVideographerSchedule,
  getSchedulingStatus,
  sampleSchedulePreview,
  submitOutOfCycleBooking,
  submitProductionBooking,
} from "@/lib/scheduling";

type Params = { params: Promise<{ token: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  if (token === SAMPLE_SCHEDULE_TOKEN) {
    return NextResponse.json(sampleSchedulePreview());
  }
  const client = getClientByScheduleToken(token);
  if (!client) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(await attachVideographerSchedule(client, getSchedulingStatus(client)));
}

export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  if (token === SAMPLE_SCHEDULE_TOKEN) {
    return NextResponse.json(
      { error: "This is a test link. Nothing was booked." },
      { status: 400 }
    );
  }
  const client = getClientByScheduleToken(token);
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
