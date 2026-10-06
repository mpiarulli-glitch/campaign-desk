import { NextResponse } from "next/server";
import { can } from "@/lib/auth";
import { createMoodReference, listMoodReferences } from "@/lib/lifecycle-client-pages";
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
  return NextResponse.json({ references: listMoodReferences(clientId) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params;
  const denied = await gate(clientId);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const result = createMoodReference(clientId, {
    title: body.title,
    url: body.url,
    note: body.note,
  });
  if (!result.ok) {
    const status = result.error === "Unknown client." ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ reference: result.value });
}
