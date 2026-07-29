import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { deleteNote, updateNote } from "@/lib/lifecycle";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const note = updateNote(id, {
    title: typeof body.title === "string" ? body.title : undefined,
    body: typeof body.body === "string" ? body.body : undefined,
    clientId: body.clientId === null || typeof body.clientId === "string" ? body.clientId : undefined,
    tags: typeof body.tags === "string" ? body.tags : undefined,
    pinned: typeof body.pinned === "boolean" ? body.pinned : undefined,
  });
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ note });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { id } = await params;
  return NextResponse.json({ ok: deleteNote(id) });
}
