import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import { getBoard, getDoc } from "@/lib/whiteboard";

type Params = { params: Promise<{ id: string }> };

// Initial load: the board plus its full document snapshot and revision.
export async function GET(_request: Request, { params }: Params) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const board = getBoard(id);
  if (!board) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const doc = getDoc(id);
  return NextResponse.json({ board, rev: doc.rev, snapshot: doc.snapshot });
}
