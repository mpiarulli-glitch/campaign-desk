import { NextResponse } from "next/server";
import { getSession, isWorkflowAuthenticated } from "@/lib/auth";
import { getRevClient } from "@/lib/revenue";
import { createFlag, listFlags, normLevel } from "@/lib/client-flags";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  return NextResponse.json({ flags: listFlags(id) });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isWorkflowAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!getRevClient(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const session = await getSession();
  const body = await request.json().catch(() => ({}));
  const flag = createFlag({
    clientId: id,
    level: normLevel(body.level),
    note: typeof body.note === "string" ? body.note : "",
    createdBy: session?.person || (session?.role === "admin" ? "admin" : ""),
  });
  return NextResponse.json({ flag });
}
