import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import {
  deleteBoardCard,
  moveBoardCard,
  updateBoardCardNotes,
} from "@/lib/lifecycle-board";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  if (typeof body.notes === "string") {
    const ok = updateBoardCardNotes(id, body.notes);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  const ok = moveBoardCard(id, {
    columnKey: typeof body.columnKey === "string" ? body.columnKey : undefined,
    sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : undefined,
  });
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { id } = await params;
  return NextResponse.json({ ok: deleteBoardCard(id) });
}
