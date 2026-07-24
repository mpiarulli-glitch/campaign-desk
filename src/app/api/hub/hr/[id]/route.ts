import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { setHrStatus } from "@/lib/hub";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const issue = setHrStatus(id, typeof body.status === "string" ? body.status : "");
  if (!issue) return NextResponse.json({ error: "Bad status or not found" }, { status: 400 });
  return NextResponse.json({ issue });
}
