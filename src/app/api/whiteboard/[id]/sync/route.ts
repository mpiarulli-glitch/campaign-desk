import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import { getBoard, saveDoc } from "@/lib/whiteboard";

type Params = { params: Promise<{ id: string }> };

// Save the whole document snapshot. Returns the new revision.
export async function POST(request: Request, { params }: Params) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getBoard(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const snapshot = typeof body.snapshot === "string" ? body.snapshot : null;
  if (snapshot === null) {
    return NextResponse.json({ error: "Missing snapshot" }, { status: 400 });
  }
  const rev = saveDoc(id, snapshot);
  return NextResponse.json({ rev });
}
