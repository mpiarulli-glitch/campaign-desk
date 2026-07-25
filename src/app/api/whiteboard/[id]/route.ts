import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import { getAllRecords, getBoard } from "@/lib/whiteboard";

type Params = { params: Promise<{ id: string }> };

// Initial load: the board plus its full live record set and a sync cursor.
export async function GET(_request: Request, { params }: Params) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const board = getBoard(id);
  if (!board) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { records, now } = getAllRecords(id);
  return NextResponse.json({ board, records, now });
}
