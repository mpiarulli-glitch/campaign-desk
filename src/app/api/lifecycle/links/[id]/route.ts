import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { deleteLink } from "@/lib/lifecycle";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { id } = await params;
  return NextResponse.json({ ok: deleteLink(id) });
}
