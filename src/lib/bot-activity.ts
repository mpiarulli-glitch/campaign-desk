// Bot Activity storage and the two HTTP handlers.
//
// Bots call botActivityApiGet / botActivityApiPost with the existing
// CAMPAIGN_DESK_API_TOKEN (or BOT_ACTIVITY_TOKEN when that is set). Michael's
// page calls the admin handlers, which take the session and do not look at
// the bot token. Nothing here writes the token to a log.

import { timingSafeEqual } from "crypto";
import { nanoid } from "nanoid";
import { getDb } from "./db";
import { clientKey } from "./rate-limit";
import { asBotIcon, botChatHref, DEFAULT_BOT_ICON, type BotIcon } from "./bot-activity-icons";
import { groupByPacificDay } from "./bot-activity-office";
import {
  formatClockPt,
  formatDayPt,
  formatUpdatedPt,
  formatWaitingWhenPt,
} from "./bot-activity-time";

export const BOT_ACTIVITY_MAX_BODY = 64 * 1024;
export const BOT_ACTIVITY_MAX_EVENTS = 20;
export const BOT_ACTIVITY_RATE_LIMIT = 30;
export const BOT_ACTIVITY_RATE_WINDOW_MS = 60_000;
const WAITING_LIST_LIMIT = 500;

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const WAITING_FIELDS = ["type", "bot", "key", "title", "detail", "resolved", "at"];
const WORK_FIELDS = ["type", "bot", "key", "title", "detail", "state", "at"];
const TIMELINE_FIELDS = ["type", "bot", "text", "at"];
const BATCH_FIELDS = ["events"];

export type BotActivityActor = {
  role: string;
  person: string | null;
  impersonating?: boolean;
} | null;

export type ApiResult = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

type WaitingOp = {
  type: "waiting";
  bot: string;
  key: string;
  title: string | null;
  detail: string | null;
  resolved: boolean | null;
  at: string | null;
};

type WorkOp = {
  type: "work";
  bot: string;
  key: string;
  title: string | null;
  detail: string | null;
  state: "progress" | "blocked" | "done";
  at: string | null;
};

type TimelineOp = {
  type: "timeline";
  bot: string;
  text: string;
  at: string | null;
};

type Op = WaitingOp | WorkOp | TimelineOp;

type ItemRow = {
  id: string;
  kind: string;
  bot: string;
  item_key: string;
  title: string;
  detail: string;
  state: string;
  status: string;
  occurred_at: string;
  when_label: string;
  sort_index: number;
  updated_at: string;
};

type BotRow = { name: string; icon: string; agent_id: string };
type TimelineRow = {
  id: string;
  bot: string;
  body: string;
  occurred_at: string;
  day_label: string;
  when_label: string;
  created_at: string;
};
type ReplyRow = { id: string; item_id: string; body: string; created_at: string };

/**
 * Michael's owner session: admin, no person on the cookie, not view-as.
 * Logging in as the owner account is what produces that cookie. Named admins
 * (Carlos, the account managers) and forecast users carry a person slug.
 */
export function actorMaySeeBotActivity(actor: BotActivityActor): boolean {
  return Boolean(
    actor && actor.role === "admin" && actor.person === null && !actor.impersonating
  );
}

function tokenEquals(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  const dummy = Buffer.alloc(32, 1);
  timingSafeEqual(dummy, dummy);
  if (!expected || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearerToken(header: string | null): string {
  if (!header) return "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : "";
}

/** True for CAMPAIGN_DESK_API_TOKEN, or for BOT_ACTIVITY_TOKEN when that is set. */
export function botActivityTokenAuthorized(authorization: string | null): boolean {
  const presented = bearerToken(authorization);
  const primaryOk = tokenEquals(presented, process.env.CAMPAIGN_DESK_API_TOKEN || "");
  const dedicatedOk = tokenEquals(presented, process.env.BOT_ACTIVITY_TOKEN || "");
  return primaryOk || dedicatedOk;
}

const rateHits = new Map<string, number[]>();

export function resetBotActivityRateLimitForTests(): void {
  rateHits.clear();
}

function rateAllowed(key: string, now = Date.now()): { ok: boolean; retryAfter: number } {
  const windowStart = now - BOT_ACTIVITY_RATE_WINDOW_MS;
  const recent = (rateHits.get(key) || []).filter((t) => t > windowStart);
  if (recent.length >= BOT_ACTIVITY_RATE_LIMIT) {
    rateHits.set(key, recent);
    const retryAfter = Math.max(
      1,
      Math.ceil((recent[0] + BOT_ACTIVITY_RATE_WINDOW_MS - now) / 1000)
    );
    return { ok: false, retryAfter };
  }
  recent.push(now);
  if (rateHits.size > 5000) {
    const oldest = rateHits.keys().next().value;
    if (oldest) rateHits.delete(oldest);
  }
  rateHits.set(key, recent);
  return { ok: true, retryAfter: 0 };
}

function clientIp(request: Request): string {
  return clientKey(request).slice(0, 80) || "unknown";
}

function unauthorized(): ApiResult {
  return { status: 401, body: { error: "Unauthorized" }, headers: { "Cache-Control": "no-store" } };
}

function tooMany(retryAfter: number): ApiResult {
  return {
    status: 429,
    body: { error: "Too many requests" },
    headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" },
  };
}

function gateBot(request: Request): ApiResult | null {
  const rate = rateAllowed(clientIp(request));
  if (!rate.ok) return tooMany(rate.retryAfter);
  if (!botActivityTokenAuthorized(request.headers.get("authorization"))) return unauthorized();
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unknownField(value: Record<string, unknown>, allowed: string[]): string | null {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return key;
  }
  return null;
}

function cleanBot(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\u0000/g, "").trim();
  if (!name || name.length > 80) return null;
  if (/[\r\n\t]/.test(name)) return null;
  return name;
}

/** null = invalid, undefined = omitted, string = usable (may be empty when not required). */
function cleanText(
  value: unknown,
  max: number,
  required: boolean
): string | null | undefined {
  if (value === undefined) return required ? null : undefined;
  if (typeof value !== "string") return null;
  const text = value.replace(/\u0000/g, "").trim();
  if (text.length > max) return null;
  if (required && !text) return null;
  return text;
}

function parseAt(value: unknown): { ok: true; iso: string | null } | { ok: false } {
  if (value === undefined || value === null || value === "") return { ok: true, iso: null };
  if (typeof value !== "string") return { ok: false };
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return { ok: false };
  const year = new Date(ms).getUTCFullYear();
  if (year < 2000 || year > 2100) return { ok: false };
  return { ok: true, iso: new Date(ms).toISOString() };
}

function fail(error: string): { error: string } {
  return { error };
}

function parseOp(value: unknown, index: number): Op | { error: string } {
  if (!isRecord(value)) return fail(`Event ${index} is not an object`);
  const type = value.type;
  const where = index === 0 && value.type ? String(type) : `Event ${index}`;
  if (type !== "waiting" && type !== "work" && type !== "timeline") {
    return fail(`${where}: type must be waiting, work, or timeline`);
  }
  const allowed = type === "waiting" ? WAITING_FIELDS : type === "work" ? WORK_FIELDS : TIMELINE_FIELDS;
  const extra = unknownField(value, allowed);
  if (extra) return fail(`${where}: unknown field ${extra}`);

  const bot = cleanBot(value.bot);
  if (!bot) return fail(`${where}: bot is required`);
  const at = parseAt(value.at);
  if (!at.ok) return fail(`${where}: at must be an ISO timestamp`);

  if (type === "timeline") {
    const text = cleanText(value.text, 4000, true);
    if (text === null || text === undefined) return fail(`${where}: text is required`);
    return { type, bot, text, at: at.iso };
  }

  if (typeof value.key !== "string" || !KEY_RE.test(value.key)) {
    return fail(`${where}: key must be 1-120 letters, numbers, dots, underscores, or hyphens`);
  }
  const title = cleanText(value.title, 300, false);
  if (title === null) return fail(`${where}: title is too long`);
  if (title === "") return fail(`${where}: title cannot be empty`);
  const detail = cleanText(value.detail, 4000, false);
  if (detail === null) return fail(`${where}: detail is too long`);

  if (type === "waiting") {
    if (value.resolved !== undefined && typeof value.resolved !== "boolean") {
      return fail(`${where}: resolved must be true or false`);
    }
    return {
      type,
      bot,
      key: value.key,
      title: title ?? null,
      detail: detail ?? null,
      resolved: value.resolved === undefined ? null : value.resolved,
      at: at.iso,
    };
  }

  if (value.state !== "progress" && value.state !== "blocked" && value.state !== "done") {
    return fail(`${where}: state must be progress, blocked, or done`);
  }
  return {
    type,
    bot,
    key: value.key,
    title: title ?? null,
    detail: detail ?? null,
    state: value.state,
    at: at.iso,
  };
}

function parseBody(payload: unknown): Op[] | { error: string } {
  if (!isRecord(payload)) return fail("Body must be a JSON object");
  if ("events" in payload) {
    const extra = unknownField(payload, BATCH_FIELDS);
    if (extra) return fail(`Unknown field ${extra}`);
    if (!Array.isArray(payload.events) || payload.events.length === 0) {
      return fail("events must be a non-empty array");
    }
    if (payload.events.length > BOT_ACTIVITY_MAX_EVENTS) {
      return fail(`At most ${BOT_ACTIVITY_MAX_EVENTS} events`);
    }
    const ops: Op[] = [];
    for (let i = 0; i < payload.events.length; i++) {
      const parsed = parseOp(payload.events[i], i);
      if ("error" in parsed) return parsed;
      ops.push(parsed);
    }
    return ops;
  }
  const parsed = parseOp(payload, 0);
  if ("error" in parsed) return parsed;
  return [parsed];
}

function ensureBot(name: string, at: string): string {
  const db = getDb();
  const existing = db
    .prepare(`SELECT name FROM bot_activity_bots WHERE name = ? COLLATE NOCASE`)
    .get(name) as { name: string } | undefined;
  if (existing) return existing.name;
  try {
    db.prepare(
      `INSERT INTO bot_activity_bots (name, icon, agent_id, created_at) VALUES (?, ?, '', ?)`
    ).run(name, DEFAULT_BOT_ICON, at);
  } catch {
    const again = db
      .prepare(`SELECT name FROM bot_activity_bots WHERE name = ? COLLATE NOCASE`)
      .get(name) as { name: string } | undefined;
    if (again) return again.name;
    throw new Error("Could not register bot");
  }
  return name;
}

function nextSort(kind: string): number {
  const row = getDb()
    .prepare(`SELECT MIN(sort_index) AS n FROM bot_activity_items WHERE kind = ?`)
    .get(kind) as { n: number | null };
  return (row.n ?? 0) - 1;
}

function applyOp(op: Op, now: string): Record<string, unknown> {
  const db = getDb();
  const bot = ensureBot(op.bot, now);

  if (op.type === "timeline") {
    const occurred = op.at || now;
    const id = nanoid(16);
    db.prepare(
      `INSERT INTO bot_activity_timeline (
         id, bot, body, occurred_at, day_label, when_label, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, bot, op.text, occurred, formatDayPt(occurred), formatClockPt(occurred), now);
    return { type: "timeline", id, bot };
  }

  const existing = db
    .prepare(`SELECT * FROM bot_activity_items WHERE kind = ? AND bot = ? AND item_key = ?`)
    .get(op.type, bot, op.key) as ItemRow | undefined;

  if (!existing && !op.title) {
    throw new Error(`${op.type} ${op.key}: title is required`);
  }

  const occurred = op.at || existing?.occurred_at || now;
  const whenLabel = op.at
    ? formatWaitingWhenPt(op.at)
    : existing?.when_label || formatWaitingWhenPt(occurred);

  if (op.type === "waiting") {
    const status = op.resolved === null ? existing?.status || "open" : op.resolved ? "resolved" : "open";
    if (!existing) {
      const id = nanoid(16);
      db.prepare(
        `INSERT INTO bot_activity_items (
           id, kind, bot, item_key, title, detail, state, status,
           occurred_at, when_label, sort_index, created_at, updated_at
         ) VALUES (?, 'waiting', ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        bot,
        op.key,
        op.title,
        op.detail ?? "",
        status,
        occurred,
        whenLabel,
        nextSort("waiting"),
        now,
        now
      );
      return { type: "waiting", id, bot, key: op.key, status };
    }
    db.prepare(
      `UPDATE bot_activity_items
          SET title = ?, detail = ?, status = ?, occurred_at = ?, when_label = ?, updated_at = ?
        WHERE id = ?`
    ).run(
      op.title ?? existing.title,
      op.detail ?? existing.detail,
      status,
      occurred,
      whenLabel,
      now,
      existing.id
    );
    return { type: "waiting", id: existing.id, bot, key: op.key, status };
  }

  if (!existing) {
    const id = nanoid(16);
    db.prepare(
      `INSERT INTO bot_activity_items (
         id, kind, bot, item_key, title, detail, state, status,
         occurred_at, when_label, sort_index, created_at, updated_at
       ) VALUES (?, 'work', ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`
    ).run(
      id,
      bot,
      op.key,
      op.title,
      op.detail ?? "",
      op.state,
      occurred,
      whenLabel,
      nextSort("work"),
      now,
      now
    );
    return { type: "work", id, bot, key: op.key, state: op.state };
  }
  db.prepare(
    `UPDATE bot_activity_items
        SET title = ?, detail = ?, state = ?, occurred_at = ?, when_label = ?, updated_at = ?
      WHERE id = ?`
  ).run(
    op.title ?? existing.title,
    op.detail ?? existing.detail,
    op.state,
    occurred,
    whenLabel,
    now,
    existing.id
  );
  return { type: "work", id: existing.id, bot, key: op.key, state: op.state };
}

async function readBody(
  request: Request
): Promise<{ ok: true; value: unknown } | { ok: false; result: ApiResult }> {
  const declared = Number(request.headers.get("content-length") || "");
  if (Number.isFinite(declared) && declared > BOT_ACTIVITY_MAX_BODY) {
    return { ok: false, result: { status: 413, body: { error: "Request too large" } } };
  }
  const type = request.headers.get("content-type");
  if (type && type.split(";")[0].trim().toLowerCase() !== "application/json") {
    return {
      ok: false,
      result: { status: 415, body: { error: "Content-Type must be application/json" } },
    };
  }
  let text = "";
  try {
    text = await request.text();
  } catch {
    return { ok: false, result: { status: 400, body: { error: "Invalid JSON" } } };
  }
  if (text.length > BOT_ACTIVITY_MAX_BODY) {
    return { ok: false, result: { status: 413, body: { error: "Request too large" } } };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, result: { status: 400, body: { error: "Invalid JSON" } } };
  }
}

export async function botActivityApiPost(request: Request): Promise<ApiResult> {
  const denied = gateBot(request);
  if (denied) return denied;
  const payload = await readBody(request);
  if (!payload.ok) return payload.result;
  const ops = parseBody(payload.value);
  if ("error" in ops) return { status: 400, body: ops };

  const now = new Date().toISOString();
  try {
    const results = getDb().transaction(() => ops.map((op) => applyOp(op, now)))();
    return { status: 200, body: { ok: true, results } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not save";
    if (message.includes("title is required")) return { status: 400, body: { error: message } };
    return { status: 500, body: { error: "Could not save" } };
  }
}

function parseSince(raw: string | null): { ok: true; iso: string | null } | { ok: false } {
  if (!raw) return { ok: true, iso: null };
  return parseAt(raw);
}

export async function botActivityApiGet(request: Request): Promise<ApiResult> {
  const denied = gateBot(request);
  if (denied) return denied;
  const url = new URL(request.url);
  // bot and since are the only filters. A token in the query string is ignored
  // so it cannot authenticate a request (and is not written anywhere).
  const bot = (url.searchParams.get("bot") || "").trim();
  if (bot.length > 80 || /[\r\n\t]/.test(bot)) {
    return { status: 400, body: { error: "bot filter is too long" } };
  }
  const since = parseSince(url.searchParams.get("since"));
  if (!since.ok) return { status: 400, body: { error: "since must be an ISO timestamp" } };

  const rows = getDb()
    .prepare(
      `SELECT * FROM bot_activity_items
        WHERE kind = 'waiting'
          AND (? = '' OR bot = ? COLLATE NOCASE)
          AND (? = '' OR updated_at >= ?)
        ORDER BY updated_at DESC, id DESC
        LIMIT ?`
    )
    .all(
      bot,
      bot,
      since.iso || "",
      since.iso || "",
      WAITING_LIST_LIMIT + 1
    ) as ItemRow[];

  const truncated = rows.length > WAITING_LIST_LIMIT;
  const page = truncated ? rows.slice(0, WAITING_LIST_LIMIT) : rows;
  const replies = repliesFor(page.map((row) => row.id));

  return {
    status: 200,
    headers: { "Cache-Control": "no-store" },
    body: {
      waiting: page.map((row) => ({
        bot: row.bot,
        key: row.item_key,
        title: row.title,
        detail: row.detail,
        status: row.status === "resolved" ? "resolved" : "open",
        at: row.occurred_at,
        updatedAt: row.updated_at,
        replies: (replies.get(row.id) || []).map((reply) => ({
          body: reply.body,
          at: reply.created_at,
        })),
      })),
      truncated,
    },
  };
}

function repliesFor(ids: string[]): Map<string, ReplyRow[]> {
  const map = new Map<string, ReplyRow[]>();
  if (!ids.length) return map;
  const marks = ids.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `SELECT id, item_id, body, created_at FROM bot_activity_replies
        WHERE item_id IN (${marks})
        ORDER BY created_at ASC, id ASC`
    )
    .all(...ids) as ReplyRow[];
  for (const row of rows) {
    const list = map.get(row.item_id) || [];
    list.push(row);
    map.set(row.item_id, list);
  }
  return map;
}

function denyActor(actor: BotActivityActor): ApiResult | null {
  if (!actor) return { status: 401, body: { error: "Unauthorized" } };
  if (!actorMaySeeBotActivity(actor)) return { status: 403, body: { error: "Forbidden" } };
  return null;
}

function iconFor(bots: Map<string, BotRow>, name: string): BotIcon {
  return asBotIcon(bots.get(name)?.icon);
}

function whenOf(label: string, iso: string): string {
  return label || formatWaitingWhenPt(iso);
}

// Owner board read. One light set of indexed selects: bots, open waiting,
// those replies in a single IN query, work, timeline, and the latest
// occurred_at. Nothing here calls the bot route's 30/min rate limit.
// `at` is the row's existing occurred_at so the page can say "time ago"
// without another query or a new column.
export function botActivityBoard(): {
  updated: string;
  bots: Array<{ name: string; icon: BotIcon; agentId: string }>;
  waiting: Array<{
    id: string;
    bot: string;
    icon: BotIcon;
    chatHref: string | null;
    title: string;
    detail: string;
    when: string;
    at: string;
    updatedAt: string;
    replies: Array<{ id: string; body: string; at: string; when: string }>;
  }>;
  timeline: Array<{
    day: string;
    entries: Array<{
      id: string;
      bot: string;
      icon: BotIcon;
      when: string;
      text: string;
      at: string;
      postedAt: string;
    }>;
  }>;
  work: Array<{
    id: string;
    bot: string;
    icon: BotIcon;
    title: string;
    detail: string;
    state: "progress" | "blocked" | "done";
    when: string;
    at: string;
    updatedAt: string;
  }>;
} {
  const db = getDb();
  const botRows = db
    .prepare(`SELECT name, icon, agent_id FROM bot_activity_bots ORDER BY name COLLATE NOCASE`)
    .all() as BotRow[];
  const bots = new Map(botRows.map((row) => [row.name, row]));

  const waitingRows = db
    .prepare(
      `SELECT * FROM bot_activity_items
        WHERE kind = 'waiting' AND status = 'open'
        ORDER BY sort_index ASC, occurred_at DESC`
    )
    .all() as ItemRow[];
  const replyMap = repliesFor(waitingRows.map((row) => row.id));

  const workRows = db
    .prepare(
      `SELECT * FROM bot_activity_items
        WHERE kind = 'work'
        ORDER BY sort_index ASC, occurred_at DESC`
    )
    .all() as ItemRow[];

  const timelineRows = db
    .prepare(
      `SELECT id, bot, body, occurred_at, day_label, when_label, created_at
         FROM bot_activity_timeline
        ORDER BY occurred_at DESC, id DESC`
    )
    .all() as TimelineRow[];

  const latest = db
    .prepare(
      `SELECT MAX(occurred_at) AS at FROM (
         SELECT occurred_at FROM bot_activity_items
         UNION ALL
         SELECT occurred_at FROM bot_activity_timeline
       )`
    )
    .get() as { at: string | null };

  const days = groupByPacificDay(
    timelineRows.map((row) => ({
      id: row.id,
      bot: row.bot,
      icon: iconFor(bots, row.bot),
      when: formatClockPt(row.occurred_at),
      text: row.body,
      at: row.occurred_at,
      postedAt: row.created_at,
    }))
  );

  return {
    updated: formatUpdatedPt(latest.at || new Date().toISOString()),
    bots: botRows.map((row) => ({
      name: row.name,
      icon: asBotIcon(row.icon),
      agentId: row.agent_id || "",
    })),
    waiting: waitingRows.map((row) => ({
      id: row.id,
      bot: row.bot,
      icon: iconFor(bots, row.bot),
      chatHref: botChatHref(bots.get(row.bot)?.agent_id),
      title: row.title,
      detail: row.detail,
      when: whenOf(row.when_label, row.occurred_at),
      at: row.occurred_at,
      updatedAt: row.updated_at,
      replies: (replyMap.get(row.id) || []).map((reply) => ({
        id: reply.id,
        body: reply.body,
        at: reply.created_at,
        when: formatUpdatedPt(reply.created_at),
      })),
    })),
    timeline: days,
    work: workRows.map((row) => ({
      id: row.id,
      bot: row.bot,
      icon: iconFor(bots, row.bot),
      title: row.title,
      detail: row.detail,
      state: row.state === "blocked" || row.state === "done" ? row.state : "progress",
      when: whenOf(row.when_label, row.occurred_at),
      at: row.occurred_at,
      updatedAt: row.updated_at,
    })),
  };
}

// Session only. The bot token and its 30/min limit belong to /api/bot-activity.
export function botActivityAdminGet(actor: BotActivityActor): ApiResult {
  const denied = denyActor(actor);
  if (denied) return denied;
  return { status: 200, headers: { "Cache-Control": "no-store" }, body: botActivityBoard() };
}

export async function botActivityAdminPost(
  request: Request,
  actor: BotActivityActor
): Promise<ApiResult> {
  const denied = denyActor(actor);
  if (denied) return denied;
  const payload = await readBody(request);
  if (!payload.ok) return payload.result;
  if (!isRecord(payload.value)) return { status: 400, body: { error: "Body must be a JSON object" } };
  const bodyRecord = payload.value;
  const extra = unknownField(bodyRecord, ["action", "id", "body"]);
  if (extra) return { status: 400, body: { error: `Unknown field ${extra}` } };
  if (bodyRecord.action !== "reply" && bodyRecord.action !== "dismiss") {
    return { status: 400, body: { error: "action must be reply or dismiss" } };
  }
  if (typeof bodyRecord.id !== "string" || !ID_RE.test(bodyRecord.id)) {
    return { status: 400, body: { error: "id is required" } };
  }

  const db = getDb();
  const item = db
    .prepare(`SELECT * FROM bot_activity_items WHERE id = ? AND kind = 'waiting'`)
    .get(bodyRecord.id) as ItemRow | undefined;
  if (!item) return { status: 404, body: { error: "Not found" } };

  const now = new Date().toISOString();
  if (bodyRecord.action === "dismiss") {
    db.prepare(
      `UPDATE bot_activity_items SET status = 'resolved', updated_at = ? WHERE id = ?`
    ).run(now, item.id);
    return { status: 200, body: { ok: true, id: item.id, status: "resolved" } };
  }

  if (item.status === "resolved") return { status: 404, body: { error: "Not found" } };
  const body = cleanText(bodyRecord.body, 4000, true);
  if (body === null || body === undefined) {
    return { status: 400, body: { error: "Reply is required" } };
  }
  const id = nanoid(16);
  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO bot_activity_replies (id, item_id, body, created_at) VALUES (?, ?, ?, ?)`
    ).run(id, item.id, body, now);
    db.prepare(`UPDATE bot_activity_items SET updated_at = ? WHERE id = ?`).run(now, item.id);
  });
  write();
  return {
    status: 200,
    body: {
      ok: true,
      id: item.id,
      reply: { id, body, at: now, when: formatUpdatedPt(now) },
    },
  };
}
