// Basecamp 3 integration: OAuth token storage + refresh, and creating a
// "time to schedule" card in a client's project card table.
//
// Auth is OAuth 2.0 (web server flow). You register an integration at
// https://launchpad.37signals.com/integrations, then connect once from the app
// (the callback stores an access + refresh token in app_settings). Tokens are
// refreshed automatically. Env:
//   BASECAMP_CLIENT_ID, BASECAMP_CLIENT_SECRET, BASECAMP_ACCOUNT_ID

import { getDb, nowIso } from "./db";

const LAUNCHPAD_TOKEN = "https://launchpad.37signals.com/authorization/token";
const LAUNCHPAD_AUTH = "https://launchpad.37signals.com/authorization/new";
const USER_AGENT = "Campaign Desk (Marketing Empire Group)";
// No Basecamp call — token refresh included — runs on a host with a platform
// request deadline, so every fetch needs its own bound or a stalled connection
// hangs forever.
const BC_TIMEOUT_MS = 10_000;

function accountId(): string {
  return process.env.BASECAMP_ACCOUNT_ID || "5338018";
}
function clientId(): string {
  return process.env.BASECAMP_CLIENT_ID || "";
}
function clientSecret(): string {
  return process.env.BASECAMP_CLIENT_SECRET || "";
}
function apiBase(): string {
  return `https://3.basecampapi.com/${accountId()}`;
}

export function basecampConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // ms epoch
}

function getSetting(key: string): string | null {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

function setSetting(key: string, value: string) {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, nowIso());
}

export function getTokens(): Tokens | null {
  const raw = getSetting("basecamp_tokens");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Tokens;
  } catch {
    return null;
  }
}

function saveTokens(access_token: string, refresh_token: string, expiresIn?: number) {
  const ttl = (expiresIn ? expiresIn * 1000 : 14 * 24 * 3600 * 1000) - 60_000;
  saveSetting_tokens({ access_token, refresh_token, expires_at: Date.now() + ttl });
}
function saveSetting_tokens(t: Tokens) {
  setSetting("basecamp_tokens", JSON.stringify(t));
}

export function basecampConnected(): boolean {
  return basecampConfigured() && Boolean(getTokens());
}

export function authorizeUrl(redirectUri: string): string {
  const p = new URLSearchParams({
    type: "web_server",
    client_id: clientId(),
    redirect_uri: redirectUri,
  });
  return `${LAUNCHPAD_AUTH}?${p.toString()}`;
}

// Exchange the OAuth code for tokens (called from the callback route).
export async function exchangeCode(
  code: string,
  redirectUri: string
): Promise<boolean> {
  const p = new URLSearchParams({
    type: "web_server",
    client_id: clientId(),
    client_secret: clientSecret(),
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(`${LAUNCHPAD_TOKEN}?${p.toString()}`, {
    method: "POST",
    signal: AbortSignal.timeout(BC_TIMEOUT_MS),
  });
  if (!res.ok) {
    console.error("[basecamp] token exchange failed", res.status, await res.text().catch(() => ""));
    return false;
  }
  const d = await res.json();
  if (!d.access_token) return false;
  saveTokens(d.access_token, d.refresh_token, d.expires_in);
  return true;
}

// This call had no timeout, which mattered a lot once bc() started firing
// concurrently: every parallel call sees the same expired token and each one
// would independently hang forever on a stalled refresh. inFlight collapses
// concurrent callers onto one request instead of a thundering herd, and the
// timeout guarantees that request itself can't hang.
let refreshInFlight: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefreshTokens().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefreshTokens(): Promise<boolean> {
  const t = getTokens();
  if (!t?.refresh_token) return false;
  const p = new URLSearchParams({
    type: "refresh",
    refresh_token: t.refresh_token,
    client_id: clientId(),
    client_secret: clientSecret(),
  });
  try {
    const res = await fetch(`${LAUNCHPAD_TOKEN}?${p.toString()}`, {
      method: "POST",
      signal: AbortSignal.timeout(BC_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("[basecamp] token refresh failed", res.status);
      return false;
    }
    const d = await res.json();
    if (!d.access_token) return false;
    // Basecamp keeps the same refresh token across refreshes.
    saveTokens(d.access_token, t.refresh_token, d.expires_in);
    return true;
  } catch (err) {
    console.error("[basecamp] token refresh errored", (err as Error).message);
    return false;
  }
}

async function accessToken(): Promise<string | null> {
  let t = getTokens();
  if (!t) return null;
  if (Date.now() >= t.expires_at) {
    if (!(await refreshTokens())) return null;
    t = getTokens();
  }
  return t?.access_token || null;
}

async function bc(path: string, init?: RequestInit): Promise<Response> {
  const tok = await accessToken();
  if (!tok) throw new Error("Basecamp not connected");
  const call = (t: string) =>
    fetch(`${apiBase()}${path}`, {
      ...init,
      signal: AbortSignal.timeout(BC_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${t}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        ...(init?.headers || {}),
      },
    });
  let res = await call(tok);
  if (res.status === 401 && (await refreshTokens())) {
    res = await call(getTokens()!.access_token);
  }
  return res;
}

// Accepts a raw project id or a Basecamp project URL and returns the numeric id.
export function extractProjectId(input: string): string {
  const s = (input || "").trim();
  const m = s.match(/projects\/(\d+)/) || s.match(/\/(\d{6,})/) || s.match(/^(\d{6,})$/);
  return m ? m[1] : s.replace(/[^\d]/g, "");
}

export interface CardResult {
  ok: boolean;
  error?: string;
  url?: string;
  // How many of the requested assignees were actually tagged on the card.
  assigned?: number;
}

export interface CampfireResult {
  ok: boolean;
  error?: string;
  url?: string;
}

export interface BcPerson {
  id: number;
  name: string;
  email_address: string;
  client?: boolean;
  employee?: boolean;
  // Used to @-mention this person inline in rich text content
  // (<bc-attachment sgid="...">). Absent for some system/bot accounts.
  attachable_sgid?: string;
}

// People with access to a project. Used to resolve a POC / account manager
// (given as an email or name) to the Basecamp person id we tag on a card.
export async function getProjectPeople(projectId: string): Promise<BcPerson[]> {
  if (!projectId) return [];
  try {
    const res = await bc(`/projects/${projectId}/people.json`);
    if (!res.ok) return [];
    const arr = await res.json();
    if (!Array.isArray(arr)) return [];
    return arr.map((p) => ({
      id: p.id,
      name: p.name || "",
      email_address: p.email_address || "",
      client: Boolean(p.client),
      employee: Boolean(p.employee),
      attachable_sgid: p.attachable_sgid || undefined,
    }));
  } catch {
    return [];
  }
}

// Rich-text @-mention markup for a person, to embed directly in card content.
export function mentionHtml(person: BcPerson): string {
  return person.attachable_sgid
    ? `<bc-attachment sgid="${person.attachable_sgid}"></bc-attachment>`
    : `@${person.name}`;
}

// Post a rich-text line to a project's Campfire using the app's existing
// Basecamp OAuth connection. Rich text is required for real person mentions.
export async function postProjectCampfireLine(
  projectId: string,
  contentHtml: string
): Promise<CampfireResult> {
  if (!projectId) return { ok: false, error: "No Basecamp project set" };
  try {
    const projectRes = await bc(`/projects/${projectId}.json`);
    if (!projectRes.ok) {
      return { ok: false, error: `project lookup ${projectRes.status}` };
    }
    const project = await projectRes.json();
    const dock: Array<{ id: number; name: string; enabled?: boolean }> =
      project.dock || [];
    const chat = dock.find((tool) => tool.name === "chat" && tool.enabled !== false);
    if (!chat) return { ok: false, error: "no Campfire in this project" };

    const lineRes = await bc(`/chats/${chat.id}/lines.json`, {
      method: "POST",
      body: JSON.stringify({
        content: contentHtml,
        content_type: "text/html",
      }),
    });
    if (!lineRes.ok) {
      return { ok: false, error: `Campfire post ${lineRes.status}` };
    }
    const line = await lineRes.json();
    return { ok: true, url: line.app_url || line.url };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// Resolve free-text identifiers (email or name) to Basecamp person ids within a
// project. An exact email match wins; otherwise an exact name, then a name that
// contains the text. Duplicates and blanks are dropped.
export function matchPeople(people: BcPerson[], identifiers: string[]): number[] {
  const ids: number[] = [];
  for (const raw of identifiers) {
    const q = (raw || "").trim().toLowerCase();
    if (!q) continue;
    const hit =
      people.find((p) => p.email_address.toLowerCase() === q) ||
      people.find((p) => p.name.toLowerCase() === q) ||
      people.find((p) => p.name.toLowerCase().includes(q));
    if (hit && !ids.includes(hit.id)) ids.push(hit.id);
  }
  return ids;
}

/* ------------------------------------------------------------------ todos */

// Basecamp paginates collections at 50 per page and advertises the next page
// in a Link header. Follow it, but cap the walk so one enormous todo list can't
// stall the forecast picker. A timed-out or failed page just ends the walk
// early with whatever was already fetched, rather than throwing — this runs
// inside Promise.all fan-outs where one bad request must not blank out every
// other list's results.
async function bcCollection<T>(path: string, maxPages = 4): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = path;
  for (let page = 0; page < maxPages && next; page++) {
    let res: Response;
    try {
      res = await bc(next);
    } catch {
      break;
    }
    if (!res.ok) break;
    const batch = await res.json();
    if (!Array.isArray(batch)) break;
    out.push(...(batch as T[]));
    const link = res.headers.get("Link") || "";
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    // The header carries an absolute URL; bc() prepends apiBase(), so strip it.
    next = m ? m[1].replace(apiBase(), "") : null;
  }
  return out;
}

export interface BcTodo {
  id: string;
  title: string;
  // Todo list the item lives on, shown as a group heading in the picker.
  list: string;
  assigneeIds: number[];
  dueOn: string | null;
}

interface BcTodoRaw {
  id: number;
  content?: string;
  title?: string;
  due_on?: string | null;
  assignees?: Array<{ id: number }>;
}

// Every open todo in a project, across all its todo lists (including grouped
// lists). Returns [] rather than throwing when the project has no todoset or
// Basecamp is unreachable — the picker degrades to free text.
export async function listProjectTodos(projectId: string): Promise<BcTodo[]> {
  if (!projectId) return [];
  try {
    const pr = await bc(`/projects/${projectId}.json`);
    if (!pr.ok) return [];
    const project = await pr.json();
    const dock: Array<{ id: number; name: string }> = project.dock || [];
    const todoset = dock.find((d) => d.name === "todoset");
    if (!todoset) return [];

    const lists = await bcCollection<{ id: number; title?: string; name?: string }>(
      `/buckets/${projectId}/todosets/${todoset.id}/todolists.json`
    );

    // A grouped todo list holds no todos itself — its groups do. Expand any
    // list that reports groups so grouped work isn't silently missing. Checked
    // for every list concurrently — sequentially this was one round trip per
    // list, which is the main reason the picker used to be slow to load.
    const perListGroups = await Promise.all(
      lists.slice(0, 30).map(async (list) => {
        const title = list.title || list.name || "Todos";
        const groups = await bcCollection<{ id: number; title?: string; name?: string }>(
          `/buckets/${projectId}/todolists/${list.id}/groups.json`,
          1
        );
        return [
          { id: list.id, title },
          ...groups.map((group) => ({
            id: group.id,
            title: `${title} › ${group.title || group.name || ""}`.trim(),
          })),
        ];
      })
    );
    const targets = perListGroups.flat();

    const perList = await Promise.all(
      targets.map(async (target) => {
        // No ?completed param means Basecamp returns only open todos.
        const todos = await bcCollection<BcTodoRaw>(
          `/buckets/${projectId}/todolists/${target.id}/todos.json`,
          2
        );
        return todos.map((t) => ({
          id: String(t.id),
          title: (t.content || t.title || "").trim(),
          list: target.title,
          assigneeIds: (t.assignees || []).map((a) => a.id),
          dueOn: t.due_on || null,
        }));
      })
    );
    return perList.flat().filter((t) => t.title);
  } catch {
    return [];
  }
}

export interface PersonTodosResult {
  todos: BcTodo[];
  // False when the person couldn't be matched to anyone on the project, or
  // matched but has nothing assigned — the caller is looking at every open
  // todo instead and should say so.
  filteredToPerson: boolean;
}

// Open todos in a client's project assigned to one of the given identifiers
// (a name or email). Falls back to every open todo when nothing matches, so
// the picker is never empty just because assignment is inconsistent.
export async function listPersonProjectTodos(
  projectId: string,
  identifiers: string[]
): Promise<PersonTodosResult> {
  // Neither call depends on the other's result, so run them together instead
  // of paying for both round trips back to back.
  const [todos, people] = await Promise.all([
    listProjectTodos(projectId),
    getProjectPeople(projectId),
  ]);
  if (!todos.length) return { todos, filteredToPerson: false };
  const ids = matchPeople(people, identifiers);
  if (!ids.length) return { todos, filteredToPerson: false };
  const mine = todos.filter((t) => t.assigneeIds.some((id) => ids.includes(id)));
  if (!mine.length) return { todos, filteredToPerson: false };
  return { todos: mine, filteredToPerson: true };
}

// Mark a todo complete. Basecamp answers 204 on success and 404 if the todo is
// already completed or gone, which we treat as success — the desired end state
// holds either way.
export async function completeTodo(
  projectId: string,
  todoId: string
): Promise<{ ok: boolean; error?: string }> {
  if (!projectId || !todoId) return { ok: false, error: "missing project or todo id" };
  try {
    const res = await bc(`/buckets/${projectId}/todos/${todoId}/completion.json`, {
      method: "POST",
    });
    if (res.ok || res.status === 404) return { ok: true };
    return { ok: false, error: `completion ${res.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// Reopen a todo, so unchecking a forecast task doesn't leave Basecamp out of sync.
export async function uncompleteTodo(
  projectId: string,
  todoId: string
): Promise<{ ok: boolean; error?: string }> {
  if (!projectId || !todoId) return { ok: false, error: "missing project or todo id" };
  try {
    const res = await bc(`/buckets/${projectId}/todos/${todoId}/completion.json`, {
      method: "DELETE",
    });
    if (res.ok || res.status === 404) return { ok: true };
    return { ok: false, error: `completion ${res.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// Create a card in the project's card table, in the "In progress" column
// (falls back to the first column if none matches). If assigneeIds are given,
// the card is assigned to those people via a follow-up update (the create
// endpoint does not accept assignees).
export async function createScheduleCard(
  projectId: string,
  title: string,
  contentHtml: string,
  assigneeIds?: number[],
  dueOn?: string // YYYY-MM-DD
): Promise<CardResult> {
  if (!projectId) return { ok: false, error: "No Basecamp project set" };
  try {
    const pr = await bc(`/projects/${projectId}.json`);
    if (!pr.ok) return { ok: false, error: `project lookup ${pr.status}` };
    const project = await pr.json();
    const dock: Array<{ id: number; name: string }> = project.dock || [];
    const ct = dock.find((d) => d.name === "kanban_board");
    if (!ct) return { ok: false, error: "no card table in this project" };

    const tableRes = await bc(`/buckets/${projectId}/card_tables/${ct.id}.json`);
    if (!tableRes.ok) return { ok: false, error: `card table ${tableRes.status}` };
    const table = await tableRes.json();
    const lists: Array<{ id: number; title: string }> = table.lists || [];
    const col =
      lists.find((l) => /in\s*progress/i.test(l.title || "")) || lists[0];
    if (!col) return { ok: false, error: "no columns in card table" };

    const cardRes = await bc(
      `/buckets/${projectId}/card_tables/lists/${col.id}/cards.json`,
      { method: "POST", body: JSON.stringify({ title, content: contentHtml }) }
    );
    if (!cardRes.ok) return { ok: false, error: `create card ${cardRes.status}` };
    const card = await cardRes.json();

    let assigned = 0;
    if (card.id && ((assigneeIds && assigneeIds.length) || dueOn)) {
      const patch: Record<string, unknown> = {};
      if (assigneeIds && assigneeIds.length) patch.assignee_ids = assigneeIds;
      if (dueOn) patch.due_on = dueOn;
      const upd = await bc(`/buckets/${projectId}/card_tables/cards/${card.id}.json`, {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      if (upd.ok && assigneeIds) assigned = assigneeIds.length;
    }
    return { ok: true, url: card.app_url || card.url, assigned };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export interface ApprovalDeliveryResult {
  ok: boolean;
  error?: string;
  cardId?: string;
  cardUrl?: string;
  recipientName?: string;
  created?: boolean;
}

interface BcCard {
  id: number;
  title: string;
  app_url?: string;
  url?: string;
  assignees?: Array<{ id: number }>;
  parent?: { id: number; type?: string };
}

function normalizedLabel(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Client approvals always belong on the project's Deliverables card table.
// Projects carry several boards (videos, Empire Blueprint, Proof, Inbound and
// so on), so match the Deliverables board by title rather than taking whichever
// board happens to sit first in the dock. Live titles are "Deliverables",
// "Approvals / Deliverables" and "DELIVERABLES ", so normalize before matching.
// "Deliverable Templates" is the snapshot source board and is never a target.
export function findDeliverablesTables(
  dock: Array<{ id: number; name: string; title?: string; enabled?: boolean }>
): Array<{ id: number; title: string }> {
  return dock
    .filter((entry) => entry.name === "kanban_board" && entry.enabled !== false)
    .map((entry) => ({
      table: { id: entry.id, title: entry.title || "" },
      label: normalizedLabel(entry.title || ""),
    }))
    .filter(
      (entry) =>
        entry.label.includes("deliverable") && !entry.label.includes("template")
    )
    .map((entry) => {
      // Prefer a plain "Deliverables" board over a combined title if a project
      // somehow has both.
      const rank =
        entry.label === "deliverables" || entry.label === "deliverable" ? 0 : 1;
      return { table: entry.table, rank };
    })
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.table);
}

function findNeedsApprovalColumn(
  lists: Array<{ id: number; title: string }>
): { id: number; title: string } | undefined {
  return lists.find((list) => {
    const label = normalizedLabel(list.title);
    return (
      label === "needs approval" ||
      (label.includes("needs") && label.includes("approval"))
    );
  });
}

// Send the approved client-review message to the client's Deliverables card
// table. The first send creates a card directly in Needs Approval. Later sends
// reuse that card, move it back to Needs Approval, and add the message as a
// comment. The client POC is assigned before a comment is posted so Basecamp
// routes the notification to the right person.
export async function sendApprovalToDeliverables(input: {
  projectId: string;
  campaignTitle: string;
  contentHtml: string;
  recipientIdentifiers: string[];
  existingCardId?: string | null;
}): Promise<ApprovalDeliveryResult> {
  if (!input.projectId) {
    return { ok: false, error: "No Basecamp project set for this client." };
  }

  try {
    const projectRes = await bc(`/projects/${input.projectId}.json`);
    if (!projectRes.ok) {
      return { ok: false, error: `Basecamp project lookup failed (${projectRes.status}).` };
    }
    const project = await projectRes.json();
    const dock: Array<{
      id: number;
      name: string;
      title?: string;
      enabled?: boolean;
    }> = project.dock || [];
    const candidates = findDeliverablesTables(dock);
    if (!candidates.length) {
      return {
        ok: false,
        error:
          "This Basecamp project has no Deliverables card table. Client approvals only post there.",
      };
    }

    let needsApproval: { id: number; title: string } | undefined;
    let tableColumnIds: number[] = [];
    const checked: string[] = [];
    let lastStatus = 0;
    for (const candidate of candidates) {
      const tableRes = await bc(`/card_tables/${candidate.id}.json`);
      if (!tableRes.ok) {
        lastStatus = tableRes.status;
        continue;
      }
      const table = await tableRes.json();
      const lists: Array<{ id: number; title: string }> = table.lists || [];
      const label = candidate.title.trim() || `table ${candidate.id}`;
      checked.push(label);
      needsApproval = findNeedsApprovalColumn(lists);
      if (needsApproval) {
        tableColumnIds = lists.map((list) => list.id);
        break;
      }
    }

    if (!needsApproval) {
      if (!checked.length) {
        return {
          ok: false,
          error: `Deliverables card table lookup failed (${lastStatus || "not readable"}).`,
        };
      }
      return {
        ok: false,
        error: `The ${checked.join(" and ")} card table has no Needs Approval column.`,
      };
    }

    const people = await getProjectPeople(input.projectId);
    const matchedIds = matchPeople(people, input.recipientIdentifiers);
    const recipient = people.find((person) => person.id === matchedIds[0]);
    if (!recipient) {
      return {
        ok: false,
        error:
          "Could not match this account's contact or POC to a person in the Basecamp project.",
      };
    }

    let card: BcCard | null = null;
    if (input.existingCardId) {
      const cardRes = await bc(`/card_tables/cards/${input.existingCardId}.json`);
      if (cardRes.ok) {
        card = (await cardRes.json()) as BcCard;
        // Earlier sends could land a card on the wrong board, and Basecamp
        // cannot move a card between card tables. If the stored card is not in
        // this Deliverables table, abandon it and create a fresh card.
        const parentId = card?.parent?.id;
        if (parentId && !tableColumnIds.includes(parentId)) {
          card = null;
        }
      } else if (cardRes.status !== 404) {
        return {
          ok: false,
          error: `Existing Deliverables card lookup failed (${cardRes.status}).`,
        };
      }
    }

    if (card) {
      const moveRes = await bc(`/card_tables/cards/${card.id}/moves.json`, {
        method: "POST",
        body: JSON.stringify({ column_id: needsApproval.id, position: 1 }),
      });
      if (!moveRes.ok) {
        return { ok: false, error: `Could not move the card (${moveRes.status}).` };
      }

      const assigneeIds = Array.from(
        new Set([...(card.assignees || []).map((person) => person.id), recipient.id])
      );
      const assignRes = await bc(`/card_tables/cards/${card.id}.json`, {
        method: "PUT",
        body: JSON.stringify({ assignee_ids: assigneeIds }),
      });
      if (!assignRes.ok) {
        return {
          ok: false,
          error: `The card moved, but the client contact could not be assigned (${assignRes.status}).`,
          cardId: String(card.id),
          cardUrl: card.app_url || card.url,
          recipientName: recipient.name,
        };
      }

      const commentRes = await bc(`/recordings/${card.id}/comments.json`, {
        method: "POST",
        body: JSON.stringify({ content: input.contentHtml }),
      });
      if (!commentRes.ok) {
        return {
          ok: false,
          error: `The card moved, but the approval message could not be posted (${commentRes.status}).`,
          cardId: String(card.id),
          cardUrl: card.app_url || card.url,
          recipientName: recipient.name,
        };
      }

      return {
        ok: true,
        cardId: String(card.id),
        cardUrl: card.app_url || card.url,
        recipientName: recipient.name,
        created: false,
      };
    }

    const createRes = await bc(`/card_tables/lists/${needsApproval.id}/cards.json`, {
      method: "POST",
      body: JSON.stringify({
        title: input.campaignTitle,
        content: input.contentHtml,
        notify: true,
      }),
    });
    if (!createRes.ok) {
      return { ok: false, error: `Could not create the approval card (${createRes.status}).` };
    }
    const created = (await createRes.json()) as BcCard;

    const assignRes = await bc(`/card_tables/cards/${created.id}.json`, {
      method: "PUT",
      body: JSON.stringify({ assignee_ids: [recipient.id] }),
    });
    if (!assignRes.ok) {
      return {
        ok: false,
        error: `The card was created, but the client contact could not be assigned (${assignRes.status}).`,
        cardId: String(created.id),
        cardUrl: created.app_url || created.url,
        recipientName: recipient.name,
      };
    }

    return {
      ok: true,
      cardId: String(created.id),
      cardUrl: created.app_url || created.url,
      recipientName: recipient.name,
      created: true,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// All projects (buckets) in the account, paged. Used to auto-match clients to
// their Basecamp project by name.
export async function listProjects(): Promise<Array<{ id: number; name: string }>> {
  const out: Array<{ id: number; name: string }> = [];
  for (let page = 1; page <= 30; page++) {
    const res = await bc(`/projects.json?page=${page}`);
    if (!res.ok) break;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) break;
    for (const p of arr) out.push({ id: p.id, name: p.name });
    if (arr.length < 15) break;
  }
  return out;
}

export function disconnectBasecamp() {
  getDb().prepare(`DELETE FROM app_settings WHERE key = ?`).run("basecamp_tokens");
}
