import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import { getBoard, getChangesSince } from "@/lib/whiteboard";

type Params = { params: Promise<{ id: string }> };

// Poll target: records changed since the client's last sync timestamp, plus the
// server clock the client stores as its next `since`.
export async function GET(request: Request, { params }: Params) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getBoard(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Default to epoch so a client with no cursor gets everything on first poll.
  const since =
    new URL(request.url).searchParams.get("since") || "1970-01-01T00:00:00.000Z";
  return NextResponse.json(getChangesSince(id, since));
}
