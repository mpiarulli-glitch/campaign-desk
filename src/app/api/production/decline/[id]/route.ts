import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { clearDeclineById, getDecline } from "@/lib/window-declines";

type Params = { params: Promise<{ id: string }> };

// Hands a declined window back, so the client is asked for it again from the
// next reminder sweep. For when the reason has passed: the trip got cancelled,
// the site is ready after all, or somebody sorted it out over the phone.
export async function DELETE(_request: Request, { params }: Params) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getDecline(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  clearDeclineById(id);
  return NextResponse.json({ ok: true });
}
