/**
 * Brand guide, mood board, and offers for one Lifecycle client.
 *
 * Stored on rev_clients.id. URLs only — nothing is uploaded, and nothing here
 * is served on a public route. Links follow the same http/https rule as
 * lifecycle links.
 */

import { nanoid } from "nanoid";
import { getDb, nowIso } from "./db";
import { getRevClient } from "./revenue";

const TITLE_MAX = 120;
const NOTE_MAX = 280;
const SUMMARY_MAX = 240;
const URL_MAX = 2000;

const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;

/** Hosts that serve an image even when the path has no file extension. */
const IMAGE_HOSTS = new Set([
  "picsum.photos",
  "fastly.picsum.photos",
  "images.unsplash.com",
  "plus.unsplash.com",
  "images.pexels.com",
  "i.imgur.com",
  "i.ibb.co",
  "placehold.co",
  "via.placeholder.com",
  "imagedelivery.net",
]);

export type BrandGuide = {
  url: string;
  updatedAt: string;
};

export type MoodReference = {
  id: string;
  clientId: string;
  title: string;
  url: string;
  note: string;
  sortOrder: number;
  image: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ClientOffer = {
  id: string;
  clientId: string;
  name: string;
  summary: string;
  isFocus: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

type Ok<T> = { ok: true; value: T };
type Err = { ok: false; error: string };
type Result<T> = Ok<T> | Err;

type MoodRow = {
  id: string;
  client_id: string;
  title: string;
  url: string;
  note: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type OfferRow = {
  id: string;
  client_id: string;
  name: string;
  summary: string;
  is_focus: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

function fail(error: string): Err {
  return { ok: false, error };
}

function requireClient(clientId: string): { ok: true } | Err {
  if (!getRevClient(clientId)) return fail("Unknown client.");
  return { ok: true };
}

/**
 * Accept only real web links. Same strictness as the lifecycle links route:
 * the string must parse, and the protocol must be http or https.
 */
export function parseHttpUrl(raw: unknown): { ok: true; url: string } | Err {
  const url = typeof raw === "string" ? raw.trim() : "";
  if (!url) return fail("A URL is required.");
  if (url.length > URL_MAX) return fail("That URL is too long.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail("That URL is not valid.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fail("Links must start with http or https.");
  }
  return { ok: true, url };
}

/** True when a mood tile should render the picture instead of a link card. */
export function isImageReferenceUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const file = decodeURIComponent(parsed.pathname.split("/").pop() || "");
  if (IMAGE_EXT.test(file)) return true;
  const host = parsed.hostname.toLowerCase();
  if (IMAGE_HOSTS.has(host)) return true;
  if (host.endsWith(".picsum.photos") || host.endsWith(".imgix.net")) return true;
  if (host === "res.cloudinary.com" && parsed.pathname.includes("/image/")) return true;
  return false;
}

function shortText(
  raw: unknown,
  emptyError: string,
  max: number,
  longError: string
): { ok: true; text: string } | Err {
  if (typeof raw !== "string") return fail(emptyError);
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return fail(emptyError);
  if (text.length > max) return fail(longError);
  return { ok: true, text };
}

function optionalNote(raw: unknown): { ok: true; note: string } | Err {
  if (raw == null) return { ok: true, note: "" };
  if (typeof raw !== "string") return fail("Keep the note short.");
  const note = raw.replace(/\s+/g, " ").trim();
  if (note.length > NOTE_MAX) return fail("Keep the note short.");
  return { ok: true, note };
}

function oneSentence(raw: unknown): { ok: true; summary: string } | Err {
  const parsed = shortText(raw, "Add one sentence.", SUMMARY_MAX, "Keep that to one sentence.");
  if (!parsed.ok) return parsed;
  return { ok: true, summary: parsed.text };
}

function nextSort(table: "client_mood_references" | "client_offers", clientId: string): number {
  const row = getDb()
    .prepare(`SELECT COALESCE(MAX(sort_order), 0) AS n FROM ${table} WHERE client_id = ?`)
    .get(clientId) as { n: number };
  return row.n + 1;
}

function toMood(row: MoodRow): MoodReference {
  return {
    id: row.id,
    clientId: row.client_id,
    title: row.title,
    url: row.url,
    note: row.note,
    sortOrder: row.sort_order,
    image: isImageReferenceUrl(row.url),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOffer(row: OfferRow): ClientOffer {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    summary: row.summary,
    isFocus: row.is_focus === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getBrandGuide(clientId: string): BrandGuide | null {
  const row = getDb()
    .prepare(`SELECT url, updated_at FROM client_brand_guides WHERE client_id = ?`)
    .get(clientId) as { url: string; updated_at: string } | undefined;
  if (!row) return null;
  return { url: row.url, updatedAt: row.updated_at };
}

export function setBrandGuide(clientId: string, rawUrl: unknown): Result<BrandGuide> {
  const client = requireClient(clientId);
  if (!client.ok) return client;
  const parsed = parseHttpUrl(rawUrl);
  if (!parsed.ok) return parsed;
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO client_brand_guides (client_id, url, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(client_id) DO UPDATE SET url = excluded.url, updated_at = excluded.updated_at`
    )
    .run(clientId, parsed.url, now, now);
  const brand = getBrandGuide(clientId);
  if (!brand) return fail("Could not save that link.");
  return { ok: true, value: brand };
}

export function clearBrandGuide(clientId: string): { ok: true } | Err {
  const client = requireClient(clientId);
  if (!client.ok) return client;
  getDb().prepare(`DELETE FROM client_brand_guides WHERE client_id = ?`).run(clientId);
  return { ok: true };
}

export function listMoodReferences(clientId: string): MoodReference[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM client_mood_references
        WHERE client_id = ?
        ORDER BY sort_order ASC, created_at ASC`
    )
    .all(clientId) as MoodRow[];
  return rows.map(toMood);
}

export function createMoodReference(
  clientId: string,
  input: { title: unknown; url: unknown; note?: unknown }
): Result<MoodReference> {
  const client = requireClient(clientId);
  if (!client.ok) return client;
  const title = shortText(input.title, "Add a title.", TITLE_MAX, "Keep the title short.");
  if (!title.ok) return title;
  const url = parseHttpUrl(input.url);
  if (!url.ok) return url;
  const note = optionalNote(input.note);
  if (!note.ok) return note;
  const now = nowIso();
  const id = nanoid(12);
  getDb()
    .prepare(
      `INSERT INTO client_mood_references
         (id, client_id, title, url, note, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, clientId, title.text, url.url, note.note, nextSort("client_mood_references", clientId), now, now);
  const created = listMoodReferences(clientId).find((row) => row.id === id);
  if (!created) return fail("Could not add that reference.");
  return { ok: true, value: created };
}

export function updateMoodReference(
  clientId: string,
  id: string,
  input: { title?: unknown; url?: unknown; note?: unknown }
): Result<MoodReference> {
  const client = requireClient(clientId);
  if (!client.ok) return client;
  const existing = getDb()
    .prepare(`SELECT * FROM client_mood_references WHERE id = ? AND client_id = ?`)
    .get(id, clientId) as MoodRow | undefined;
  if (!existing) return fail("That reference is not on this client.");

  let title = existing.title;
  let url = existing.url;
  let note = existing.note;
  if (input.title !== undefined) {
    const parsed = shortText(input.title, "Add a title.", TITLE_MAX, "Keep the title short.");
    if (!parsed.ok) return parsed;
    title = parsed.text;
  }
  if (input.url !== undefined) {
    const parsed = parseHttpUrl(input.url);
    if (!parsed.ok) return parsed;
    url = parsed.url;
  }
  if (input.note !== undefined) {
    const parsed = optionalNote(input.note);
    if (!parsed.ok) return parsed;
    note = parsed.note;
  }
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE client_mood_references
          SET title = ?, url = ?, note = ?, updated_at = ?
        WHERE id = ? AND client_id = ?`
    )
    .run(title, url, note, now, id, clientId);
  const updated = listMoodReferences(clientId).find((row) => row.id === id);
  if (!updated) return fail("That reference is not on this client.");
  return { ok: true, value: updated };
}

export function deleteMoodReference(clientId: string, id: string): { ok: true } | Err {
  const client = requireClient(clientId);
  if (!client.ok) return client;
  const result = getDb()
    .prepare(`DELETE FROM client_mood_references WHERE id = ? AND client_id = ?`)
    .run(id, clientId);
  if (result.changes === 0) return fail("That reference is not on this client.");
  return { ok: true };
}

export function listOffers(clientId: string): ClientOffer[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM client_offers
        WHERE client_id = ?
        ORDER BY sort_order ASC, created_at ASC`
    )
    .all(clientId) as OfferRow[];
  return rows.map(toOffer);
}

function clearOtherFocus(clientId: string, exceptId: string | null): void {
  if (exceptId) {
    getDb()
      .prepare(
        `UPDATE client_offers SET is_focus = 0
          WHERE client_id = ? AND id != ? AND is_focus = 1`
      )
      .run(clientId, exceptId);
    return;
  }
  getDb()
    .prepare(`UPDATE client_offers SET is_focus = 0 WHERE client_id = ? AND is_focus = 1`)
    .run(clientId);
}

export function createOffer(
  clientId: string,
  input: { name: unknown; summary: unknown; isFocus?: unknown }
): Result<ClientOffer> {
  const client = requireClient(clientId);
  if (!client.ok) return client;
  const name = shortText(input.name, "Add a name.", TITLE_MAX, "Keep the name short.");
  if (!name.ok) return name;
  const summary = oneSentence(input.summary);
  if (!summary.ok) return summary;
  const focus = input.isFocus === true;
  const now = nowIso();
  const id = nanoid(12);
  const db = getDb();
  const write = db.transaction(() => {
    if (focus) clearOtherFocus(clientId, null);
    db.prepare(
      `INSERT INTO client_offers
         (id, client_id, name, summary, is_focus, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      clientId,
      name.text,
      summary.summary,
      focus ? 1 : 0,
      nextSort("client_offers", clientId),
      now,
      now
    );
  });
  write();
  const created = listOffers(clientId).find((row) => row.id === id);
  if (!created) return fail("Could not add that offer.");
  return { ok: true, value: created };
}

export function updateOffer(
  clientId: string,
  id: string,
  input: { name?: unknown; summary?: unknown; isFocus?: unknown }
): Result<ClientOffer> {
  const client = requireClient(clientId);
  if (!client.ok) return client;
  const existing = getDb()
    .prepare(`SELECT * FROM client_offers WHERE id = ? AND client_id = ?`)
    .get(id, clientId) as OfferRow | undefined;
  if (!existing) return fail("That offer is not on this client.");

  let name = existing.name;
  let summary = existing.summary;
  let focus = existing.is_focus === 1;
  if (input.name !== undefined) {
    const parsed = shortText(input.name, "Add a name.", TITLE_MAX, "Keep the name short.");
    if (!parsed.ok) return parsed;
    name = parsed.text;
  }
  if (input.summary !== undefined) {
    const parsed = oneSentence(input.summary);
    if (!parsed.ok) return parsed;
    summary = parsed.summary;
  }
  if (input.isFocus !== undefined) {
    if (typeof input.isFocus !== "boolean") return fail("Focus has to be on or off.");
    focus = input.isFocus;
  }

  const now = nowIso();
  const db = getDb();
  const write = db.transaction(() => {
    if (focus) clearOtherFocus(clientId, id);
    db.prepare(
      `UPDATE client_offers
          SET name = ?, summary = ?, is_focus = ?, updated_at = ?
        WHERE id = ? AND client_id = ?`
    ).run(name, summary, focus ? 1 : 0, now, id, clientId);
  });
  write();
  const updated = listOffers(clientId).find((row) => row.id === id);
  if (!updated) return fail("That offer is not on this client.");
  return { ok: true, value: updated };
}

export function deleteOffer(clientId: string, id: string): { ok: true } | Err {
  const client = requireClient(clientId);
  if (!client.ok) return client;
  const result = getDb()
    .prepare(`DELETE FROM client_offers WHERE id = ? AND client_id = ?`)
    .run(id, clientId);
  if (result.changes === 0) return fail("That offer is not on this client.");
  return { ok: true };
}
