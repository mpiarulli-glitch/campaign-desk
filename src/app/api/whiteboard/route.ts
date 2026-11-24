import { NextResponse } from "next/server";
import { createBoard, listBoardsFor } from "@/lib/whiteboard";
import { unauthorized, whiteboardActor } from "./guard";

export async function GET() {
  const slug = await whiteboardActor();
  if (!slug) return unauthorized();
  return NextResponse.json({ boards: listBoardsFor(slug) });
}

export async function POST(request: Request) {
  const slug = await whiteboardActor();
  if (!slug) return unauthorized();
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title : "";
  const board = createBoard({ title, ownerSlug: slug });
  return NextResponse.json({
    board: {
      id: board.id,
      title: board.title,
      role: "owner",
      updatedAt: board.updated_at,
    },
  });
}
