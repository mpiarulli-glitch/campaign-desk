import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import { nowIso } from "@/lib/db";
import { getAllRecords, getBoard } from "@/lib/whiteboard";

type Params = { params: Promise<{ id: string }> };

// Initial load: the board plus its full live record set.
export async function GET(_request: Request, { params }: Params) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const board = getBoard(id);
  if (!board) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Capture the clock before reading so the client's first poll cursor cannot
  // skip a change that lands mid-read.
  const now = nowIso();
  return NextResponse.json({ board, records: getAllRecords(id), now });
}
