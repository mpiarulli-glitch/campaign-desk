import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { clearBrandGuide, getBrandGuide, setBrandGuide } from "@/lib/lifecycle-client-pages";
import { getRevClient } from "@/lib/revenue";

async function gate(clientId: string): Promise<NextResponse | null> {
  if (!(await can("page.lifecycle"))) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  if (!getRevClient(clientId)) {
    return NextResponse.json({ error: "Unknown client." }, { status: 404 });
  }
  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const denied = await gate(clientId);
  if (denied) return denied;
  return NextResponse.json({ brand: getBrandGuide(clientId) });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const denied = await gate(clientId);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const result = setBrandGuide(clientId, body.url);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ brand: result.value });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const denied = await gate(clientId);
  if (denied) return denied;
  const result = clearBrandGuide(clientId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
