import { NextResponse } from "next/server";
import { can, getSession } from "@/lib/auth";
import { OWNER_SLUG } from "@/lib/people";
import { accessFor, authorize, type BoardAction, type BoardRole } from "@/lib/whiteboard";

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/** The person this session is acting as. Null when they cannot open Whiteboards. */
export async function whiteboardActor(): Promise<string | null> {
  if (!(await can("page.whiteboard"))) return null;
  const session = await getSession();
  if (!session) return null;
  if (session.role === "admin" && !session.person) return OWNER_SLUG;
  return session.person;
}

export async function requireBoard(
  boardId: string,
  action: BoardAction
): Promise<{ slug: string; role: BoardRole } | NextResponse> {
  const slug = await whiteboardActor();
  if (!slug) return unauthorized();
  const role = accessFor(boardId, slug);
  const decision = authorize(role, action);
  if (decision === "not_found") return notFound();
  if (decision === "forbidden") return forbidden();
  return { slug, role: role! };
}

export function isResponse(value: { slug: string; role: BoardRole } | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}
