// One-off: trash two production-window nudge comments King Kashflow posted on
// Pipe It Right's "Time to schedule your next production" card. Michael's own
// Basecamp user gets 403 because he is not the author. The service connection
// is the author, so this runs once after boot with that connection.
//
// Each comment is loaded and checked before anything is trashed. A mismatch
// is skipped. The app_settings marker is claimed before the calls and kept
// even when a call fails, so a later boot does not try again. Trash is the
// recoverable Basecamp status (restorable for 25 days), via trashRecording.

import { getDb, nowIso } from "./db";
import {
  SERVICE,
  getCommentJson,
  getServiceIdentity,
  trashRecording,
} from "./basecamp";

export const TRASH_PIPE_IT_RIGHT_NUDGES_KEY = "one_off_trash_pipe_it_right_nudges_v1";
export const TRASH_PIPE_IT_RIGHT_NUDGES_LOG = "[one-off] trash-pipe-it-right-nudges";

const BUCKET_ID = "40889279";
const PARENT_CARD_ID = "10468738514";
const COMMENT_IDS = ["10525259116", "10534176064"] as const;
const SERVICE_NAME = "king kashflow";
const NUDGE_PHRASE = "friendly nudge";
const NUDGE_TOKEN = "U5sbj--ZQQyes2wYKSNGyAl2";

export interface NudgeComment {
  id: string;
  type: string;
  creatorId: number | null;
  creatorName: string;
  parentId: string;
  bucketId: string;
  content: string;
}

export interface NudgeServiceIdentity {
  id: number;
  name: string;
}

export interface NudgeCommentGateway {
  serviceIdentity(): NudgeServiceIdentity | null;
  getComment(
    bucketId: string,
    commentId: string
  ): Promise<{ ok: true; comment: NudgeComment } | { ok: false; error: string }>;
  trash(bucketId: string, commentId: string): Promise<{ ok: boolean; error?: string }>;
}

export interface NudgeMarker {
  /** True when this boot owns the one-off. False when a marker already exists. */
  claim(): boolean;
  finish(summary: string): void;
}

type Outcome = "trashed" | "skipped" | "failed";

function asDigits(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return value.trim();
  return "";
}

function asPersonId(value: unknown): number | null {
  const digits = asDigits(value);
  if (!digits) return null;
  const id = Number(digits);
  return Number.isSafeInteger(id) ? id : null;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function commentFromPayload(body: unknown): { ok: true; comment: NudgeComment } | { ok: false; error: string } {
  const row = record(body);
  if (!row) return { ok: false, error: "comment payload was not an object" };
  const creator = record(row.creator);
  const parent = record(row.parent);
  const bucket = record(row.bucket);
  return {
    ok: true,
    comment: {
      id: asDigits(row.id),
      type: typeof row.type === "string" ? row.type : "",
      creatorId: creator ? asPersonId(creator.id) : null,
      creatorName: creator && typeof creator.name === "string" ? creator.name : "",
      parentId: parent ? asDigits(parent.id) : "",
      bucketId: bucket ? asDigits(bucket.id) : "",
      content: typeof row.content === "string" ? row.content : "",
    },
  };
}

function normalizedName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** A reason to skip, or null when this comment is safe to trash. */
export function nudgeSkipReason(
  comment: NudgeComment,
  commentId: string,
  identity: NudgeServiceIdentity | null
): string | null {
  if (comment.id && comment.id !== commentId) {
    return `comment id is ${comment.id}, expected ${commentId}`;
  }
  if (comment.type !== "Comment") {
    return `recording type is ${comment.type || "missing"}, expected Comment`;
  }
  if (!identity || !Number.isSafeInteger(identity.id) || identity.id <= 0) {
    return "service person id is not recorded";
  }
  if (comment.creatorId !== identity.id) {
    const named = comment.creatorName.trim();
    const who = named ? `${comment.creatorId ?? "missing"} (${named})` : String(comment.creatorId ?? "missing");
    return `author ${who} is not the service account ${identity.id}`;
  }
  if (normalizedName(comment.creatorName) !== SERVICE_NAME) {
    return "author name is not King Kashflow";
  }
  if (comment.parentId !== PARENT_CARD_ID) {
    return `parent is ${comment.parentId || "missing"}, expected card ${PARENT_CARD_ID}`;
  }
  if (comment.bucketId !== BUCKET_ID) {
    return `bucket is ${comment.bucketId || "missing"}, expected ${BUCKET_ID}`;
  }
  const content = comment.content;
  if (!content.toLowerCase().includes(NUDGE_PHRASE) || !content.includes(NUDGE_TOKEN)) {
    return "content does not match this nudge";
  }
  return null;
}

export function safeLogText(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value ?? "");
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(access_token|refresh_token|client_secret|code)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function appSettingsNudgeMarker(key = TRASH_PIPE_IT_RIGHT_NUDGES_KEY): NudgeMarker {
  return {
    claim() {
      const inserted = getDb()
        .prepare(
          `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO NOTHING`
        )
        .run(key, "running", nowIso());
      return inserted.changes > 0;
    },
    finish(summary: string) {
      getDb()
        .prepare(`UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?`)
        .run(summary.slice(0, 500), nowIso(), key);
    },
  };
}

function productionGateway(): NudgeCommentGateway {
  return {
    serviceIdentity() {
      const identity = getServiceIdentity();
      const id = identity ? asPersonId(identity.id) : null;
      if (!identity || !id) return null;
      return { id, name: typeof identity.name === "string" ? identity.name : "" };
    },
    async getComment(bucketId, commentId) {
      const loaded = await getCommentJson(bucketId, commentId, SERVICE);
      if (!loaded.ok) return loaded;
      return commentFromPayload(loaded.body);
    },
    trash(bucketId, commentId) {
      return trashRecording(bucketId, commentId, SERVICE);
    },
  };
}

function defaultLog(line: string): void {
  console.log(line);
}

async function oneComment(
  gateway: NudgeCommentGateway,
  commentId: string,
  identity: NudgeServiceIdentity | null,
  log: (line: string) => void
): Promise<Outcome> {
  const loaded = await gateway.getComment(BUCKET_ID, commentId);
  if (!loaded.ok) {
    log(`${TRASH_PIPE_IT_RIGHT_NUDGES_LOG} ${commentId} skipped: ${safeLogText(loaded.error)}`);
    return "skipped";
  }
  const reason = nudgeSkipReason(loaded.comment, commentId, identity);
  if (reason) {
    log(`${TRASH_PIPE_IT_RIGHT_NUDGES_LOG} ${commentId} skipped: ${safeLogText(reason)}`);
    return "skipped";
  }
  const trashed = await gateway.trash(BUCKET_ID, commentId);
  if (!trashed.ok) {
    log(
      `${TRASH_PIPE_IT_RIGHT_NUDGES_LOG} ${commentId} failed: ${safeLogText(trashed.error || "trash failed")}`
    );
    return "failed";
  }
  log(`${TRASH_PIPE_IT_RIGHT_NUDGES_LOG} ${commentId} trashed`);
  return "trashed";
}

/**
 * Load, verify, and trash the two Pipe It Right nudge comments. Claims the
 * marker first so a second boot, including one that starts while this run
 * failed, does not call Basecamp again.
 */
export async function runTrashPipeItRightNudgesOnce(
  gateway: NudgeCommentGateway,
  marker: NudgeMarker,
  log: (line: string) => void = defaultLog
): Promise<void> {
  let claimed = false;
  try {
    claimed = marker.claim();
  } catch (err) {
    log(`${TRASH_PIPE_IT_RIGHT_NUDGES_LOG} failed: could not record the marker (${safeLogText(err)})`);
    return;
  }
  if (!claimed) return;

  const parts: string[] = [];
  try {
    const identity = gateway.serviceIdentity();
    for (const commentId of COMMENT_IDS) {
      try {
        const outcome = await oneComment(gateway, commentId, identity, log);
        parts.push(`${commentId}=${outcome}`);
      } catch (err) {
        parts.push(`${commentId}=failed`);
        log(`${TRASH_PIPE_IT_RIGHT_NUDGES_LOG} ${commentId} failed: ${safeLogText(err)}`);
      }
    }
  } catch (err) {
    log(`${TRASH_PIPE_IT_RIGHT_NUDGES_LOG} failed: ${safeLogText(err)}`);
  }

  const summary = parts.join(" ") || "failed";
  try {
    marker.finish(summary);
  } catch (err) {
    log(`${TRASH_PIPE_IT_RIGHT_NUDGES_LOG} failed: could not finish the marker (${safeLogText(err)})`);
  }
  log(`${TRASH_PIPE_IT_RIGHT_NUDGES_LOG} finished ${summary}`);
}

export async function runTrashPipeItRightNudgesOnStartup(): Promise<void> {
  await runTrashPipeItRightNudgesOnce(productionGateway(), appSettingsNudgeMarker());
}
