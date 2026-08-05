import { NextResponse } from "next/server";
import { isWorkflowAuthenticated } from "@/lib/auth";
import { deleteFolder, renameFolder } from "@/lib/whiteboard";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title : "";
  renameFolder(id, title);
  return NextResponse.json({ ok: true });
}

// Deleting a folder never deletes its boards — they fall back to unfiled.
export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  deleteFolder(id);
  return NextResponse.json({ ok: true });
}
