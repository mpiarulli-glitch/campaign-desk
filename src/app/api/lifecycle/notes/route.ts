import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth";
import { createNote, listNotes } from "@/lib/lifecycle";

export async function GET(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const clientId = new URL(request.url).searchParams.get("clientId") || undefined;
  return NextResponse.json({ notes: listNotes(clientId) });
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Admins only" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const noteBody = typeof body.body === "string" ? body.body.trim() : "";
  if (!title && !noteBody) {
    return NextResponse.json({ error: "Add a title or some text." }, { status: 400 });
  }
  return NextResponse.json({
    note: createNote({
      title,
      body: noteBody,
      clientId: typeof body.clientId === "string" ? body.clientId : null,
      tags: typeof body.tags === "string" ? body.tags : undefined,
      pinned: body.pinned === true,
    }),
  });
}
