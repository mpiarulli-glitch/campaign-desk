import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { deleteWin, updateWin } from "@/lib/snapshot";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const text = typeof body.body === "string" ? body.body : "";
  const happenedOn = typeof body.happenedOn === "string" ? body.happenedOn : undefined;
  const result = updateWin(id, { body: text, happenedOn });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error === "empty" ? "Win text is required" : "Not found" },
      { status: result.error === "empty" ? 400 : 404 }
    );
  }
  return NextResponse.json({ win: result.win });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await can("page.snapshot"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const ok = deleteWin(id);
  if (!ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
