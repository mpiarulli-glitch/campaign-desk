import { NextResponse } from "next/server";
import { changesSince } from "@/lib/whiteboard";
import { isResponse, notFound, requireBoard } from "../../guard";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const gate = await requireBoard(id, "read");
  if (isResponse(gate)) return gate;
  const since = new URL(request.url).searchParams.get("since");
  const result = changesSince(id, gate.slug, since);
  if (!result) return notFound();
  return NextResponse.json({
    elements: result.scene.elements,
    files: result.scene.files,
    updatedAt: result.updatedAt,
    full: result.full,
    viewers: result.viewers,
  });
}
