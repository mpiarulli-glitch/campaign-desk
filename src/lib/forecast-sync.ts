import { timingSafeEqual } from "crypto";
import { nanoid } from "nanoid";
import { getDb, nowIso } from "./db";
import { PEOPLE } from "./people";

// Mailboxes SEO Ops matches before it sends hours. The id is stable:
// `desk_` plus the forecast slug. People with no mailbox are omitted; a
// guessed address would map the wrong teammate.
const FORECAST_SYNC_EMAIL: Record<string, string> = {
  carlos: "cmorones@marketingempiregroup.com",
  abel: "amiranda@marketingempiregroup.com",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RUN_KEYS = ["runId", "source", "organizationId", "weeks"] as const;
const WEEK_KEYS = ["weekStart", "basis", "allocations"] as const;
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

type ValidAllocation = Omit<ForecastSyncAllocation, "weekStart">;

type ValidWeek = {
  weekStart: string;
  basis: "actual" | "estimate";
  allocations: ValidAllocation[];
};

type ValidRun = {
  runId: string;
  source: "seo-ops-center";
  organizationId: string;
  weeks: ValidWeek[];
};

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
    .prepare(`SELECT slug, email FROM users`)
    .all() as Array<{ slug: string; email: string | null }>;
  const stored = new Map<string, string>();
  for (const row of rows) {
    const email = (row.email || "").trim().toLowerCase();
    if (email) stored.set(row.slug, email);
  }

  const people: ForecastSyncPerson[] = [];
  const seen = new Map<string, number>();
  for (const person of PEOPLE) {
    const email = FORECAST_SYNC_EMAIL[person.slug] || stored.get(person.slug) || "";
    if (!email) continue;
    people.push({ id: forecastSyncPersonId(person.slug), email });
    seen.set(email, (seen.get(email) || 0) + 1);
  }
  return people
    .filter((person) => seen.get(person.email) === 1)
    .sort((a, b) => a.id.localeCompare(b.id));
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

function personByEmail(email: string): ForecastSyncPerson | null {
  return listForecastSyncPeople().find((person) => person.email === email) || null;
}

function validateAllocation(value: unknown, index: string): ValidAllocation | SyncFailure {
  if (!isRecord(value)) return fail(422, "invalid_payload", `${index} must be an object`);
  const extra = unknownKey(value, ALLOC_KEYS);
  if (extra) return fail(422, "invalid_payload", `${index}.${extra} is not allowed`);

  const personEmail = value.personEmail;
  if (typeof personEmail !== "string" || personEmail !== personEmail.trim().toLowerCase() || !EMAIL_RE.test(personEmail)) {
    return fail(422, "invalid_payload", `${index}.personEmail must be a lowercase email`);
  }
  const person = personByEmail(personEmail);
  if (!person) return fail(422, "invalid_payload", `${index}.personEmail is not a forecast person`);

  if (value.campaignDeskPersonId !== person.id) {
    return fail(422, "invalid_payload", `${index}.campaignDeskPersonId does not match personEmail`);
  }

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
    personEmail,
    personId: person.id,
    clientId: bucket === "internal" ? null : (clientId as string).toLowerCase(),
    clientName: value.clientName as string,
    bucket,
    source: value.source,
    minutes: value.minutes,
    hours: value.hours,
  };
}

export function parseForecastRun(runId: string, body: unknown): ValidRun | SyncFailure {
  if (!UUID_RE.test(runId)) return fail(422, "invalid_payload", "runId must be a UUID");
  if (!isRecord(body)) return fail(422, "invalid_payload", "Body must be a JSON object");
  const extra = unknownKey(body, RUN_KEYS);
  if (extra) return fail(422, "invalid_payload", `${extra} is not allowed`);

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

  const weeks: ValidWeek[] = [];
  const seenWeeks = new Set<string>();
  for (let i = 0; i < body.weeks.length; i++) {
    const week = body.weeks[i];
    const at = `weeks[${i}]`;
    if (!isRecord(week)) return fail(422, "invalid_payload", `${at} must be an object`);
    const weekExtra = unknownKey(week, WEEK_KEYS);
    if (weekExtra) return fail(422, "invalid_payload", `${at}.${weekExtra} is not allowed`);
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
    if (!Array.isArray(week.allocations)) {
      return fail(422, "invalid_payload", `${at}.allocations must be an array`);
    }
    const allocations: ValidAllocation[] = [];
    for (let j = 0; j < week.allocations.length; j++) {
      const parsed = validateAllocation(week.allocations[j], `${at}.allocations[${j}]`);
      if ("ok" in parsed && parsed.ok === false) return parsed;
      const line = parsed as ValidAllocation;
      if (line.source !== week.basis) {
        return fail(422, "invalid_payload", `${at}.allocations[${j}].source must match basis`);
      }
      allocations.push(line);
    }
    weeks.push({ weekStart: week.weekStart, basis: week.basis, allocations });
  }

  return {
    runId: runId.toLowerCase(),
    source: "seo-ops-center",
    organizationId: (body.organizationId as string).toLowerCase(),
    weeks,
  };
}

function canonicalJson(run: ValidRun): string {
  return JSON.stringify({
    runId: run.runId,
    source: run.source,
    organizationId: run.organizationId,
    weeks: run.weeks.map((week) => ({
      weekStart: week.weekStart,
      basis: week.basis,
      allocations: week.allocations.map((line) => ({
        personEmail: line.personEmail,
        campaignDeskPersonId: line.personId,
        clientId: line.clientId,
        clientName: line.clientName,
        bucket: line.bucket,
        source: line.source,
        minutes: line.minutes,
        hours: line.hours,
      })),
    })),
  });
}

function isFailure(value: ValidRun | SyncFailure): value is SyncFailure {
  return "ok" in value && value.ok === false;
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
  db.transaction(() => {
    insertRun.run(parsed.runId, parsed.organizationId, canonical, ts);
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
  })();

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

/** Allocations currently in effect for one Monday. Empty means the week is clear. */
export function activeForecastSyncAllocations(weekStart: string): ForecastSyncAllocation[] {
  const db = getDb();
  const owner = db
    .prepare(
      `SELECT w.run_id
         FROM seo_ops_forecast_weeks w
         JOIN seo_ops_forecast_runs r ON r.run_id = w.run_id
        WHERE w.week_start = ? AND r.status = 'accepted'
        ORDER BY r.created_at DESC, r.run_id DESC
        LIMIT 1`
    )
    .get(weekStart) as { run_id: string } | undefined;
  if (!owner) return [];
  const rows = db
    .prepare(
      `SELECT week_start, person_email, person_id, client_id, client_name, bucket, source, minutes, hours
         FROM seo_ops_forecast_allocations
        WHERE run_id = ? AND week_start = ?
        ORDER BY person_email, bucket, client_name, minutes`
    )
    .all(owner.run_id, weekStart) as Array<{
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
