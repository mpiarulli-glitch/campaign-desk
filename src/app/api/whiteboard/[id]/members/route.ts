import { NextResponse } from "next/server";
import { inviteMember, listMembers, removeMember, setMemberRole } from "@/lib/whiteboard";
import { forbidden, isResponse, notFound, requireBoard } from "../../guard";

type Params = { params: Promise<{ id: string }> };

function failure(status: "not_found" | "forbidden" | "invalid" | "too_large") {
  if (status === "forbidden") return forbidden();
  if (status === "invalid") {
    return NextResponse.json({ error: "That person cannot be added" }, { status: 400 });
  }
  return notFound();
}

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const gate = await requireBoard(id, "read");
  if (isResponse(gate)) return gate;
  const result = listMembers(id, gate.slug);
  if (!result.ok) return failure(result.error);
  return NextResponse.json({ members: result.members });
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const gate = await requireBoard(id, "share");
  if (isResponse(gate)) return gate;
  const body = await request.json().catch(() => ({}));
  const userSlug = typeof body.userSlug === "string" ? body.userSlug : "";
  const role = typeof body.role === "string" ? body.role : "";
  const result = inviteMember(id, gate.slug, userSlug, role);
  if (!result.ok) return failure(result.error);
  const members = listMembers(id, gate.slug);
  return NextResponse.json({ ok: true, role: result.role, members: members.ok ? members.members : [] });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const gate = await requireBoard(id, "share");
  if (isResponse(gate)) return gate;
  const body = await request.json().catch(() => ({}));
  const userSlug = typeof body.userSlug === "string" ? body.userSlug : "";
  const role = typeof body.role === "string" ? body.role : "";
  const result = setMemberRole(id, gate.slug, userSlug, role);
  if (!result.ok) return failure(result.error);
  const members = listMembers(id, gate.slug);
  return NextResponse.json({ ok: true, members: members.ok ? members.members : [] });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const gate = await requireBoard(id, "share");
  if (isResponse(gate)) return gate;
  const body = await request.json().catch(() => ({}));
  const userSlug = typeof body.userSlug === "string" ? body.userSlug : "";
  const result = removeMember(id, gate.slug, userSlug);
  if (!result.ok) return failure(result.error);
  const members = listMembers(id, gate.slug);
  return NextResponse.json({ ok: true, members: members.ok ? members.members : [] });
}
