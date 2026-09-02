import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { applyChanges, getBoard, type WireRecord } from "@/lib/whiteboard";

type Params = { params: Promise<{ id: string }> };

// A client pushes only the records it changed (and ids it removed).
export async function POST(request: Request, { params }: Params) {
  if (!(await can("page.whiteboard"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getBoard(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const put: WireRecord[] = Array.isArray(body.put)
    ? body.put.filter(
        (r: unknown): r is WireRecord =>
          !!r && typeof (r as WireRecord).id === "string"
      )
    : [];
  const remove: string[] = Array.isArray(body.remove)
    ? body.remove.filter((x: unknown): x is string => typeof x === "string")
    : [];
  if (put.length || remove.length) {
    applyChanges(id, { put, remove });
  }
  return NextResponse.json({ ok: true });
}
