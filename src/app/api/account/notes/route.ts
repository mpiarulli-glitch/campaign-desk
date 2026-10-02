import { NextResponse } from "next/server";
import { createPersonalNote, listPersonalNotes, publicNote } from "@/lib/personal-notes";
import { isNotesOwner, requireNotesOwner } from "./guard";

export async function GET() {
  const owner = await requireNotesOwner();
  if (!isNotesOwner(owner)) return owner.response;
  return NextResponse.json({
    notes: listPersonalNotes(owner.slug).map(publicNote),
  });
}

export async function POST(request: Request) {
  const owner = await requireNotesOwner();
  if (!isNotesOwner(owner)) return owner.response;

  const raw = await request.json().catch(() => ({}));
  const body =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  if ("title" in body && typeof body.title !== "string") {
    return NextResponse.json({ error: "Title has to be text." }, { status: 400 });
  }
  if ("body" in body && typeof body.body !== "string") {
    return NextResponse.json({ error: "The note has to be text." }, { status: 400 });
  }

  const note = createPersonalNote(owner.slug, {
    title: typeof body.title === "string" ? body.title : "",
    body: typeof body.body === "string" ? body.body : "",
  });
  return NextResponse.json({ note: publicNote(note) });
}
