import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { isValidStage, moveProspectStage, removeProspect } from "@/lib/onboarding";

type Params = { params: Promise<{ prospectId: string }> };

// Drag-and-drop lands here: moves a prospect to a different column.
export async function PATCH(request: Request, { params }: Params) {
  if (!(await can("page.onboarding"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { prospectId } = await params;
  const body = await request.json().catch(() => ({}));
  const stage = typeof body.stage === "string" ? body.stage : "";
  if (!isValidStage(stage)) {
    return NextResponse.json({ error: "Not a real stage." }, { status: 400 });
  }
  moveProspectStage(prospectId, stage);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await can("page.onboarding"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { prospectId } = await params;
  removeProspect(prospectId);
  return NextResponse.json({ ok: true });
}
