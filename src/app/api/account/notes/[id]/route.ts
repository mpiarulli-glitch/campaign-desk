import { NextResponse } from "next/server";
import {
  deletePersonalNote,
  getPersonalNote,
  publicNote,
  updatePersonalNote,
  type NotePatch,
} from "@/lib/personal-notes";
import { isNotesOwner, requireNotesOwner } from "../guard";

type Params = { params: Promise<{ id: string }> };

const MISSING = "That note is not in your notebook.";

export async function GET(_request: Request, { params }: Params) {
  const owner = await requireNotesOwner();
  if (!isNotesOwner(owner)) return owner.response;
  const { id } = await params;
  const note = getPersonalNote(owner.slug, id);
  if (!note) return NextResponse.json({ error: MISSING }, { status: 404 });
  return NextResponse.json({ note: publicNote(note) });
}

export async function PATCH(request: Request, { params }: Params) {
  const owner = await requireNotesOwner();
  if (!isNotesOwner(owner)) return owner.response;
  const { id } = await params;

  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return NextResponse.json({ error: "Send a note to save." }, { status: 400 });
  }
  const body = raw as Record<string, unknown>;

  const patch: NotePatch = {};
  if ("title" in body) {
    if (typeof body.title !== "string") {
      return NextResponse.json({ error: "Title has to be text." }, { status: 400 });
    }
    patch.title = body.title;
  }
  if ("body" in body) {
    if (typeof body.body !== "string") {
      return NextResponse.json({ error: "The note has to be text." }, { status: 400 });
    }
    patch.body = body.body;
  }
  if ("pinned" in body) {
    if (typeof body.pinned !== "boolean") {
      return NextResponse.json({ error: "Pinned has to be yes or no." }, { status: 400 });
    }
    patch.pinned = body.pinned;
  }
  if (patch.title === undefined && patch.body === undefined && patch.pinned === undefined) {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }

  const note = updatePersonalNote(owner.slug, id, patch);
  if (!note) return NextResponse.json({ error: MISSING }, { status: 404 });
  return NextResponse.json({ note: publicNote(note) });
}

export async function DELETE(_request: Request, { params }: Params) {
  const owner = await requireNotesOwner();
  if (!isNotesOwner(owner)) return owner.response;
  const { id } = await params;
  if (!deletePersonalNote(owner.slug, id)) {
    return NextResponse.json({ error: MISSING }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
