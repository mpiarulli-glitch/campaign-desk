import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { toggleStep } from "@/lib/onboarding";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  toggleStep(id, body.completed === true);
  return NextResponse.json({ ok: true });
}
