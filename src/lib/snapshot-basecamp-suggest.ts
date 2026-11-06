// On-demand Basecamp suggestions for the weekly snapshot editor.
//
// One recordings read for to-dos and one for card-table cards, newest first,
// stopping once a page is older than the Pacific week. A few of those reads
// run at a time. A 429 waits for Retry-After and tries again. Only a finished
// read is cached, and only for a couple of minutes. Refresh skips the cache.
// A missing project or a failed read is a status, not an empty cache entry.
// Nothing here runs at process start.

import {
  basecampConnected,
  basecampGet,
  basecampNextPagePath,
  canonicalBasecampProjectId,
  getBasecampProjectName,
  listProjectSnapshotTodos,
} from "./basecamp";
import { getDb, nowIso } from "./db";
import { nanoid } from "nanoid";
import { getRevClient } from "./revenue";
import { departmentNotesForWeek } from "./snapshot-departments";
import { completedTodoScopeReason } from "./snapshot-completed-todo";
import {
  snapshotHitsForPicker,
  snapshotTodoHit,
  suggestionsForWeek,
  type BasecampActivity,
  type DepartmentSuggestion,
  type SnapshotTodoHit,
} from "./snapshot-basecamp-suggestions";
import {
  activitiesFromRecordings,
  recordingOlderThanWeek,
  type BcRecording,
} from "./snapshot-basecamp-recordings";

const CACHE_MS = 2 * 60 * 1000;
const MAX_RECORDING_PAGES = 8;
const MAX_ATTEMPTS = 4;
const SUGGEST_CONCURRENCY = 3;

const cache = new Map<string, { at: number; activities: BasecampActivity[] }>();
const inflight = new Map<string, Promise<BasecampActivity[]>>();

type SuggestionStatus = "ok" | "no_project" | "error";

export type WeekSuggestionResult = {
  suggestions: DepartmentSuggestion[];
  status: SuggestionStatus;
  message?: string;
};

class SuggestionReadError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Basecamp recordings failed (${status})`);
    this.name = "SuggestionReadError";
    this.status = status;
  }
}

export function clearBasecampSuggestionCache(): void {
  cache.clear();
  inflight.clear();
}

function limitBasecamp<T>(fn: () => Promise<T>): Promise<T> {
  return suggestionLimit(fn);
}

// A queue, not a counter checked after an await. The slot is taken before the
// request starts, so parallel editors cannot all pass the check at once.
function createLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  function pump() {
    while (active < max && queue.length) {
      active += 1;
      const start = queue.shift();
      start?.();
    }
  }
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          active -= 1;
          pump();
        });
      });
      pump();
    });
  };
}

const suggestionLimit = createLimiter(SUGGEST_CONCURRENCY);

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryWaitMs(res: Response, attempt: number): number {
  const raw = res.headers.get("Retry-After");
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10_000);
    const when = Date.parse(raw);
    if (Number.isFinite(when)) return Math.min(Math.max(0, when - Date.now()), 10_000);
  }
  return Math.min(400 * 2 ** attempt, 8_000);
}

function safeError(err: unknown): string {
  const message = err instanceof Error ? err.message : "failed";
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 200);
}

async function basecampGetRetry(path: string): Promise<Response> {
  return limitBasecamp(async () => {
    let last: Response | null = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const res = await basecampGet(path);
      if (res.status !== 429) return res;
      last = res;
      await res.body?.cancel().catch(() => undefined);
      if (attempt === MAX_ATTEMPTS - 1) break;
      await sleep(retryWaitMs(res, attempt));
    }
    return last as Response;
  });
}

function recordingsPath(projectId: string, type: "Todo" | "Kanban::Card"): string {
  const params = new URLSearchParams({
    type,
    bucket: projectId,
    sort: "updated_at",
    direction: "desc",
  });
  return `/projects/recordings.json?${params.toString()}`;
}

/**
 * Newest recordings of one type in a project. Follows Link. Stops at the first
 * row last updated before the Pacific week, so a long history is not paged.
 */
async function listRecordingsSince(
  projectId: string,
  type: "Todo" | "Kanban::Card",
  weekStart: string
): Promise<BcRecording[]> {
  let path: string | null = recordingsPath(projectId, type);
  const out: BcRecording[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_RECORDING_PAGES && path; page++) {
    if (seen.has(path)) throw new SuggestionReadError(0);
    seen.add(path);
    const res = await basecampGetRetry(path);
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new SuggestionReadError(res.status);
    }
    const data: unknown = await res.json().catch(() => null);
    if (!Array.isArray(data)) throw new SuggestionReadError(res.status || 0);
    let reachedOlder = false;
    for (const row of data) {
      if (!row || typeof row !== "object") continue;
      const recording = row as BcRecording;
      const updated = typeof recording.updated_at === "string" ? recording.updated_at : "";
      if (recordingOlderThanWeek(updated, weekStart)) {
        reachedOlder = true;
        break;
      }
      out.push(recording);
    }
    if (reachedOlder || data.length === 0) break;
    path = basecampNextPagePath(res.headers.get("Link"));
  }
  return out;
}

async function fetchActivities(projectId: string, weekStart: string): Promise<BasecampActivity[]> {
  const [todos, cards] = await Promise.all([
    listRecordingsSince(projectId, "Todo", weekStart),
    listRecordingsSince(projectId, "Kanban::Card", weekStart),
  ]);
  const activities = [
    ...activitiesFromRecordings(todos, "todo"),
    ...activitiesFromRecordings(cards, "card"),
  ];
  activities.sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""));
  return activities;
}

async function activitiesForProject(
  projectId: string,
  weekStart: string,
  refresh: boolean
): Promise<BasecampActivity[]> {
  const key = `${projectId}\n${weekStart}`;
  if (!refresh) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.activities;
    const pending = inflight.get(key);
    if (pending) return pending;
  }
  const slot: { current: Promise<BasecampActivity[]> | null } = { current: null };
  const job = fetchActivities(projectId, weekStart).then((activities) => {
    // A slower read must not overwrite a refresh that already finished.
    if (slot.current && inflight.get(key) === slot.current) {
      cache.set(key, { at: Date.now(), activities });
    }
    return activities;
  });
  slot.current = job;
  inflight.set(key, job);
  try {
    return await job;
  } finally {
    if (inflight.get(key) === job) inflight.delete(key);
  }
}

export function dismissedSuggestionKeys(clientId: string, weekStart: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT source_key FROM snapshot_suggestion_dismissals
       WHERE client_id = ? AND week_start = ?`
    )
    .all(clientId, weekStart) as Array<{ source_key: string }>;
  return rows.map((row) => row.source_key);
}

export function dismissWeekSuggestion(input: {
  clientId: string;
  weekStart: string;
  sourceKey: string;
}): void {
  const key = input.sourceKey.trim();
  if (!key) return;
  getDb()
    .prepare(
      `INSERT INTO snapshot_suggestion_dismissals
         (id, client_id, week_start, source_key, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(client_id, week_start, source_key) DO NOTHING`
    )
    .run(nanoid(12), input.clientId, input.weekStart, key, nowIso());
}

function projectIdForClient(clientId: string): string {
  const raw = (getRevClient(clientId)?.basecamp_project_id || "").trim();
  if (!raw) return "";
  return canonicalBasecampProjectId(raw) || raw;
}

function pacificToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Find to-dos in the client's Basecamp project, including work that is not
 * finished yet. Failures are not cached. A 429 is retried like suggestions.
 */
export async function searchClientBasecampTodos(
  clientId: string,
  query: string
): Promise<{ hits: SnapshotTodoHit[]; status: SuggestionStatus; message?: string }> {
  const q = query.trim();
  if (q.length < 2) return { hits: [], status: "ok" };
  const projectId = projectIdForClient(clientId);
  if (!projectId) {
    return { hits: [], status: "no_project", message: "No Basecamp project linked" };
  }
  const params = new URLSearchParams({
    q,
    type: "Todo",
    bucket_id: projectId,
  });
  try {
    const res = await basecampGetRetry(`/search.json?${params.toString()}`);
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new SuggestionReadError(res.status);
    }
    const data: unknown = await res.json().catch(() => null);
    const rows = Array.isArray(data)
      ? data
      : data &&
          typeof data === "object" &&
          Array.isArray((data as { results?: unknown }).results)
        ? (data as { results: unknown[] }).results
        : null;
    if (!rows) throw new SuggestionReadError(res.status || 0);
    const today = pacificToday();
    const hits: SnapshotTodoHit[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const record = row as {
        id?: number | string;
        title?: string;
        type?: string;
        completed?: boolean;
        completed_at?: string | null;
        starts_on?: string | null;
        parent?: { title?: string; name?: string } | null;
        bucket?: { id?: number | string } | null;
      };
      const bucket = String(record.bucket?.id ?? "");
      if (bucket && bucket !== projectId) continue;
      const hit = snapshotTodoHit(record, today);
      if (hit) hits.push(hit);
      if (hits.length >= 20) break;
    }
    return { hits, status: "ok" };
  } catch (err) {
    const status = err instanceof SuggestionReadError ? err.status : undefined;
    console.error("[basecamp] todo search", {
      projectId,
      status,
      error: safeError(err),
    });
    return {
      hits: [],
      status: "error",
      message: "Couldn't reach Basecamp",
    };
  }
}

/**
 * Every to-do in the client's linked Basecamp project, for the add picker.
 * Open rows stay In progress unless a future start date makes them Scheduled.
 * Finished rows are Completed. A missing project or a refused library project
 * is a status, not an empty success.
 */
export async function listClientSnapshotTodos(clientId: string): Promise<{
  todos: SnapshotTodoHit[];
  status: SuggestionStatus;
  message?: string;
}> {
  const projectId = projectIdForClient(clientId);
  if (!projectId) {
    return { todos: [], status: "no_project", message: "No Basecamp project linked" };
  }
  if (!basecampConnected()) {
    return { todos: [], status: "error", message: "Basecamp isn't connected" };
  }
  try {
    const client = getRevClient(clientId);
    const projectName = await getBasecampProjectName(projectId);
    const blocked = completedTodoScopeReason(projectName, client?.name || "");
    if (blocked === "not-client-project") {
      return {
        todos: [],
        status: "error",
        message: "That Basecamp project is a shared library, not this client",
      };
    }
    if (blocked === "project-mismatch") {
      return {
        todos: [],
        status: "error",
        message: "The linked Basecamp project doesn't look like this client",
      };
    }
    const raw = await listProjectSnapshotTodos(projectId);
    return {
      todos: snapshotHitsForPicker(raw, pacificToday()),
      status: "ok",
    };
  } catch (err) {
    console.error("[basecamp] snapshot todos", {
      projectId,
      error: safeError(err),
    });
    return { todos: [], status: "error", message: "Couldn't reach Basecamp" };
  }
}

export async function weekBasecampSuggestions(
  clientId: string,
  weekStart: string,
  opts?: { refresh?: boolean }
): Promise<WeekSuggestionResult> {
  const projectId = projectIdForClient(clientId);
  if (!projectId) {
    return {
      suggestions: [],
      status: "no_project",
      message: "No Basecamp project linked",
    };
  }
  try {
    const activities = await activitiesForProject(projectId, weekStart, Boolean(opts?.refresh));
    const notes = departmentNotesForWeek(clientId, weekStart);
    return {
      suggestions: suggestionsForWeek({
        activities,
        weekStart,
        existingItems: notes.flatMap((note) => note.items.map((item) => item.body)),
        existingSourceKeys: notes.flatMap((note) =>
          note.items.map((item) => item.sourceKey).filter(Boolean)
        ),
        dismissedKeys: dismissedSuggestionKeys(clientId, weekStart),
      }),
      status: "ok",
    };
  } catch (err) {
    const status = err instanceof SuggestionReadError ? err.status : undefined;
    console.error("[basecamp] suggestions", {
      projectId,
      weekStart,
      status,
      error: safeError(err),
    });
    return {
      suggestions: [],
      status: "error",
      message: "Couldn't reach Basecamp",
    };
  }
}
