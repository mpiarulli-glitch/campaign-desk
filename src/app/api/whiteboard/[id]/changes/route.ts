import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import { getBoard, getRev } from "@/lib/whiteboard";

type Params = { params: Promise<{ id: string }> };

// Lightweight poll: the current revision only. Clients fetch the full snapshot
// from the board route when this revision is newer than the one they hold.
export async function GET(_request: Request, { params }: Params) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getBoard(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ rev: getRev(id) });
}
