import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { deleteOffer, updateOffer } from "@/lib/lifecycle-client-pages";
import { getRevClient } from "@/lib/revenue";

function statusFor(error: string): number {
  if (error === "Unknown client." || error.endsWith("not on this client.")) return 404;
  return 400;
}

async function gate(clientId: string): Promise<NextResponse | null> {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  if (!getRevClient(clientId)) {
    return NextResponse.json({ error: "Unknown client." }, { status: 404 });
  }
  return null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ clientId: string; id: string }> }
) {
  const { clientId, id } = await params;
  const denied = await gate(clientId);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const result = updateOffer(clientId, id, {
    name: "name" in body ? body.name : undefined,
    summary: "summary" in body ? body.summary : undefined,
    isFocus: "isFocus" in body ? body.isFocus : undefined,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusFor(result.error) });
  }
  return NextResponse.json({ offer: result.value });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ clientId: string; id: string }> }
) {
  const { clientId, id } = await params;
  const denied = await gate(clientId);
  if (denied) return denied;
  const result = deleteOffer(clientId, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: statusFor(result.error) });
  }
  return NextResponse.json({ ok: true });
}
