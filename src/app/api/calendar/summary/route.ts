import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { clientCalendarSummary } from "@/lib/calendar";
import { getRevClient } from "@/lib/revenue";

/**
 * The editorial footprint of one client's calendar: does it exist, and which
 * months does it cover.
 *
 * Its own endpoint rather than a field on the month listing, because the two
 * answer different questions and must not share the month listing's team scoping.
 * "Has this client got a calendar" is a fact about the account: a viewer who only
 * sees social work must not be told to build a calendar already full of email.
 *
 * Open to any signed-in role. The prompt it drives is only actionable for an
 * admin, but "this client has no calendar yet" is worth knowing either way.
 */
export async function GET(request: Request) {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  if (!clientId || !getRevClient(clientId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(clientCalendarSummary(clientId));
}
