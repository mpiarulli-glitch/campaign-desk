import { NextResponse } from "next/server";
import { deleteBoard, readBoard, renameBoard } from "@/lib/whiteboard";
import { forbidden, isResponse, notFound, requireBoard } from "../guard";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const gate = await requireBoard(id, "read");
  if (isResponse(gate)) return gate;
  const loaded = readBoard(id, gate.slug);
  if (!loaded) return notFound();
  return NextResponse.json({
    board: loaded.board,
    scene: loaded.scene,
    viewers: loaded.viewers,
    updatedAt: loaded.board.updatedAt,
  });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const gate = await requireBoard(id, "rename");
  if (isResponse(gate)) return gate;
  const body = await request.json().catch(() => ({}));
  if (typeof body.title !== "string") {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  const result = renameBoard(id, gate.slug, body.title);
  if (!result.ok) return result.error === "forbidden" ? forbidden() : notFound();
  return NextResponse.json({ board: result.board });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const gate = await requireBoard(id, "delete");
  if (isResponse(gate)) return gate;
  const result = deleteBoard(id, gate.slug);
  if (!result.ok) return result.error === "forbidden" ? forbidden() : notFound();
  return NextResponse.json({ ok: true });
}
