// Private notes for one signed-in person. Every query takes the owner and
// filters on it, so a guessed id from somebody else's notebook returns nothing.
// The owner is always the session slug (see sessionUserSlug). Impersonated
// sessions never get one, which is what keeps "view as" from opening notes.

import { nanoid } from "nanoid";
import { getDb, nowIso } from "./db";

export const NOTE_TITLE_MAX = 200;
export const NOTE_BODY_MAX = 100_000;

export interface PersonalNote {
  id: string;
  owner: string;
  title: string;
  body: string;
  pinned: number;
  created_at: string;
  updated_at: string;
}

export type NotePatch = {
  title?: string;
  body?: string;
  pinned?: boolean;
};

function assertOwner(owner: string): void {
  // The ":impersonated" marker from sessionActor must never become an owner.
  // A blank owner would pool every anonymous write into one shared notebook.
  if (!owner.trim() || owner.includes(":")) {
    throw new Error("Notes need a real account.");
  }
}

function clipTitle(title: string): string {
  return title.trim().slice(0, NOTE_TITLE_MAX);
}

function clipBody(body: string): string {
  return body.slice(0, NOTE_BODY_MAX);
}

export function listPersonalNotes(owner: string): PersonalNote[] {
  assertOwner(owner);
  return getDb()
    .prepare(
      `SELECT * FROM personal_notes
        WHERE owner = ?
        ORDER BY pinned DESC, updated_at DESC, id DESC`
    )
    .all(owner) as PersonalNote[];
}

export function getPersonalNote(owner: string, id: string): PersonalNote | null {
  assertOwner(owner);
  const row = getDb()
    .prepare(`SELECT * FROM personal_notes WHERE owner = ? AND id = ?`)
    .get(owner, id) as PersonalNote | undefined;
  return row ?? null;
}

export function createPersonalNote(
  owner: string,
  input: { title?: string; body?: string } = {}
): PersonalNote {
  assertOwner(owner);
  const id = nanoid(12);
  const now = nowIso();
  const title = clipTitle(input.title ?? "");
  const body = clipBody(input.body ?? "");
  getDb()
    .prepare(
      `INSERT INTO personal_notes (id, owner, title, body, pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`
    )
    .run(id, owner, title, body, now, now);
  return getPersonalNote(owner, id)!;
}

export function updatePersonalNote(
  owner: string,
  id: string,
  patch: NotePatch
): PersonalNote | null {
  const current = getPersonalNote(owner, id);
  if (!current) return null;
  const title = patch.title === undefined ? current.title : clipTitle(patch.title);
  const body = patch.body === undefined ? current.body : clipBody(patch.body);
  const pinned = patch.pinned === undefined ? current.pinned : patch.pinned ? 1 : 0;
  getDb()
    .prepare(
      `UPDATE personal_notes
          SET title = ?, body = ?, pinned = ?, updated_at = ?
        WHERE owner = ? AND id = ?`
    )
    .run(title, body, pinned, nowIso(), owner, id);
  return getPersonalNote(owner, id);
}

/** The fields the notebook page is allowed to see. Owner stays on the row. */
export function publicNote(note: PersonalNote) {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    pinned: note.pinned,
    created_at: note.created_at,
    updated_at: note.updated_at,
  };
}

export function deletePersonalNote(owner: string, id: string): boolean {
  assertOwner(owner);
  return (
    getDb().prepare(`DELETE FROM personal_notes WHERE owner = ? AND id = ?`).run(owner, id)
      .changes > 0
  );
}
