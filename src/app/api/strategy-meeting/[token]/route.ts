import { NextResponse } from "next/server";
import { bookStrategyMeeting, getProspectByStrategyMeetingToken } from "@/lib/onboarding";
import { isRealDate } from "@/lib/scheduling-rules";

type Params = { params: Promise<{ token: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  const prospect = getProspectByStrategyMeetingToken(token);
  if (!prospect) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    name: prospect.name,
    contactName: prospect.contact_name,
    strategyMeetingAt: prospect.strategy_meeting_at,
  });
}

export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  if (!getProspectByStrategyMeetingToken(token)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const date = typeof body.date === "string" ? body.date : "";
  const time = typeof body.time === "string" ? body.time : "";
  if (!isRealDate(date) || !time) {
    return NextResponse.json({ error: "Pick a real date and time." }, { status: 400 });
  }
  const prospect = await bookStrategyMeeting(token, `${date} ${time}`);
  if (!prospect) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, strategyMeetingAt: prospect.strategy_meeting_at });
}
