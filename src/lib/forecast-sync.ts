import { timingSafeEqual } from "crypto";
import { nanoid } from "nanoid";
import { ADMIN_PEOPLE } from "./admin-people";
import { getDb, nowIso } from "./db";
import type { ForecastSyncDayHours, ForecastSyncItemView } from "./forecast-sync-view";
import { OWNER_SLUG, PEOPLE, personLabel } from "./people";
import { setUserEmail } from "./users";
import { currentWeek, weekdays } from "./week";

export { SEO_OPS_SYNC_MARKER, UNMATCHED_CLIENT_LABEL } from "./forecast-sync-view";
export type { ForecastSyncDayHours, ForecastSyncItemView } from "./forecast-sync-view";

// A run may name at most this many items. Above that the body is rejected
// before anything is stored.
const MAX_ITEMS = 500;
const MAX_ITEM_MINUTES = 24 * 60;
const MAX_TITLE = 500;
const MAX_ITEM_KEY = 200;
const MAX_TIME_LOG_IDS = 50;
const MAX_DOMAIN = 253;
const MAX_CLIENT_KEY = 64;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const RUN_KEYS_V1 = ["runId", "source", "organizationId", "weeks"] as const;
const WEEK_KEYS_V1 = ["weekStart", "basis", "allocations"] as const;
const ALLOC_KEYS = [
  "personEmail",
  "campaignDeskPersonId",
  "clientId",
  "clientName",
  "bucket",
  "source",
  "minutes",
  "hours",
] as const;

const RUN_KEYS_V2 = ["version", "runId", "source", "organizationId", "weeks"] as const;
const WEEK_KEYS_V2 = ["weekStart", "basis", "people"] as const;
const PERSON_KEYS = ["personEmail", "campaignDeskPersonId", "days"] as const;
const DAY_KEYS = ["date", "items"] as const;
const ITEM_KEYS = [
  "itemKey",
  "kind",
  "bucket",
  "client",
  "title",
  "source",
  "minutes",
  "hours",
  "startTime",
  "sourceIds",
] as const;
const CLIENT_KEYS = ["seoOpsClientId", "name", "domain", "campaignDeskClientId"] as const;
const SOURCE_ID_KEYS = ["taskId", "timeLogIds", "plannerEventId"] as const;

export type ForecastSyncPerson = { id: string; email: string };

export type ForecastSyncAllocation = {
  weekStart: string;
  personEmail: string;
  personId: string;
  clientId: string | null;
  clientName: string;
  bucket: "client" | "internal";
  source: "actual" | "estimate";
  minutes: number;
  hours: string;
};

type ValidAllocation = Omit<ForecastSyncAllocation, "weekStart"> & { slug: string };

type ValidWeekV1 = {
  weekStart: string;
  basis: "actual" | "estimate";
  allocations: ValidAllocation[];
};

type SyncClient = {
  seoOpsClientId: string;
  name: string;
  domain: string | null;
  campaignDeskClientId: string | null;
};

type SourceIds = {
  taskId: string | null;
  timeLogIds: string[];
  plannerEventId: string | null;
};

type ValidItem = {
  itemKey: string;
  kind: "task" | "event";
  bucket: "client" | "internal";
  client: SyncClient | null;
  title: string;
  source: "actual" | "estimate";
  minutes: number;
  hours: string;
  startTime: string | null;
  sourceIds: SourceIds;
  revClientId: string | null;
  displayName: string;
  unmatched: boolean;
};

type ValidDay = { date: string; items: ValidItem[] };

type ValidPerson = {
  personEmail: string;
  personId: string;
  slug: string;
  days: ValidDay[];
};

type ValidWeekV2 = {
  weekStart: string;
  basis: "actual" | "estimate";
  people: ValidPerson[];
};

type ValidRunV1 = {
  version: 1;
  runId: string;
  source: "seo-ops-center";
  organizationId: string;
  weeks: ValidWeekV1[];
};

type ValidRunV2 = {
  version: 2;
  runId: string;
  source: "seo-ops-center";
  organizationId: string;
  weeks: ValidWeekV2[];
};

type ValidRun = ValidRunV1 | ValidRunV2;

export type SyncFailure = {
  ok: false;
  status: 401 | 404 | 409 | 422 | 500;
  error: string;
  message?: string;
};

export type SyncSuccess = {
  ok: true;
  status: 200;
  body: { runId: string; status: "accepted" | "deleted"; idempotent: boolean };
};

function fail(status: SyncFailure["status"], error: string, message?: string): SyncFailure {
  return message ? { ok: false, status, error, message } : { ok: false, status, error };
}

export function forecastSyncPersonId(slug: string): string {
  return `desk_${slug}`;
}

/** Hours string for a minute count: half away from zero, two decimal places. */
export function hoursForMinutes(minutes: number): string {
  const negative = minutes < 0;
  const scaled = Math.abs(minutes) * 100;
  const quotient = Math.floor(scaled / 60);
  const remainder = scaled % 60;
  const hundredths = remainder * 2 >= 60 ? quotient + 1 : quotient;
  const whole = Math.floor(hundredths / 100);
  const frac = hundredths % 100;
  return `${negative ? "-" : ""}${whole}.${String(frac).padStart(2, "0")}`;
}

function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

export function forecastSyncAuthorized(authorization: string | null): boolean {
  const secret = process.env.CAMPAIGN_DESK_API_TOKEN || "";
  const presented = bearerToken(authorization) || "";
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  if (!secret || a.length !== b.length) {
    if (b.length) timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export function listForecastSyncPeople(): ForecastSyncPerson[] {
  const rows = getDb()
    .prepare(`SELECT slug, email, active FROM users`)
    .all() as Array<{ slug: string; email: string | null; active: number }>;
  const stored = new Map<string, string>();
  for (const row of rows) {
    if (!row.active) continue;
    const email = (row.email || "").trim().toLowerCase();
    if (email) stored.set(row.slug, email);
  }

  const people: ForecastSyncPerson[] = [];
  const seen = new Map<string, number>();
  for (const person of PEOPLE) {
    const email = stored.get(person.slug) || "";
    if (!email) continue;
    people.push({ id: forecastSyncPersonId(person.slug), email });
    seen.set(email, (seen.get(email) || 0) + 1);
  }
  return people
    .filter((person) => seen.get(person.email) === 1)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Active Basecamp clients SEO Ops can send as campaignDeskClientId. */
export function listForecastSyncClients(): Array<{ id: string; name: string }> {
  return getDb()
    .prepare(
      `SELECT id, name FROM rev_clients WHERE active = 1 ORDER BY name COLLATE NOCASE, id`
    )
    .all() as Array<{ id: string; name: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unknownKey(value: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return key;
  }
  return null;
}

function isMonday(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 1;
}

function addUtcDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function dateInWeek(date: string, weekStart: string): boolean {
  return date >= weekStart && date < addUtcDays(weekStart, 7);
}

function slugFromSyncPersonId(personId: string): string | null {
  const prefix = "desk_";
  if (!personId.startsWith(prefix)) return null;
  const slug = personId.slice(prefix.length);
  return PEOPLE.some((person) => person.slug === slug) ? slug : null;
}

function rosterRole(slug: string): "owner" | "admin" | "forecast" {
  if (slug === OWNER_SLUG) return "owner";
  if (ADMIN_PEOPLE.some((person) => person.slug === slug)) return "admin";
  return "forecast";
}

/**
 * Resolve the sender's email to a roster person.
 *
 * The desk id must already be `desk_` plus a forecast slug. An email already
 * stored on that account matches. An account with no email yet can take this
 * one. An email that belongs to someone else, or a different email already
 * on this account, is rejected. Nothing is written here.
 */
function inspectSyncPerson(
  email: string,
  personId: string,
  at: string
): { slug: string } | SyncFailure {
  const slug = slugFromSyncPersonId(personId);
  if (!slug || personId !== forecastSyncPersonId(slug)) {
    return fail(422, "invalid_payload", `${at} is not a forecast person`);
  }
  const db = getDb();
  const owner = db
    .prepare(`SELECT slug, active FROM users WHERE email = ?`)
    .get(email) as { slug: string; active: number } | undefined;
  if (owner) {
    if (owner.slug !== slug || !owner.active) {
      return fail(422, "invalid_payload", `${at} does not match personEmail`);
    }
    return { slug };
  }
  const user = db
    .prepare(`SELECT email, active FROM users WHERE slug = ?`)
    .get(slug) as { email: string | null; active: number } | undefined;
  if (user && !user.active) {
    return fail(422, "invalid_payload", `${at} is not an active forecast person`);
  }
  if (user) {
    const existing = (user.email || "").trim().toLowerCase();
    if (existing && existing !== email) {
      return fail(422, "invalid_payload", `${at} does not match personEmail`);
    }
  }
  return { slug };
}

/** Record the sender's email on a roster account that does not have one yet. */
function bindSyncPerson(slug: string, email: string): SyncFailure | null {
  const db = getDb();
  let row = db
    .prepare(`SELECT email, active FROM users WHERE slug = ?`)
    .get(slug) as { email: string | null; active: number } | undefined;
  if (!row) {
    const now = nowIso();
    db.prepare(
      `INSERT INTO users (slug, label, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO NOTHING`
    ).run(slug, personLabel(slug), rosterRole(slug), now, now);
    row = db
      .prepare(`SELECT email, active FROM users WHERE slug = ?`)
      .get(slug) as { email: string | null; active: number } | undefined;
  }
  if (!row || !row.active) {
    return fail(422, "invalid_payload", "personEmail is not an active forecast person");
  }
  const existing = (row.email || "").trim().toLowerCase();
  if (existing === email) return null;
  if (existing) {
    return fail(422, "invalid_payload", "personEmail does not match campaignDeskPersonId");
  }
  try {
    setUserEmail(slug, email);
  } catch {
    return fail(422, "invalid_payload", "personEmail is already on another account");
  }
  return null;
}

function parseEmailAndPerson(
  value: Record<string, unknown>,
  at: string
): { personEmail: string; personId: string; slug: string } | SyncFailure {
  const personEmail = value.personEmail;
  if (
    typeof personEmail !== "string" ||
    personEmail !== personEmail.trim().toLowerCase() ||
    !EMAIL_RE.test(personEmail)
  ) {
    return fail(422, "invalid_payload", `${at}.personEmail must be a lowercase email`);
  }
  if (typeof value.campaignDeskPersonId !== "string") {
    return fail(422, "invalid_payload", `${at}.campaignDeskPersonId must be a string`);
  }
  const inspected = inspectSyncPerson(personEmail, value.campaignDeskPersonId, `${at}.campaignDeskPersonId`);
  if (isFailure(inspected)) return inspected;
  return { personEmail, personId: forecastSyncPersonId(inspected.slug), slug: inspected.slug };
}

function validateAllocation(value: unknown, index: string): ValidAllocation | SyncFailure {
  if (!isRecord(value)) return fail(422, "invalid_payload", `${index} must be an object`);
  const extra = unknownKey(value, ALLOC_KEYS);
  if (extra) return fail(422, "invalid_payload", `${index}.${extra} is not allowed`);

  const who = parseEmailAndPerson(value, index);
  if (isFailure(who)) return who;

  const bucket = value.bucket;
  if (bucket !== "client" && bucket !== "internal") {
    return fail(422, "invalid_payload", `${index}.bucket must be client or internal`);
  }

  const clientId = value.clientId;
  if (bucket === "internal") {
    if (clientId !== null) {
      return fail(422, "invalid_payload", `${index}.clientId must be null when bucket is internal`);
    }
    if (value.clientName !== "Internal") {
      return fail(422, "invalid_payload", `${index}.clientName must be Internal`);
    }
  } else {
    if (typeof clientId !== "string" || !UUID_RE.test(clientId)) {
      return fail(422, "invalid_payload", `${index}.clientId must be a UUID when bucket is client`);
    }
    if (typeof value.clientName !== "string" || !value.clientName.trim() || value.clientName === "Internal") {
      return fail(422, "invalid_payload", `${index}.clientName must be the client name`);
    }
  }

  if (value.source !== "actual" && value.source !== "estimate") {
    return fail(422, "invalid_payload", `${index}.source must be actual or estimate`);
  }
  if (typeof value.minutes !== "number" || !Number.isInteger(value.minutes) || value.minutes < 0) {
    return fail(422, "invalid_payload", `${index}.minutes must be an integer >= 0`);
  }
  if (typeof value.hours !== "string") {
    return fail(422, "invalid_payload", `${index}.hours must be a string`);
  }
  if (value.hours !== hoursForMinutes(value.minutes)) {
    return fail(422, "invalid_payload", `${index}.hours must equal minutes / 60`);
  }

  return {
    personEmail: who.personEmail,
    personId: who.personId,
    slug: who.slug,
    clientId: bucket === "internal" ? null : (clientId as string).toLowerCase(),
    clientName: value.clientName as string,
    bucket,
    source: value.source,
    minutes: value.minutes,
    hours: value.hours,
  };
}

function parseRunIdentity(
  runId: string,
  body: Record<string, unknown>
): { runId: string; organizationId: string } | SyncFailure {
  if (!UUID_RE.test(runId)) return fail(422, "invalid_payload", "runId must be a UUID");
  if (typeof body.runId !== "string" || !UUID_RE.test(body.runId)) {
    return fail(422, "invalid_payload", "runId must be a UUID");
  }
  if (body.runId.toLowerCase() !== runId.toLowerCase()) {
    return fail(422, "invalid_payload", "runId must match the URL");
  }
  if (body.source !== "seo-ops-center") {
    return fail(422, "invalid_payload", "source must be seo-ops-center");
  }
  if (typeof body.organizationId !== "string" || !UUID_RE.test(body.organizationId)) {
    return fail(422, "invalid_payload", "organizationId must be a UUID");
  }
  if (!Array.isArray(body.weeks) || body.weeks.length < 1 || body.weeks.length > 4) {
    return fail(422, "invalid_payload", "weeks must contain 1 to 4 weeks");
  }
  return {
    runId: runId.toLowerCase(),
    organizationId: body.organizationId.toLowerCase(),
  };
}

function parseWeekStart(
  week: Record<string, unknown>,
  at: string,
  seenWeeks: Set<string>
): { weekStart: string; basis: "actual" | "estimate" } | SyncFailure {
  if (typeof week.weekStart !== "string" || !DATE_RE.test(week.weekStart) || !isMonday(week.weekStart)) {
    return fail(422, "invalid_payload", `${at}.weekStart must be a Monday yyyy-MM-dd`);
  }
  if (seenWeeks.has(week.weekStart)) {
    return fail(422, "invalid_payload", `${at}.weekStart is repeated`);
  }
  seenWeeks.add(week.weekStart);
  if (week.basis !== "actual" && week.basis !== "estimate") {
    return fail(422, "invalid_payload", `${at}.basis must be actual or estimate`);
  }
  return { weekStart: week.weekStart, basis: week.basis };
}

function parseV1(runId: string, body: Record<string, unknown>): ValidRunV1 | SyncFailure {
  const extra = unknownKey(body, RUN_KEYS_V1);
  if (extra) return fail(422, "invalid_payload", `${extra} is not allowed`);
  const identity = parseRunIdentity(runId, body);
  if (isFailure(identity)) return identity;

  const weeks: ValidWeekV1[] = [];
  const seenWeeks = new Set<string>();
  const rawWeeks = body.weeks as unknown[];
  for (let i = 0; i < rawWeeks.length; i++) {
    const week = rawWeeks[i];
    const at = `weeks[${i}]`;
    if (!isRecord(week)) return fail(422, "invalid_payload", `${at} must be an object`);
    const weekExtra = unknownKey(week, WEEK_KEYS_V1);
    if (weekExtra) return fail(422, "invalid_payload", `${at}.${weekExtra} is not allowed`);
    const head = parseWeekStart(week, at, seenWeeks);
    if (isFailure(head)) return head;
    if (!Array.isArray(week.allocations)) {
      return fail(422, "invalid_payload", `${at}.allocations must be an array`);
    }
    const allocations: ValidAllocation[] = [];
    for (let j = 0; j < week.allocations.length; j++) {
      const parsed = validateAllocation(week.allocations[j], `${at}.allocations[${j}]`);
      if (isFailure(parsed)) return parsed;
      if (parsed.source !== head.basis) {
        return fail(422, "invalid_payload", `${at}.allocations[${j}].source must match basis`);
      }
      allocations.push(parsed);
    }
    weeks.push({ weekStart: head.weekStart, basis: head.basis, allocations });
  }

  return {
    version: 1,
    runId: identity.runId,
    source: "seo-ops-center",
    organizationId: identity.organizationId,
    weeks,
  };
}

function optionalUuid(value: unknown, at: string): string | null | SyncFailure {
  if (value === null) return null;
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    return fail(422, "invalid_payload", `${at} must be a UUID or null`);
  }
  return value.toLowerCase();
}

function matchClient(client: SyncClient): {
  revClientId: string | null;
  displayName: string;
  unmatched: boolean;
} {
  const db = getDb();
  if (client.campaignDeskClientId) {
    const byKey = db
      .prepare(`SELECT id, name FROM rev_clients WHERE id = ?`)
      .get(client.campaignDeskClientId) as { id: string; name: string } | undefined;
    if (byKey) return { revClientId: byKey.id, displayName: byKey.name, unmatched: false };
  }
  const byName = db
    .prepare(`SELECT id, name FROM rev_clients WHERE name = ?`)
    .all(client.name) as Array<{ id: string; name: string }>;
  if (byName.length === 1) {
    return { revClientId: byName[0].id, displayName: byName[0].name, unmatched: false };
  }
  return { revClientId: null, displayName: client.name, unmatched: true };
}

function validateClient(value: unknown, at: string): SyncClient | SyncFailure {
  if (!isRecord(value)) return fail(422, "invalid_payload", `${at} must be an object`);
  const extra = unknownKey(value, CLIENT_KEYS);
  if (extra) return fail(422, "invalid_payload", `${at}.${extra} is not allowed`);
  if (typeof value.seoOpsClientId !== "string" || !UUID_RE.test(value.seoOpsClientId)) {
    return fail(422, "invalid_payload", `${at}.seoOpsClientId must be a UUID`);
  }
  if (typeof value.name !== "string" || !value.name.trim() || value.name.trim() === "Internal") {
    return fail(422, "invalid_payload", `${at}.name must be the client name`);
  }
  if (value.name.trim().length > MAX_TITLE) {
    return fail(422, "invalid_payload", `${at}.name is too long`);
  }
  let domain: string | null = null;
  if (value.domain !== undefined && value.domain !== null) {
    if (typeof value.domain !== "string" || value.domain.trim().length > MAX_DOMAIN) {
      return fail(422, "invalid_payload", `${at}.domain must be a string or null`);
    }
    domain = value.domain.trim() || null;
  }
  let campaignDeskClientId: string | null = null;
  if (!Object.prototype.hasOwnProperty.call(value, "campaignDeskClientId")) {
    return fail(422, "invalid_payload", `${at}.campaignDeskClientId must be a string or null`);
  }
  if (value.campaignDeskClientId !== null) {
    if (
      typeof value.campaignDeskClientId !== "string" ||
      !value.campaignDeskClientId.trim() ||
      value.campaignDeskClientId !== value.campaignDeskClientId.trim() ||
      value.campaignDeskClientId.length > MAX_CLIENT_KEY
    ) {
      return fail(422, "invalid_payload", `${at}.campaignDeskClientId must be a string or null`);
    }
    campaignDeskClientId = value.campaignDeskClientId;
  }
  return {
    seoOpsClientId: value.seoOpsClientId.toLowerCase(),
    name: value.name.trim(),
    domain,
    campaignDeskClientId,
  };
}

function validateSourceIds(value: unknown, at: string): SourceIds | SyncFailure {
  if (!isRecord(value)) return fail(422, "invalid_payload", `${at} must be an object`);
  const extra = unknownKey(value, SOURCE_ID_KEYS);
  if (extra) return fail(422, "invalid_payload", `${at}.${extra} is not allowed`);
  for (const key of SOURCE_ID_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      return fail(422, "invalid_payload", `${at}.${key} is required`);
    }
  }
  const taskId = optionalUuid(value.taskId, `${at}.taskId`);
  if (isFailure(taskId)) return taskId;
  const plannerEventId = optionalUuid(value.plannerEventId, `${at}.plannerEventId`);
  if (isFailure(plannerEventId)) return plannerEventId;
  if (!Array.isArray(value.timeLogIds)) {
    return fail(422, "invalid_payload", `${at}.timeLogIds must be an array`);
  }
  if (value.timeLogIds.length > MAX_TIME_LOG_IDS) {
    return fail(422, "invalid_payload", `${at}.timeLogIds is too long`);
  }
  const timeLogIds: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < value.timeLogIds.length; i++) {
    const id = value.timeLogIds[i];
    if (typeof id !== "string" || !UUID_RE.test(id)) {
      return fail(422, "invalid_payload", `${at}.timeLogIds[${i}] must be a UUID`);
    }
    const lower = id.toLowerCase();
    if (seen.has(lower)) {
      return fail(422, "invalid_payload", `${at}.timeLogIds[${i}] is repeated`);
    }
    seen.add(lower);
    timeLogIds.push(lower);
  }
  return { taskId, timeLogIds, plannerEventId };
}

function validateItem(value: unknown, at: string, basis: "actual" | "estimate"): ValidItem | SyncFailure {
  if (!isRecord(value)) return fail(422, "invalid_payload", `${at} must be an object`);
  const extra = unknownKey(value, ITEM_KEYS);
  if (extra) return fail(422, "invalid_payload", `${at}.${extra} is not allowed`);
  for (const key of ITEM_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      return fail(422, "invalid_payload", `${at}.${key} is required`);
    }
  }
  if (
    typeof value.itemKey !== "string" ||
    value.itemKey.length < 1 ||
    value.itemKey.length > MAX_ITEM_KEY ||
    value.itemKey !== value.itemKey.trim() ||
    /[\u0000-\u001f]/.test(value.itemKey)
  ) {
    return fail(422, "invalid_payload", `${at}.itemKey must be a short stable string`);
  }
  if (value.kind !== "task" && value.kind !== "event") {
    return fail(422, "invalid_payload", `${at}.kind must be task or event`);
  }
  if (value.bucket !== "client" && value.bucket !== "internal") {
    return fail(422, "invalid_payload", `${at}.bucket must be client or internal`);
  }
  let client: SyncClient | null = null;
  if (value.bucket === "internal") {
    if (value.client !== null) {
      return fail(422, "invalid_payload", `${at}.client must be null when bucket is internal`);
    }
  } else {
    const parsedClient = validateClient(value.client, `${at}.client`);
    if (isFailure(parsedClient)) return parsedClient;
    client = parsedClient;
  }
  if (typeof value.title !== "string" || !value.title.trim() || value.title.trim().length > MAX_TITLE) {
    return fail(422, "invalid_payload", `${at}.title must be the item title`);
  }
  if (value.source !== basis) {
    return fail(422, "invalid_payload", `${at}.source must match basis`);
  }
  if (
    typeof value.minutes !== "number" ||
    !Number.isInteger(value.minutes) ||
    value.minutes < 1 ||
    value.minutes > MAX_ITEM_MINUTES
  ) {
    return fail(422, "invalid_payload", `${at}.minutes must be an integer from 1 to 1440`);
  }
  if (typeof value.hours !== "string" || value.hours !== hoursForMinutes(value.minutes)) {
    return fail(422, "invalid_payload", `${at}.hours must equal minutes / 60`);
  }
  if (value.startTime !== null && (typeof value.startTime !== "string" || !TIME_RE.test(value.startTime))) {
    return fail(422, "invalid_payload", `${at}.startTime must be HH:MM or null`);
  }
  const sourceIds = validateSourceIds(value.sourceIds, `${at}.sourceIds`);
  if (isFailure(sourceIds)) return sourceIds;
  const matched = client
    ? matchClient(client)
    : { revClientId: null, displayName: "Internal", unmatched: false };
  return {
    itemKey: value.itemKey,
    kind: value.kind,
    bucket: value.bucket,
    client,
    title: value.title.trim(),
    source: basis,
    minutes: value.minutes,
    hours: value.hours,
    startTime: value.startTime,
    sourceIds,
    revClientId: matched.revClientId,
    displayName: matched.displayName,
    unmatched: matched.unmatched,
  };
}

function parseV2(runId: string, body: Record<string, unknown>): ValidRunV2 | SyncFailure {
  const extra = unknownKey(body, RUN_KEYS_V2);
  if (extra) return fail(422, "invalid_payload", `${extra} is not allowed`);
  const identity = parseRunIdentity(runId, body);
  if (isFailure(identity)) return identity;

  const weeks: ValidWeekV2[] = [];
  const seenWeeks = new Set<string>();
  let itemCount = 0;
  const rawWeeks = body.weeks as unknown[];
  for (let i = 0; i < rawWeeks.length; i++) {
    const week = rawWeeks[i];
    const at = `weeks[${i}]`;
    if (!isRecord(week)) return fail(422, "invalid_payload", `${at} must be an object`);
    const weekExtra = unknownKey(week, WEEK_KEYS_V2);
    if (weekExtra) return fail(422, "invalid_payload", `${at}.${weekExtra} is not allowed`);
    const head = parseWeekStart(week, at, seenWeeks);
    if (isFailure(head)) return head;
    if (!Array.isArray(week.people)) {
      return fail(422, "invalid_payload", `${at}.people must be an array`);
    }
    const people: ValidPerson[] = [];
    const seenPeople = new Set<string>();
    for (let p = 0; p < week.people.length; p++) {
      const person = week.people[p];
      const pat = `${at}.people[${p}]`;
      if (!isRecord(person)) return fail(422, "invalid_payload", `${pat} must be an object`);
      const personExtra = unknownKey(person, PERSON_KEYS);
      if (personExtra) return fail(422, "invalid_payload", `${pat}.${personExtra} is not allowed`);
      const who = parseEmailAndPerson(person, pat);
      if (isFailure(who)) return who;
      if (seenPeople.has(who.personEmail)) {
        return fail(422, "invalid_payload", `${pat}.personEmail is repeated`);
      }
      seenPeople.add(who.personEmail);
      if (!Array.isArray(person.days)) {
        return fail(422, "invalid_payload", `${pat}.days must be an array`);
      }
      const days: ValidDay[] = [];
      const seenDates = new Set<string>();
      for (let d = 0; d < person.days.length; d++) {
        const day = person.days[d];
        const dat = `${pat}.days[${d}]`;
        if (!isRecord(day)) return fail(422, "invalid_payload", `${dat} must be an object`);
        const dayExtra = unknownKey(day, DAY_KEYS);
        if (dayExtra) return fail(422, "invalid_payload", `${dat}.${dayExtra} is not allowed`);
        if (typeof day.date !== "string" || !DATE_RE.test(day.date) || !dateInWeek(day.date, head.weekStart)) {
          return fail(422, "invalid_payload", `${dat}.date must be a day in the week`);
        }
        if (seenDates.has(day.date)) {
          return fail(422, "invalid_payload", `${dat}.date is repeated`);
        }
        seenDates.add(day.date);
        if (!Array.isArray(day.items)) {
          return fail(422, "invalid_payload", `${dat}.items must be an array`);
        }
        const items: ValidItem[] = [];
        const seenKeys = new Set<string>();
        for (let n = 0; n < day.items.length; n++) {
          itemCount += 1;
          if (itemCount > MAX_ITEMS) {
            return fail(422, "invalid_payload", `a run can include at most ${MAX_ITEMS} items`);
          }
          const item = validateItem(day.items[n], `${dat}.items[${n}]`, head.basis);
          if (isFailure(item)) return item;
          if (seenKeys.has(item.itemKey)) {
            return fail(422, "invalid_payload", `${dat}.items[${n}].itemKey is repeated`);
          }
          seenKeys.add(item.itemKey);
          items.push(item);
        }
        days.push({ date: day.date, items });
      }
      people.push({ ...who, days });
    }
    weeks.push({ weekStart: head.weekStart, basis: head.basis, people });
  }

  return {
    version: 2,
    runId: identity.runId,
    source: "seo-ops-center",
    organizationId: identity.organizationId,
    weeks,
  };
}

export function parseForecastRun(runId: string, body: unknown): ValidRun | SyncFailure {
  if (!isRecord(body)) return fail(422, "invalid_payload", "Body must be a JSON object");
  if (body.version === undefined) return parseV1(runId, body);
  if (body.version !== 2) return fail(422, "invalid_payload", "version must be 2");
  return parseV2(runId, body);
}

function canonicalAllocation(line: ValidAllocation) {
  return {
    personEmail: line.personEmail,
    campaignDeskPersonId: line.personId,
    clientId: line.clientId,
    clientName: line.clientName,
    bucket: line.bucket,
    source: line.source,
    minutes: line.minutes,
    hours: line.hours,
  };
}

function canonicalJsonV1(run: ValidRunV1): string {
  return JSON.stringify({
    runId: run.runId,
    source: run.source,
    organizationId: run.organizationId,
    weeks: run.weeks.map((week) => ({
      weekStart: week.weekStart,
      basis: week.basis,
      allocations: week.allocations.map(canonicalAllocation),
    })),
  });
}

function canonicalJsonV2(run: ValidRunV2): string {
  return JSON.stringify({
    version: 2,
    runId: run.runId,
    source: run.source,
    organizationId: run.organizationId,
    weeks: run.weeks.map((week) => ({
      weekStart: week.weekStart,
      basis: week.basis,
      people: week.people.map((person) => ({
        personEmail: person.personEmail,
        campaignDeskPersonId: person.personId,
        days: person.days.map((day) => ({
          date: day.date,
          items: day.items.map((item) => ({
            itemKey: item.itemKey,
            kind: item.kind,
            bucket: item.bucket,
            client: item.client
              ? {
                  seoOpsClientId: item.client.seoOpsClientId,
                  name: item.client.name,
                  domain: item.client.domain,
                  campaignDeskClientId: item.client.campaignDeskClientId,
                }
              : null,
            title: item.title,
            source: item.source,
            minutes: item.minutes,
            hours: item.hours,
            startTime: item.startTime,
            sourceIds: {
              taskId: item.sourceIds.taskId,
              timeLogIds: item.sourceIds.timeLogIds,
              plannerEventId: item.sourceIds.plannerEventId,
            },
          })),
        })),
      })),
    })),
  });
}

function canonicalJson(run: ValidRun): string {
  return run.version === 1 ? canonicalJsonV1(run) : canonicalJsonV2(run);
}

function isFailure(value: unknown): value is SyncFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as SyncFailure).ok === false
  );
}

function peopleToBind(run: ValidRun): Array<{ slug: string; email: string }> {
  const pairs =
    run.version === 1
      ? run.weeks.flatMap((week) =>
          week.allocations.map((line) => ({ slug: line.slug, email: line.personEmail }))
        )
      : run.weeks.flatMap((week) =>
          week.people.map((person) => ({ slug: person.slug, email: person.personEmail }))
        );
  const seen = new Set<string>();
  const out: Array<{ slug: string; email: string }> = [];
  for (const pair of pairs) {
    const key = `${pair.slug}\0${pair.email}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pair);
  }
  return out;
}

/** Week totals Campaign Desk already reads, summed from the items in a v2 week. */
function deriveAllocations(people: ValidPerson[]): ValidAllocation[] {
  const map = new Map<string, ValidAllocation>();
  for (const person of people) {
    for (const day of person.days) {
      for (const item of day.items) {
        const clientId = item.bucket === "internal" ? null : item.client?.seoOpsClientId || null;
        const clientName = item.displayName;
        const key = `${person.personId}\0${item.bucket}\0${clientId || ""}\0${item.source}`;
        const existing = map.get(key);
        if (existing) {
          existing.minutes += item.minutes;
          existing.hours = hoursForMinutes(existing.minutes);
          continue;
        }
        map.set(key, {
          personEmail: person.personEmail,
          personId: person.personId,
          slug: person.slug,
          clientId,
          clientName,
          bucket: item.bucket,
          source: item.source,
          minutes: item.minutes,
          hours: item.hours,
        });
      }
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      a.personEmail.localeCompare(b.personEmail) ||
      a.bucket.localeCompare(b.bucket) ||
      a.clientName.localeCompare(b.clientName) ||
      (a.clientId || "").localeCompare(b.clientId || "")
  );
}

export function upsertForecastRun(urlRunId: string, body: unknown): SyncSuccess | SyncFailure {
  const parsed = parseForecastRun(urlRunId, body);
  if (isFailure(parsed)) return parsed;
  const canonical = canonicalJson(parsed);
  const db = getDb();
  const existing = db
    .prepare(`SELECT canonical_json FROM seo_ops_forecast_runs WHERE run_id = ?`)
    .get(parsed.runId) as { canonical_json: string } | undefined;

  if (existing) {
    if (existing.canonical_json === canonical) {
      return {
        ok: true,
        status: 200,
        body: { runId: parsed.runId, status: "accepted", idempotent: true },
      };
    }
    return fail(409, "idempotency_conflict", "This run id was already stored with a different body");
  }

  const ts = nowIso();
  const insertRun = db.prepare(
    `INSERT INTO seo_ops_forecast_runs
       (run_id, organization_id, canonical_json, status, created_at, deleted_at)
     VALUES (?, ?, ?, 'accepted', ?, NULL)`
  );
  const insertWeek = db.prepare(
    `INSERT INTO seo_ops_forecast_weeks (run_id, week_start, basis) VALUES (?, ?, ?)`
  );
  const insertLine = db.prepare(
    `INSERT INTO seo_ops_forecast_allocations
       (id, run_id, week_start, person_email, person_id, client_id, client_name, bucket, source, minutes, hours)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertItem = db.prepare(
    `INSERT INTO seo_ops_forecast_items
       (id, run_id, week_start, person_email, person_id, item_date, item_key, kind, bucket,
        seo_ops_client_id, rev_client_id, client_name, unmatched, title, source, minutes, hours,
        start_time, source_ids_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let rejected: SyncFailure | null = null;
  try {
    db.transaction(() => {
      for (const person of peopleToBind(parsed)) {
        const bound = bindSyncPerson(person.slug, person.email);
        if (bound) {
          rejected = bound;
          throw new Error("sync-reject");
        }
      }
      insertRun.run(parsed.runId, parsed.organizationId, canonical, ts);
      if (parsed.version === 1) {
        for (const week of parsed.weeks) {
          insertWeek.run(parsed.runId, week.weekStart, week.basis);
          for (const line of week.allocations) {
            insertLine.run(
              nanoid(12),
              parsed.runId,
              week.weekStart,
              line.personEmail,
              line.personId,
              line.clientId,
              line.clientName,
              line.bucket,
              line.source,
              line.minutes,
              line.hours
            );
          }
        }
        return;
      }
      for (const week of parsed.weeks) {
        insertWeek.run(parsed.runId, week.weekStart, week.basis);
        for (const line of deriveAllocations(week.people)) {
          insertLine.run(
            nanoid(12),
            parsed.runId,
            week.weekStart,
            line.personEmail,
            line.personId,
            line.clientId,
            line.clientName,
            line.bucket,
            line.source,
            line.minutes,
            line.hours
          );
        }
        for (const person of week.people) {
          for (const day of person.days) {
            for (const item of day.items) {
              insertItem.run(
                nanoid(12),
                parsed.runId,
                week.weekStart,
                person.personEmail,
                person.personId,
                day.date,
                item.itemKey,
                item.kind,
                item.bucket,
                item.client?.seoOpsClientId || null,
                item.revClientId,
                item.displayName,
                item.unmatched ? 1 : 0,
                item.title,
                item.source,
                item.minutes,
                item.hours,
                item.startTime,
                JSON.stringify(item.sourceIds)
              );
            }
          }
        }
      }
    })();
  } catch (err) {
    if (rejected) return rejected;
    throw err;
  }

  return {
    ok: true,
    status: 200,
    body: { runId: parsed.runId, status: "accepted", idempotent: false },
  };
}

export function deleteForecastRun(urlRunId: string): SyncSuccess | SyncFailure {
  if (!UUID_RE.test(urlRunId)) return fail(422, "invalid_payload", "runId must be a UUID");
  const runId = urlRunId.toLowerCase();
  const db = getDb();
  const existing = db
    .prepare(`SELECT status FROM seo_ops_forecast_runs WHERE run_id = ?`)
    .get(runId) as { status: string } | undefined;
  if (!existing) return fail(404, "run_not_found");
  if (existing.status === "deleted") {
    return {
      ok: true,
      status: 200,
      body: { runId, status: "deleted", idempotent: true },
    };
  }
  db.prepare(
    `UPDATE seo_ops_forecast_runs SET status = 'deleted', deleted_at = ? WHERE run_id = ?`
  ).run(nowIso(), runId);
  return {
    ok: true,
    status: 200,
    body: { runId, status: "deleted", idempotent: false },
  };
}

function activeRunId(weekStart: string): string | null {
  const owner = getDb()
    .prepare(
      `SELECT w.run_id
         FROM seo_ops_forecast_weeks w
         JOIN seo_ops_forecast_runs r ON r.run_id = w.run_id
        WHERE w.week_start = ? AND r.status = 'accepted'
        ORDER BY r.created_at DESC, r.run_id DESC
        LIMIT 1`
    )
    .get(weekStart) as { run_id: string } | undefined;
  return owner?.run_id || null;
}

/** Allocations currently in effect for one Monday. Empty means the week is clear. */
export function activeForecastSyncAllocations(weekStart: string): ForecastSyncAllocation[] {
  const runId = activeRunId(weekStart);
  if (!runId) return [];
  const rows = getDb()
    .prepare(
      `SELECT week_start, person_email, person_id, client_id, client_name, bucket, source, minutes, hours
         FROM seo_ops_forecast_allocations
        WHERE run_id = ? AND week_start = ?
        ORDER BY person_email, bucket, client_name, minutes`
    )
    .all(runId, weekStart) as Array<{
    week_start: string;
    person_email: string;
    person_id: string;
    client_id: string | null;
    client_name: string;
    bucket: "client" | "internal";
    source: "actual" | "estimate";
    minutes: number;
    hours: string;
  }>;
  return rows.map((row) => ({
    weekStart: row.week_start,
    personEmail: row.person_email,
    personId: row.person_id,
    clientId: row.client_id,
    clientName: row.client_name,
    bucket: row.bucket,
    source: row.source,
    minutes: row.minutes,
    hours: row.hours,
  }));
}

type ItemRow = {
  id: string;
  person_id: string;
  item_date: string;
  item_key: string;
  kind: "task" | "event";
  bucket: "client" | "internal";
  client_name: string;
  unmatched: number;
  title: string;
  source: "actual" | "estimate";
  minutes: number;
  hours: string;
  start_time: string | null;
};

function activeItems(weekStart: string, source: "actual" | "estimate"): ItemRow[] {
  const runId = activeRunId(weekStart);
  if (!runId) return [];
  return getDb()
    .prepare(
      `SELECT id, person_id, item_date, item_key, kind, bucket, client_name, unmatched,
              title, source, minutes, hours, start_time
         FROM seo_ops_forecast_items
        WHERE run_id = ? AND week_start = ? AND source = ?
        ORDER BY item_date, start_time IS NULL, start_time, title, item_key`
    )
    .all(runId, weekStart, source) as ItemRow[];
}

function countingSource(weekStart: string, asOfWeek: string): "actual" | "estimate" {
  return weekStart > asOfWeek ? "estimate" : "actual";
}

function toItemView(row: ItemRow): ForecastSyncItemView {
  return {
    id: row.id,
    date: row.item_date,
    itemKey: row.item_key,
    kind: row.kind,
    bucket: row.bucket,
    clientName: row.client_name,
    unmatched: row.unmatched === 1,
    title: row.title,
    hours: Number(row.hours),
    startTime: row.start_time,
    source: row.source,
  };
}

/**
 * Items the forecast page should show for one person and Monday.
 *
 * A week that has started reads `actual` items. A later week reads `estimate`
 * items. A version-1 week has totals and no items. Weekend rows are included
 * here; the Mon–Fri bars drop them.
 */
export function forecastSyncItemsForPerson(
  person: string,
  weekStart: string,
  asOfWeek = currentWeek()
): ForecastSyncItemView[] {
  const personId = forecastSyncPersonId(person);
  if (slugFromSyncPersonId(personId) !== person) return [];
  return activeItems(weekStart, countingSource(weekStart, asOfWeek))
    .filter((row) => row.person_id === personId)
    .map(toItemView);
}

/**
 * Mon–Fri hours from the items that count for this week.
 * `hours` is the full day. `internalHours` is the internal slice of it.
 * Client meetings stay in `hours` and out of `internalHours`.
 */
export function forecastSyncHoursByDate(
  person: string,
  weekStart: string,
  asOfWeek = currentWeek()
): Record<string, ForecastSyncDayHours> {
  const personId = forecastSyncPersonId(person);
  if (slugFromSyncPersonId(personId) !== person) return {};
  const allowed = new Set(weekdays(weekStart));
  const minutes = new Map<string, { all: number; internal: number }>();
  for (const item of activeItems(weekStart, countingSource(weekStart, asOfWeek))) {
    if (item.person_id !== personId || !allowed.has(item.item_date)) continue;
    const row = minutes.get(item.item_date) || { all: 0, internal: 0 };
    row.all += item.minutes;
    if (item.bucket === "internal") row.internal += item.minutes;
    minutes.set(item.item_date, row);
  }
  const out: Record<string, ForecastSyncDayHours> = {};
  for (const [date, row] of minutes) {
    if (row.all <= 0) continue;
    out[date] = {
      hours: Number(hoursForMinutes(row.all)),
      internalHours: Number(hoursForMinutes(row.internal)),
    };
  }
  return out;
}

export type ForecastSyncPersonHours = {
  person: string;
  /** Hours for the Weekly forecast. Actuals before this week ends, estimates after. */
  forecastHours: number;
  /** Tracked time. Zero for a future week, which is still an estimate. */
  trackedHours: number;
  /** Internal bucket already included above. Client work, including client meetings, is not in here. */
  internalHours: number;
};

const EMPTY_SYNC_HOURS = {
  forecastHours: 0,
  trackedHours: 0,
  internalHours: 0,
} as const;

/**
 * Hours the Weekly forecast and Tracked views should read for one Monday.
 *
 * The newest accepted run owns the week, so a re-sync replaces that week
 * instead of stacking on the previous body. Deleting a run drops it here; if
 * it was the newest, the previous accepted run for that week comes back.
 * Version-2 weeks store the same totals, derived from their items, so this
 * sum is the item sum and must not be added a second time.
 *
 * A week that has already started counts its `actual` lines as tracked time
 * and as the forecast. A later week counts its `estimate` lines as forecast
 * only. Anything outside client and internal is ignored, and a week with no
 * lines stays empty rather than becoming a fake zero.
 */
export function forecastSyncHoursForWeek(
  weekStart: string,
  asOfWeek = currentWeek()
): ForecastSyncPersonHours[] {
  const future = weekStart > asOfWeek;
  const wanted = future ? "estimate" : "actual";
  const byPerson = new Map<string, { minutes: number; internal: number }>();
  for (const line of activeForecastSyncAllocations(weekStart)) {
    if (line.source !== wanted) continue;
    if (line.bucket !== "client" && line.bucket !== "internal") continue;
    const person = slugFromSyncPersonId(line.personId);
    if (!person) continue;
    const row = byPerson.get(person) || { minutes: 0, internal: 0 };
    row.minutes += line.minutes;
    if (line.bucket === "internal") row.internal += line.minutes;
    byPerson.set(person, row);
  }

  const out: ForecastSyncPersonHours[] = [];
  for (const [person, row] of byPerson) {
    if (row.minutes <= 0) continue;
    const hours = Number(hoursForMinutes(row.minutes));
    out.push({
      person,
      forecastHours: hours,
      trackedHours: future ? 0 : hours,
      internalHours: Number(hoursForMinutes(row.internal)),
    });
  }
  out.sort((a, b) => a.person.localeCompare(b.person));
  return out;
}

export function forecastSyncHoursForPerson(
  person: string,
  weekStart: string,
  asOfWeek = currentWeek()
): ForecastSyncPersonHours {
  return (
    forecastSyncHoursForWeek(weekStart, asOfWeek).find((row) => row.person === person) || {
      person,
      ...EMPTY_SYNC_HOURS,
    }
  );
}
