// Basecamp reads for the manual weekly-snapshot add picker.
//
// The desk does not import to-dos on its own. These helpers run only when
// someone searches or opens the add row. A 429 waits for Retry-After and
// tries again. A missing project or a failed read is a status, not a list.

import {
  basecampConnected,
  basecampGet,
  canonicalBasecampProjectId,
  getBasecampProjectName,
  listProjectSnapshotCards,
  listProjectSnapshotTodos,
} from "./basecamp";
import { getRevClient } from "./revenue";
import { completedTodoScopeReason } from "./snapshot-completed-todo";
import {
  matchSnapshotDepartment,
  snapshotHitsForPicker,
  snapshotTodoHit,
  type SnapshotTodoHit,
} from "./snapshot-basecamp-suggestions";

const MAX_ATTEMPTS = 4;
const SEARCH_CONCURRENCY = 3;

type TodoReadStatus = "ok" | "no_project" | "error";

class TodoReadError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Basecamp todo read failed (${status})`);
    this.name = "TodoReadError";
    this.status = status;
  }
}

function limitBasecamp<T>(fn: () => Promise<T>): Promise<T> {
  return searchLimit(fn);
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

const searchLimit = createLimiter(SEARCH_CONCURRENCY);

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
 * finished yet. Failures are not cached. A 429 is retried.
 */
export async function searchClientBasecampTodos(
  clientId: string,
  query: string
): Promise<{ hits: SnapshotTodoHit[]; status: TodoReadStatus; message?: string }> {
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
      throw new TodoReadError(res.status);
    }
    const data: unknown = await res.json().catch(() => null);
    const rows = Array.isArray(data)
      ? data
      : data &&
          typeof data === "object" &&
          Array.isArray((data as { results?: unknown }).results)
        ? (data as { results: unknown[] }).results
        : null;
    if (!rows) throw new TodoReadError(res.status || 0);
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
    const status = err instanceof TodoReadError ? err.status : undefined;
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
  status: TodoReadStatus;
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
    const today = pacificToday();
    const [raw, cards] = await Promise.all([
      listProjectSnapshotTodos(projectId),
      // Video and SEO deliverables often live on a board (Ecoworkz VIDEOS),
      // not on a to-do list. Other boards stay out of this picker.
      listProjectSnapshotCards(projectId, (title) => {
        const dept = matchSnapshotDepartment({ title: "", place: title });
        return dept === "video" || dept === "seo";
      }),
    ]);
    const todos = snapshotHitsForPicker(
      [
        ...raw.map((row) => ({
          id: row.id,
          title: row.title,
          list: row.list,
          completedAt: row.completedAt,
          startsOn: row.startsOn,
          kind: "todo" as const,
        })),
        ...cards.map((row) => ({
          id: row.id,
          title: row.title,
          list: row.list,
          completedAt: row.completedAt,
          startsOn: row.startsOn,
          kind: "card" as const,
        })),
      ],
      today
    ).filter(
      (hit) =>
        !hit.sourceKey.startsWith("card:") ||
        hit.department === "video" ||
        hit.department === "seo"
    );
    return { todos, status: "ok" };
  } catch (err) {
    console.error("[basecamp] snapshot todos", {
      projectId,
      error: safeError(err),
    });
    return { todos: [], status: "error", message: "Couldn't reach Basecamp" };
  }
}
