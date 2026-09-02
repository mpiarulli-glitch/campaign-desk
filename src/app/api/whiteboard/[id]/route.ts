import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { deleteBoard, getAllRecords, getBoard, moveBoardToFolder } from "@/lib/whiteboard";

type Params = { params: Promise<{ id: string }> };

// Initial load: the board plus its full live record set and a sync cursor.
export async function GET(_request: Request, { params }: Params) {
  if (!(await can("page.whiteboard"))) {
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

// Move a board into a folder, or clear it back to unfiled with folderId: null.
export async function PATCH(request: Request, { params }: Params) {
  if (!(await can("page.whiteboard"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getBoard(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  if ("folderId" in body) {
    const folderId = typeof body.folderId === "string" ? body.folderId : null;
    moveBoardToFolder(id, folderId);
  }
  return NextResponse.json({ board: getBoard(id) });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await can("page.whiteboard"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getBoard(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  deleteBoard(id);
  return NextResponse.json({ ok: true });
}
