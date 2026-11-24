import { nanoid } from "nanoid";
import { getDb, nowIso, type WhiteboardBoard } from "./db";
import { teamLabel } from "./team";
import { getUser, listUsers } from "./users";

export type { WhiteboardBoard };

export type BoardRole = "owner" | "editor" | "viewer";
export type MemberRole = "editor" | "viewer";
export type BoardAction = "read" | "save" | "rename" | "delete" | "share" | "presence";
export type AccessDecision = "ok" | "not_found" | "forbidden";

export const TITLE_MAX = 120;
export const PRESENCE_MS = 20_000;
const ELEMENT_CAP = 5000;
const FILE_CAP = 40;
const FILE_URL_MAX = 3_000_000;
const SCENE_JSON_MAX = 12_000_000;

export interface SceneElement {
  id: string;
  version: number;
  updated?: number;
  isDeleted?: boolean;
  index?: string | number;
  [key: string]: unknown;
}

export interface SceneFile {
  id: string;
  mimeType: string;
  dataURL: string;
  created?: number;
}

export interface Scene {
  elements: SceneElement[];
  files: Record<string, SceneFile>;
}

export interface BoardSummary {
  id: string;
  title: string;
  role: BoardRole;
  ownerSlug: string;
  ownerLabel: string;
  updatedAt: string;
  unseen: boolean;
}

export interface BoardViewer {
  slug: string;
  label: string;
}

export type BoardFailure = { ok: false; error: "not_found" | "forbidden" | "invalid" | "too_large" };

const BOARD_COLUMNS = `id, title, folder_id, created_by, owner_slug, created_at, updated_at`;

function emptyScene(): Scene {
  return { elements: [], files: {} };
}

export function isSceneElement(value: unknown): value is SceneElement {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const element = value as SceneElement;
  if (typeof element.id !== "string" || element.id.length === 0 || element.id.length > 128) {
    return false;
  }
  if (typeof element.version !== "number" || !Number.isFinite(element.version) || element.version < 0) {
    return false;
  }
  return true;
}

function versionOf(element: SceneElement): number {
  return element.version;
}

function updatedOf(element: SceneElement): number {
  return typeof element.updated === "number" && Number.isFinite(element.updated) ? element.updated : 0;
}

function indexRank(element: SceneElement): string {
  if (typeof element.index === "string") return element.index;
  if (typeof element.index === "number" && Number.isFinite(element.index)) {
    return element.index.toString().padStart(12, "0");
  }
  return "";
}

function byIndex(a: SceneElement, b: SceneElement): number {
  const ai = indexRank(a);
  const bi = indexRank(b);
  if (ai && bi && ai !== bi) return ai < bi ? -1 : 1;
  if (ai && !bi) return -1;
  if (!ai && bi) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Keep the newer element. A lower version never replaces a higher one, so two
 * people editing different shapes cannot wipe each other, and a stale save of
 * a shape someone else already changed is dropped.
 * Equal versions break the tie on Excalidraw's `updated` timestamp. A tie
 * there keeps the copy already stored.
 */
export function preferElement(current: SceneElement | undefined, incoming: SceneElement): SceneElement {
  if (!current) return incoming;
  const currentVersion = versionOf(current);
  const incomingVersion = versionOf(incoming);
  if (incomingVersion > currentVersion) return incoming;
  if (incomingVersion < currentVersion) return current;
  return updatedOf(incoming) > updatedOf(current) ? incoming : current;
}

function isSceneFile(value: unknown): value is SceneFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const file = value as SceneFile;
  if (typeof file.id !== "string" || !file.id) return false;
  if (typeof file.mimeType !== "string" || !file.mimeType.startsWith("image/")) return false;
  if (typeof file.dataURL !== "string" || !file.dataURL.startsWith("data:image/")) return false;
  if (file.dataURL.length > FILE_URL_MAX) return false;
  return true;
}

export function mergeScene(
  base: Scene,
  incoming: { elements?: unknown; files?: unknown }
): { scene: Scene; changed: boolean; overflow: boolean } {
  const byId = new Map<string, SceneElement>();
  for (const element of base.elements) {
    if (isSceneElement(element)) byId.set(element.id, element);
  }

  let changed = false;
  const incomingElements = Array.isArray(incoming.elements) ? incoming.elements : [];
  for (const raw of incomingElements) {
    if (!isSceneElement(raw)) continue;
    const previous = byId.get(raw.id);
    const next = preferElement(previous, raw);
    if (next !== previous) {
      byId.set(raw.id, next);
      changed = true;
    }
  }

  const files: Record<string, SceneFile> = { ...base.files };
  const incomingFiles =
    incoming.files && typeof incoming.files === "object" && !Array.isArray(incoming.files)
      ? (incoming.files as Record<string, unknown>)
      : {};
  for (const raw of Object.values(incomingFiles)) {
    if (!isSceneFile(raw)) continue;
    const previous = files[raw.id];
    if (!previous || previous.dataURL !== raw.dataURL) {
      files[raw.id] = {
        id: raw.id,
        mimeType: raw.mimeType,
        dataURL: raw.dataURL,
        created: typeof raw.created === "number" ? raw.created : previous?.created,
      };
      changed = true;
    }
  }

  const elements = Array.from(byId.values()).sort(byIndex);
  if (elements.length > ELEMENT_CAP || Object.keys(files).length > FILE_CAP) {
    return { scene: { elements: base.elements, files: base.files }, changed: false, overflow: true };
  }

  return { scene: { elements, files }, changed, overflow: false };
}

function parseScene(raw: string | null | undefined): Scene {
  if (!raw) return emptyScene();
  try {
    const value = JSON.parse(raw) as { elements?: unknown; files?: unknown };
    const elements = (Array.isArray(value.elements) ? value.elements : [])
      .filter(isSceneElement)
      .sort(byIndex);
    const files: Record<string, SceneFile> = {};
    if (value.files && typeof value.files === "object" && !Array.isArray(value.files)) {
      for (const file of Object.values(value.files as Record<string, unknown>)) {
        if (isSceneFile(file)) {
          files[file.id] = {
            id: file.id,
            mimeType: file.mimeType,
            dataURL: file.dataURL,
            created: typeof file.created === "number" ? file.created : undefined,
          };
        }
      }
    }
    return { elements, files };
  } catch {
    return emptyScene();
  }
}

/** Strictly newer than `previous`, even when two saves land in the same millisecond. */
function nextStamp(previous: string | null | undefined): string {
  const now = nowIso();
  if (!previous || now > previous) return now;
  const stepped = new Date(Date.parse(previous) + 1);
  if (Number.isNaN(stepped.getTime())) return now;
  const iso = stepped.toISOString();
  return iso > previous ? iso : now;
}

function clipTitle(title: string | undefined): string {
  const trimmed = (title || "").trim().replace(/\s+/g, " ");
  if (!trimmed) return "Untitled board";
  return trimmed.slice(0, TITLE_MAX);
}

function getBoard(id: string): WhiteboardBoard | undefined {
  return getDb()
    .prepare(`SELECT ${BOARD_COLUMNS} FROM whiteboard_boards WHERE id = ?`)
    .get(id) as WhiteboardBoard | undefined;
}

function memberRole(boardId: string, slug: string): MemberRole | null {
  const row = getDb()
    .prepare(`SELECT role FROM whiteboard_members WHERE board_id = ? AND user_slug = ?`)
    .get(boardId, slug) as { role: string } | undefined;
  if (row?.role === "editor" || row?.role === "viewer") return row.role;
  return null;
}

export function accessFor(boardId: string, slug: string | null | undefined): BoardRole | null {
  if (!slug || !boardId) return null;
  const board = getBoard(boardId);
  if (!board) return null;
  if (board.owner_slug === slug) return "owner";
  return memberRole(boardId, slug);
}

/** Non-members look the same as a missing board. Viewers cannot write. */
export function authorize(role: BoardRole | null, action: BoardAction): AccessDecision {
  if (!role) return "not_found";
  if (action === "read" || action === "presence") return "ok";
  if (action === "save") return role === "viewer" ? "forbidden" : "ok";
  if (action === "rename" || action === "delete" || action === "share") {
    return role === "owner" ? "ok" : "forbidden";
  }
  return "forbidden";
}

function personLabel(slug: string): string {
  return getUser(slug)?.label || teamLabel(slug);
}

function summary(board: WhiteboardBoard, role: BoardRole, unseen: boolean): BoardSummary {
  return {
    id: board.id,
    title: board.title,
    role,
    ownerSlug: board.owner_slug,
    ownerLabel: personLabel(board.owner_slug),
    updatedAt: board.updated_at,
    unseen,
  };
}

export function listBoardsFor(slug: string): BoardSummary[] {
  if (!slug) return [];
  const db = getDb();
  const owned = db
    .prepare(
      `SELECT ${BOARD_COLUMNS} FROM whiteboard_boards
        WHERE owner_slug = ?
        ORDER BY updated_at DESC`
    )
    .all(slug) as WhiteboardBoard[];
  const shared = db
    .prepare(
      `SELECT b.id, b.title, b.folder_id, b.created_by, b.owner_slug, b.created_at, b.updated_at,
              m.role AS member_role, m.seen_at AS member_seen
         FROM whiteboard_boards b
         JOIN whiteboard_members m ON m.board_id = b.id
        WHERE m.user_slug = ? AND b.owner_slug != ?
        ORDER BY b.updated_at DESC`
    )
    .all(slug, slug) as Array<WhiteboardBoard & { member_role: string; member_seen: string | null }>;

  return [
    ...owned.map((board) => summary(board, "owner", false)),
    ...shared
      .filter((board) => board.member_role === "editor" || board.member_role === "viewer")
      .map((board) =>
        summary(board, board.member_role as MemberRole, !board.member_seen)
      ),
  ];
}

export function createBoard(input: { title?: string; ownerSlug: string }): WhiteboardBoard {
  const ownerSlug = (input.ownerSlug || "").trim();
  if (!ownerSlug || ownerSlug.includes(":")) {
    throw new Error("A board needs an owner");
  }
  const db = getDb();
  const id = nanoid(12);
  const ts = nowIso();
  db.prepare(
    `INSERT INTO whiteboard_boards
      (id, title, created_by, owner_slug, scene_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, clipTitle(input.title), personLabel(ownerSlug), ownerSlug, JSON.stringify(emptyScene()), ts, ts);
  return getBoard(id)!;
}

function loadScene(boardId: string): { scene: Scene; updatedAt: string } | null {
  const row = getDb()
    .prepare(`SELECT scene_json, updated_at FROM whiteboard_boards WHERE id = ?`)
    .get(boardId) as { scene_json: string; updated_at: string } | undefined;
  if (!row) return null;
  return { scene: parseScene(row.scene_json), updatedAt: row.updated_at };
}

function markSeen(boardId: string, slug: string): void {
  getDb()
    .prepare(
      `UPDATE whiteboard_members
          SET seen_at = COALESCE(seen_at, ?), updated_at = ?
        WHERE board_id = ? AND user_slug = ? AND seen_at IS NULL`
    )
    .run(nowIso(), nowIso(), boardId, slug);
}

export function touchPresence(boardId: string, slug: string): BoardViewer[] {
  const db = getDb();
  const now = nowIso();
  const cutoff = new Date(Date.now() - PRESENCE_MS).toISOString();
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO whiteboard_presence (board_id, user_slug, seen_at)
       VALUES (?, ?, ?)
       ON CONFLICT(board_id, user_slug) DO UPDATE SET seen_at = excluded.seen_at`
    ).run(boardId, slug, now);
    db.prepare(`DELETE FROM whiteboard_presence WHERE board_id = ? AND seen_at < ?`).run(
      boardId,
      cutoff
    );
  });
  run();

  const rows = db
    .prepare(
      `SELECT p.user_slug AS slug
         FROM whiteboard_presence p
         JOIN whiteboard_boards b ON b.id = p.board_id
        WHERE p.board_id = ?
          AND p.seen_at >= ?
          AND (
            p.user_slug = b.owner_slug
            OR EXISTS (
              SELECT 1 FROM whiteboard_members m
               WHERE m.board_id = p.board_id AND m.user_slug = p.user_slug
            )
          )
        ORDER BY p.user_slug`
    )
    .all(boardId, cutoff) as Array<{ slug: string }>;

  return rows.map((row) => ({ slug: row.slug, label: personLabel(row.slug) }));
}

export function readBoard(
  boardId: string,
  slug: string
): { board: BoardSummary; scene: Scene; viewers: BoardViewer[] } | null {
  if (authorize(accessFor(boardId, slug), "read") !== "ok") return null;
  const board = getBoard(boardId);
  const loaded = loadScene(boardId);
  if (!board || !loaded) return null;
  const role = accessFor(boardId, slug)!;
  if (role !== "owner") markSeen(boardId, slug);
  const unseen = false;
  return {
    board: summary(board, role, unseen),
    scene: loaded.scene,
    viewers: touchPresence(boardId, slug),
  };
}

export function renameBoard(
  boardId: string,
  slug: string,
  title: string
): { ok: true; board: BoardSummary } | BoardFailure {
  const decision = authorize(accessFor(boardId, slug), "rename");
  if (decision !== "ok") return { ok: false, error: decision };
  const ts = nowIso();
  getDb()
    .prepare(`UPDATE whiteboard_boards SET title = ?, updated_at = ? WHERE id = ?`)
    .run(clipTitle(title), ts, boardId);
  const board = getBoard(boardId)!;
  return { ok: true, board: summary(board, "owner", false) };
}

export function deleteBoard(boardId: string, slug: string): { ok: true } | BoardFailure {
  const decision = authorize(accessFor(boardId, slug), "delete");
  if (decision !== "ok") return { ok: false, error: decision };
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare(`DELETE FROM whiteboard_presence WHERE board_id = ?`).run(boardId);
    db.prepare(`DELETE FROM whiteboard_members WHERE board_id = ?`).run(boardId);
    db.prepare(`DELETE FROM whiteboard_records WHERE board_id = ?`).run(boardId);
    db.prepare(`DELETE FROM whiteboard_boards WHERE id = ?`).run(boardId);
  });
  run();
  return { ok: true };
}

export function saveScene(
  boardId: string,
  slug: string,
  incoming: { elements?: unknown; files?: unknown }
): { ok: true; scene: Scene; updatedAt: string; changed: boolean } | BoardFailure {
  const decision = authorize(accessFor(boardId, slug), "save");
  if (decision !== "ok") return { ok: false, error: decision };
  const loaded = loadScene(boardId);
  if (!loaded) return { ok: false, error: "not_found" };

  const merged = mergeScene(loaded.scene, incoming);
  if (merged.overflow || JSON.stringify(merged.scene).length > SCENE_JSON_MAX) {
    return { ok: false, error: "too_large" };
  }
  if (!merged.changed) {
    return { ok: true, scene: loaded.scene, updatedAt: loaded.updatedAt, changed: false };
  }

  const ts = nextStamp(loaded.updatedAt);
  const payload = JSON.stringify(merged.scene);
  if (payload.length > SCENE_JSON_MAX) return { ok: false, error: "too_large" };
  getDb()
    .prepare(`UPDATE whiteboard_boards SET scene_json = ?, updated_at = ? WHERE id = ?`)
    .run(payload, ts, boardId);
  return { ok: true, scene: merged.scene, updatedAt: ts, changed: true };
}

export function changesSince(
  boardId: string,
  slug: string,
  since: string | null
): { scene: Scene; updatedAt: string; full: boolean; viewers: BoardViewer[] } | null {
  if (authorize(accessFor(boardId, slug), "read") !== "ok") return null;
  const loaded = loadScene(boardId);
  if (!loaded) return null;
  const viewers = touchPresence(boardId, slug);
  const sinceValue = since && since.trim() ? since.trim() : "";
  const full = !sinceValue || loaded.updatedAt > sinceValue;
  return {
    scene: full ? loaded.scene : emptyScene(),
    updatedAt: loaded.updatedAt,
    full,
    viewers,
  };
}

export function listMembers(
  boardId: string,
  slug: string
): { ok: true; members: Array<{ slug: string; label: string; role: BoardRole }> } | BoardFailure {
  const decision = authorize(accessFor(boardId, slug), "read");
  if (decision !== "ok") return { ok: false, error: decision };
  const board = getBoard(boardId);
  if (!board) return { ok: false, error: "not_found" };
  const rows = getDb()
    .prepare(
      `SELECT user_slug, role FROM whiteboard_members
        WHERE board_id = ?
        ORDER BY user_slug`
    )
    .all(boardId) as Array<{ user_slug: string; role: string }>;
  const members: Array<{ slug: string; label: string; role: BoardRole }> = [
    { slug: board.owner_slug, label: personLabel(board.owner_slug), role: "owner" },
  ];
  for (const row of rows) {
    if (row.role !== "editor" && row.role !== "viewer") continue;
    if (row.user_slug === board.owner_slug) continue;
    members.push({ slug: row.user_slug, label: personLabel(row.user_slug), role: row.role });
  }
  return { ok: true, members };
}

function inviteTarget(
  boardId: string,
  actor: string,
  userSlug: string
): { ok: true; board: WhiteboardBoard } | BoardFailure {
  const decision = authorize(accessFor(boardId, actor), "share");
  if (decision !== "ok") return { ok: false, error: decision };
  const board = getBoard(boardId);
  if (!board) return { ok: false, error: "not_found" };
  const slug = userSlug.trim();
  if (!slug || slug === board.owner_slug) return { ok: false, error: "invalid" };
  const user = getUser(slug);
  if (!user || !user.active) return { ok: false, error: "invalid" };
  return { ok: true, board };
}

export function inviteMember(
  boardId: string,
  actor: string,
  userSlug: string,
  role: string
): { ok: true; role: MemberRole } | BoardFailure {
  if (role !== "editor" && role !== "viewer") return { ok: false, error: "invalid" };
  const target = inviteTarget(boardId, actor, userSlug);
  if (!target.ok) return target;
  const ts = nowIso();
  const slug = userSlug.trim();
  getDb()
    .prepare(
      `INSERT INTO whiteboard_members (board_id, user_slug, role, seen_at, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)
       ON CONFLICT(board_id, user_slug) DO UPDATE SET
         role = excluded.role,
         updated_at = excluded.updated_at`
    )
    .run(boardId, slug, role, ts, ts);
  return { ok: true, role };
}

export function setMemberRole(
  boardId: string,
  actor: string,
  userSlug: string,
  role: string
): { ok: true; role: MemberRole } | BoardFailure {
  if (role !== "editor" && role !== "viewer") return { ok: false, error: "invalid" };
  const target = inviteTarget(boardId, actor, userSlug);
  if (!target.ok) return target;
  const existing = memberRole(boardId, userSlug.trim());
  if (!existing) return { ok: false, error: "invalid" };
  getDb()
    .prepare(
      `UPDATE whiteboard_members SET role = ?, updated_at = ? WHERE board_id = ? AND user_slug = ?`
    )
    .run(role, nowIso(), boardId, userSlug.trim());
  return { ok: true, role };
}

export function removeMember(
  boardId: string,
  actor: string,
  userSlug: string
): { ok: true } | BoardFailure {
  const target = inviteTarget(boardId, actor, userSlug);
  if (!target.ok) return target;
  const slug = userSlug.trim();
  if (!memberRole(boardId, slug)) return { ok: false, error: "invalid" };
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare(`DELETE FROM whiteboard_members WHERE board_id = ? AND user_slug = ?`).run(boardId, slug);
    db.prepare(`DELETE FROM whiteboard_presence WHERE board_id = ? AND user_slug = ?`).run(boardId, slug);
  });
  run();
  return { ok: true };
}

export function listInviteCandidates(actor: string): Array<{ slug: string; label: string }> {
  if (!actor) return [];
  return listUsers()
    .filter((user) => user.active && user.slug !== actor)
    .map((user) => ({ slug: user.slug, label: user.label || teamLabel(user.slug) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
