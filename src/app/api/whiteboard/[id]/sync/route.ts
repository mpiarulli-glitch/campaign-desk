import { NextResponse } from "next/server";
import { saveScene, touchPresence } from "@/lib/whiteboard";
import { forbidden, isResponse, notFound, requireBoard } from "../../guard";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const gate = await requireBoard(id, "save");
  if (isResponse(gate)) return gate;
  const body = await request.json().catch(() => ({}));
  const result = saveScene(id, gate.slug, {
    elements: body.elements,
    files: body.files,
  });
  if (!result.ok) {
    if (result.error === "too_large") {
      return NextResponse.json({ error: "Board is too large" }, { status: 413 });
    }
    if (result.error === "forbidden") return forbidden();
    return notFound();
  }
  return NextResponse.json({
    ok: true,
    elements: result.scene.elements,
    files: result.scene.files,
    updatedAt: result.updatedAt,
    changed: result.changed,
    viewers: touchPresence(id, gate.slug),
  });
}
