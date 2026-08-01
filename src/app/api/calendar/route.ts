import { NextResponse } from "next/server";
import { getSession, isAdminAuthenticated, sessionFocusSlug } from "@/lib/auth";
import { teamFocus } from "@/lib/people";
import { createSend, listSends } from "@/lib/calendar";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
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
  // People start on the slice of the calendar their team owns (TEAM_FOCUS), and
  // ?all=1 lifts it. That makes this a default view rather than a wall, except
  // for an empty focus, which means they do no campaign work at all.
  const focusSlug = await sessionFocusSlug();
  const focus = teamFocus(focusSlug);
  const showAll = url.searchParams.get("all") === "1";
  // An empty focus is not something a toggle should escape.
  const ownsNothing = focus !== null && focus.length === 0;
  const narrowed = focus !== null && (ownsNothing || !showAll);
  const sends = listSends(start, end, narrowed ? { assetTypes: focus } : undefined);
  // Basecamp schedule entries are deliberately not returned. The campaign
  // calendar is for planned work; meetings stay in Basecamp and are picked up in
  // Forecast. The basecamp_events cache is still maintained for that picker.
  const scope = {
    // Only offer the toggle to someone who has a focus they could step outside.
    canToggle: focus !== null && !ownsNothing,
    narrowed,
    assetTypes: focus ?? null,
  };
  if (session.role === "forecast") {
    return NextResponse.json({
      sends: sends.map((send) => ({
        ...send,
        note: "",
        production_brief: "",
      })),
      scope,
    });
  }
  return NextResponse.json({ sends, scope });
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
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const send = createSend({
    clientId: typeof body.clientId === "string" ? body.clientId : null,
    clientName: str(body.clientName),
    title,
    sendDate,
    sendTime: str(body.sendTime),
    status: body.status,
    platform: str(body.platform),
    assetType: body.assetType,
    note: str(body.note),
    audience: str(body.audience),
    purpose: str(body.purpose),
    offer: str(body.offer),
    subject: str(body.subject),
    previewText: str(body.previewText),
  });
  return NextResponse.json({ send }, { status: 201 });
}
