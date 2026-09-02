import { NextResponse } from "next/server";
import { isAdminWithAccess } from "@/lib/auth";
import { deleteTraining } from "@/lib/hub";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminWithAccess("page.hub"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { id } = await params;
  return NextResponse.json({ ok: deleteTraining(id) });
}
