import { NextResponse } from "next/server";
import { getSession, isWorkflowAuthenticated } from "@/lib/auth";
import { deleteFlag, reopenFlag, resolveFlag } from "@/lib/client-flags";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const session = await getSession();
  const body = await request.json().catch(() => ({}));
  const who = session?.person || (session?.role === "admin" ? "admin" : "");
  const flag = body.resolved === false ? reopenFlag(id) : resolveFlag(id, who);
  if (!flag) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ flag });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  return NextResponse.json({ ok: deleteFlag(id) });
}
