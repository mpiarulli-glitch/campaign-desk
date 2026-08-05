import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { isValidStage, moveClientStage, removeFromOnboarding } from "@/lib/onboarding";

type Params = { params: Promise<{ clientId: string }> };

// Drag-and-drop lands here: moves a client to a different column.
export async function PATCH(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { clientId } = await params;
  const body = await request.json().catch(() => ({}));
  const stage = typeof body.stage === "string" ? body.stage : "";
  if (!isValidStage(stage)) {
    return NextResponse.json({ error: "Not a real stage." }, { status: 400 });
  }
  moveClientStage(clientId, stage);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { clientId } = await params;
  removeFromOnboarding(clientId);
  return NextResponse.json({ ok: true });
}
