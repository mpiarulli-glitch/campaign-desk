import { NextResponse } from "next/server";
import { getSession, isWorkflowAuthenticated } from "@/lib/auth";
import { listMessages, postMessage } from "@/lib/chat";
import { teamLabel } from "@/lib/team";

// Team members may read/write any room: the global team chat, per-client
// internal threads, and the client-shared threads.
function validRoom(room: string): boolean {
  return (
    room === "team" ||
    /^team:[A-Za-z0-9_-]+$/.test(room) ||
    /^client:[A-Za-z0-9_-]+$/.test(room)
  );
}

export async function GET(request: Request) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const room = new URL(request.url).searchParams.get("room") || "";
  if (!validRoom(room)) {
    return NextResponse.json({ error: "Bad room" }, { status: 400 });
  }
  return NextResponse.json({ messages: listMessages(room) });
}

export async function POST(request: Request) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await getSession();
  const body = await request.json().catch(() => ({}));
  const room = typeof body.room === "string" ? body.room : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!validRoom(room)) {
    return NextResponse.json({ error: "Bad room" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }
  const authorName = session?.person ? teamLabel(session.person) : "Team";
  const msg = postMessage({
    room,
    body: text,
    authorName,
    authorSlug: session?.person || "",
    isClient: false,
  });
  return NextResponse.json({ message: msg });
}
