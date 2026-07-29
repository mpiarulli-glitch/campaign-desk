import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { deleteAutomation, updateAutomation } from "@/lib/lifecycle";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const automation = updateAutomation(id, {
    name: typeof body.name === "string" ? body.name : undefined,
    clientId: body.clientId === null || typeof body.clientId === "string" ? body.clientId : undefined,
    platform: typeof body.platform === "string" ? body.platform : undefined,
    kind: typeof body.kind === "string" ? body.kind : undefined,
    status: typeof body.status === "string" ? body.status : undefined,
    accountRef: typeof body.accountRef === "string" ? body.accountRef : undefined,
    description: typeof body.description === "string" ? body.description : undefined,
    link: typeof body.link === "string" ? body.link : undefined,
    markReviewed: body.markReviewed === true,
  });
  if (!automation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ automation });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const { id } = await params;
  return NextResponse.json({ ok: deleteAutomation(id) });
}
