// Basecamp 3 integration: OAuth token storage + refresh, and creating a
// "time to schedule" card in a client's project card table.
//
// Auth is OAuth 2.0 (web server flow). You register an integration at
// https://launchpad.37signals.com/integrations, then connect once from the app
// (the callback stores an access + refresh token in app_settings). Tokens are
// refreshed automatically. Env:
//   BASECAMP_CLIENT_ID, BASECAMP_CLIENT_SECRET, BASECAMP_ACCOUNT_ID

import { getDb, nowIso } from "./db";
import {
  SERVICE,
  asPerson,
  forcePersonRefresh,
  hasConnection,
  personAccessToken,
  type BcIdentity,
} from "./basecamp-identity";
import { whoAmI } from "./basecamp-oauth";

// Re-exported so callers get the identity vocabulary from the same module they
// already import the API functions from.
export { SERVICE, asPerson, hasConnection, type BcIdentity };

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

/**
 * Who the shared service connection belongs to in Basecamp.
 *
 * Worth recording and showing, because the whole point of the service identity
 * is that it is NOT a real team member. Anything it does is attributed to
 * whichever Basecamp login authorized it, so "connected" on its own is not
 * enough to know whether reminders are posting as the mascot account or as
 * somebody's personal login.
 */
export interface ServiceIdentity {
  id: number;
  name: string;
  email: string;
  connectedAt: string;
}

export function getServiceIdentity(): ServiceIdentity | null {
  const raw = getSetting("basecamp_service_identity");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ServiceIdentity;
  } catch {
    return null;
  }
}

function saveServiceIdentity(id: ServiceIdentity): void {
  setSetting("basecamp_service_identity", JSON.stringify(id));
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

  // Record whose login this is, so the dashboard can say "posting as Rocky"
  // rather than just "connected". Best effort: a failure here costs a label,
  // not the connection, so it must not fail the exchange.
  const me = await whoAmI(d.access_token);
  if (me?.id) {
    saveServiceIdentity({
      id: me.id,
      name: me.name,
      email: me.email,
      connectedAt: nowIso(),
    });
  }
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

/**
 * A Basecamp API request, made as somebody.
 *
 * `identity` defaults to the service connection, which is what every
 * system-initiated call wants and what every existing call site already meant.
 * Pass asPerson(slug) for anything a human did, so Basecamp attributes it to
 * them: completing a todo, logging an hour, reading their own assignments.
 *
 * A person identity with no working connection throws BasecampNotConnectedError
 * rather than quietly falling back. Callers decide what that means — reads
 * generally retry as the service, writes refuse — and that decision has to be
 * theirs, because a silent fallback on a write is the misattribution this whole
 * mechanism exists to prevent.
 */
async function bc(
  path: string,
  init?: RequestInit,
  identity: BcIdentity = SERVICE
): Promise<Response> {
  const tok =
    identity.kind === "service"
      ? await accessToken()
      : await personAccessToken(identity.slug);
  if (!tok) {
    if (identity.kind === "person") {
      throw new BasecampNotConnectedError(identity.slug);
    }
    throw new Error("Basecamp not connected");
  }
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
  // A 401 before the recorded expiry means the token was revoked in Basecamp, so
  // one forced refresh is worth trying before giving up.
  if (res.status === 401) {
    const fresh =
      identity.kind === "service"
        ? (await refreshTokens()) && getTokens()?.access_token
        : await forcePersonRefresh(identity.slug);
    if (fresh) res = await call(fresh);
  }
  return res;
}

// Thrown when a request was meant to act as a specific person who has not
// connected their Basecamp account. Carries the slug so the caller can name them.
export class BasecampNotConnectedError extends Error {
  readonly person: string;
  constructor(person: string) {
    super(`${person} has not connected their Basecamp account`);
    this.name = "BasecampNotConnectedError";
    this.person = person;
  }
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
  // The card's Basecamp recording id. Kept so later follow-ups can comment on
  // the same card instead of creating a duplicate.
  cardId?: string;
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

// People with access to a project. Used to resolve a contact / account manager
// (given as an email or name) to the Basecamp person id we tag on a card.
export async function getProjectPeople(
  projectId: string,
  identity: BcIdentity = SERVICE
): Promise<BcPerson[]> {
  if (!projectId) return [];
  try {
    const res = await bc(`/projects/${projectId}/people.json`, undefined, identity);
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

// Project members, enriched with the email address and mention token that the
// project endpoint does not return.
//
// /projects/{id}/people.json gives names and ids but no email_address and no
// attachable_sgid, which is why matching a client by email always failed and why
// mentions silently degraded to plain text. /circles/people.json ("pingable")
// carries both for the whole account, so the two are merged: membership comes
// from the project, contact details from pingable.
export async function getProjectPeopleForMention(
  projectId: string,
  identity: BcIdentity = SERVICE
): Promise<BcPerson[]> {
  const members = await getProjectPeople(projectId, identity);
  if (!members.length) return members;
  try {
    const res = await bc(`/circles/people.json`, undefined, identity);
    if (!res.ok) return members;
    const all = await res.json();
    if (!Array.isArray(all)) return members;
    const byId = new Map<number, { email_address?: string; attachable_sgid?: string }>();
    for (const person of all) {
      if (person?.id) {
        byId.set(person.id, {
          email_address: person.email_address || "",
          attachable_sgid: person.attachable_sgid || undefined,
        });
      }
    }
    return members.map((member) => {
      const extra = byId.get(member.id);
      return extra
        ? {
            ...member,
            email_address: member.email_address || extra.email_address || "",
            attachable_sgid: member.attachable_sgid || extra.attachable_sgid,
          }
        : member;
    });
  } catch {
    // Enrichment is best effort. Falling back to the plain roster keeps the card
    // going out, just without an email match or a real mention.
    return members;
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
// The client contact on a project, resolved strictly.
//
// Deliberately no substring matching. A client contact called "Michael" would
// otherwise match whichever "Michael" sits first in the project roster, which on
// a live project is as likely to be one of our own people as the client. Email
// is tried first because it is unambiguous; a name has to match exactly, or open
// the Basecamp name unambiguously under the rules below.
//
// Returns null rather than a wrong person. A card with no assignee is a small
// problem; a card assigning the client's work to our own staff, or tagging the
// wrong human, is a bigger one.
//
// One loosening: a recorded name of two or more words that opens a person's
// Basecamp name resolves, as long as that person is not one of our own and is
// the only one it fits. Krak Boba Temecula holds "Debbie/luis" while Basecamp
// has "Debbie/Luis Mares", so the card went out tagging nobody. A lone first
// name is still refused, because "Michael" fits a client and one of ours
// equally well.
function nameTokens(value: string): string[] {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function openingTokensMatch(recorded: string[], full: string[]): boolean {
  if (recorded.length > full.length) return false;
  return recorded.every((token, i) => full[i] === token);
}

export function findClientContact(
  people: BcPerson[],
  contactEmail: string,
  contactName: string
): BcPerson | null {
  const email = (contactEmail || "").trim().toLowerCase();
  if (email) {
    const byEmail = people.find(
      (person) => person.email_address.toLowerCase() === email
    );
    if (byEmail) return byEmail;
  }
  const name = (contactName || "").trim().toLowerCase();
  if (name) {
    const exact = people.find((person) => person.name.toLowerCase() === name);
    if (exact) return exact;
  }
  const recorded = nameTokens(name);
  if (recorded.length >= 2) {
    const opens = people.filter(
      (person) =>
        person.employee !== true &&
        openingTokensMatch(recorded, nameTokens(person.name))
    );
    if (opens.length === 1) return opens[0];
  }
  return null;
}

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
async function bcCollection<T>(
  path: string,
  maxPages = 4,
  identity: BcIdentity = SERVICE
): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = path;
  for (let page = 0; page < maxPages && next; page++) {
    let res: Response;
    try {
      res = await bc(next, undefined, identity);
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
  // Whether this todo is assigned to the person viewing the picker. Set by
  // listPersonProjectTodos, which knows who's asking.
  assigned?: boolean;
}

interface BcTodoRaw {
  id: number;
  content?: string;
  title?: string;
  due_on?: string | null;
  assignees?: Array<{ id: number }>;
}

// How many todo lists (across every todoset) one project will be walked for.
// Bounded so a project with an unusual number of lists can't fan out without
// limit, but high enough to cover several todosets' worth.
const MAX_TODO_LISTS = 60;

// Every open todo in a project, across every todoset and todo list (including
// grouped lists). Returns [] rather than throwing when the project has no
// todoset or Basecamp is unreachable — the picker degrades to free text.
export async function listProjectTodos(
  projectId: string,
  identity: BcIdentity = SERVICE
): Promise<BcTodo[]> {
  if (!projectId) return [];
  try {
    const pr = await bc(`/projects/${projectId}.json`, undefined, identity);
    if (!pr.ok) return [];
    const project = await pr.json();
    const dock: Array<{ id: number; name: string; title?: string; enabled?: boolean }> =
      project.dock || [];

    // A project carries SEVERAL todosets, each its own page in Basecamp — these
    // projects run an "Onboarding Checklist", a "To Dos" and a "Cross Department
    // Checklist". Taking only the first (dock.find) meant the picker showed
    // onboarding work and silently hid everything else.
    const todosets = dock.filter((d) => d.name === "todoset" && d.enabled !== false);
    if (!todosets.length) return [];

    const listsPerSet = await Promise.all(
      todosets.map(async (set) => {
        const lists = await bcCollection<{ id: number; title?: string; name?: string }>(
          `/buckets/${projectId}/todosets/${set.id}/todolists.json`,
          4,
          identity
        );
        // Carry the todoset's own name so the picker can distinguish an
        // onboarding list from a same-named regular one.
        return lists.map((l) => ({ ...l, setTitle: set.title || "Todos" }));
      })
    );
    const lists = listsPerSet.flat();

    // A grouped todo list holds no todos itself — its groups do. Expand any
    // list that reports groups so grouped work isn't silently missing. Checked
    // for every list concurrently — sequentially this was one round trip per
    // list, which is the main reason the picker used to be slow to load.
    const perListGroups = await Promise.all(
      lists.slice(0, MAX_TODO_LISTS).map(async (list) => {
        const listName = list.title || list.name || "Todos";
        const title = `${list.setTitle} › ${listName}`;
        const groups = await bcCollection<{ id: number; title?: string; name?: string }>(
          `/buckets/${projectId}/todolists/${list.id}/groups.json`,
          1,
          identity
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
          2,
          identity
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
  // Every open todo in the project, with the person's own flagged via
  // `assigned`. Callers surface the assigned ones first rather than hiding
  // the rest.
  todos: BcTodo[];
  assignedCount: number;
}

// Every open todo in a client's project, with the ones assigned to the given
// identifiers (a name or email) flagged.
//
// This deliberately does NOT filter down to the person's assigned todos.
// Assignment is barely used in these projects in practice — 12 Volt Power has
// 42 open todos across 8 lists with exactly 1 assigned — so filtering made the
// picker look broken, showing a single list's worth of work and hiding the
// rest. Flagging instead keeps everything pickable while still putting your own
// work at the top.
/**
 * Open todos in a project, flagged with whether they're assigned to this person.
 *
 * `opts.identity` decides whose token does the reading, and it should be the
 * person themselves. That matters for more than attribution: Basecamp only
 * returns what that login can see, so reading as somebody else can show a
 * person projects they have no access to. It also makes "assigned to me" an id
 * comparison instead of guesswork against their name.
 */
export async function listPersonProjectTodos(
  projectId: string,
  identifiers: string[],
  opts?: { bcPersonId?: number; identity?: BcIdentity }
): Promise<PersonTodosResult> {
  const identity = opts?.identity || SERVICE;

  // With a personal connection the caller knows this person's Basecamp id
  // exactly, so "assigned to me" is a comparison rather than a name match, and
  // the project-people round trip is not needed at all.
  if (opts?.bcPersonId) {
    const todos = await listProjectTodos(projectId, identity);
    if (!todos.length) return { todos, assignedCount: 0 };
    let assignedCount = 0;
    const flagged = todos.map((t) => {
      const assigned = t.assigneeIds.includes(opts.bcPersonId!);
      if (assigned) assignedCount++;
      return { ...t, assigned };
    });
    return { todos: flagged, assignedCount };
  }

  // Neither call depends on the other's result, so run them together instead
  // of paying for both round trips back to back.
  const [todos, people] = await Promise.all([
    listProjectTodos(projectId, identity),
    getProjectPeople(projectId, identity),
  ]);
  if (!todos.length) return { todos, assignedCount: 0 };
  const ids = matchPeople(people, identifiers);
  let assignedCount = 0;
  const flagged = todos.map((t) => {
    const assigned = ids.length > 0 && t.assigneeIds.some((id) => ids.includes(id));
    if (assigned) assignedCount++;
    return { ...t, assigned };
  });
  return { todos: flagged, assignedCount };
}

/* ------------------------------------------------------------ schedule feed */

export interface BcScheduleEntry {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  participants: string[];
  appUrl: string;
}

/**
 * Every active schedule entry in the account, across all projects.
 *
 * One recordings sweep rather than a call per project: there are ~60 projects
 * but the recordings endpoint returns them together. It still pages at 15, so
 * this is ~95 requests for a full account and belongs in a background sync, not
 * a request path. maxPages caps a runaway.
 */
export async function listAllScheduleEntries(maxPages = 140): Promise<BcScheduleEntry[]> {
  const raw = await bcCollection<{
    id: number;
    title?: string;
    summary?: string;
    starts_at?: string;
    ends_at?: string;
    all_day?: boolean;
    app_url?: string;
    bucket?: { id: number; name?: string };
    participants?: Array<{ name?: string }>;
  }>(`/projects/recordings.json?type=Schedule::Entry&status=active`, maxPages);

  return raw
    .map((e) => ({
      id: String(e.id),
      title: (e.summary || e.title || "").trim(),
      projectId: String(e.bucket?.id || ""),
      projectName: e.bucket?.name || "",
      startsAt: e.starts_at || "",
      endsAt: e.ends_at || "",
      allDay: Boolean(e.all_day),
      participants: (e.participants || []).map((p) => p.name || "").filter(Boolean),
      appUrl: e.app_url || "",
    }))
    .filter((e) => e.title && e.startsAt);
}

/* -------------------------------------------------------------- timesheets */

export interface TimeEntryResult {
  ok: boolean;
  error?: string;
  entryId?: string;
  appUrl?: string;
}

/**
 * Log time against a Basecamp todo's timesheet.
 *
 * Note the path shape: timesheet entries hang off /recordings/{id}, NOT
 * /buckets/{project}/... like most todo endpoints. The recording can be any
 * "timesheetable" thing (todo, card, message, document), so passing the todo id
 * attaches the hours directly to that todo.
 *
 * Because it is recording-scoped, a schedule entry (a meeting) takes hours the
 * same way a todo does, and with no bucket id in the path an internal MEG event
 * works exactly like a client one. That's what lets Forecast log a meeting's
 * time to its Basecamp project without a todo existing for it.
 *
 * @param recordingId  Basecamp recording id: a todo, or a schedule entry
 * @param date         YYYY-MM-DD the work happened on
 * @param hours        decimal hours, e.g. 1.5
 */
export async function createTimeEntry(
  recordingId: string,
  input: { date: string; hours: number; description?: string },
  identity: BcIdentity = SERVICE
): Promise<TimeEntryResult> {
  if (!recordingId) return { ok: false, error: "missing recording id" };
  if (!(input.hours > 0)) return { ok: false, error: "hours must be greater than 0" };
  try {
    const res = await bc(`/recordings/${recordingId}/timesheet/entries.json`, {
      method: "POST",
      body: JSON.stringify({
        date: input.date,
        // Basecamp accepts a decimal string ("1.5") or "H:MM".
        hours: String(input.hours),
        description: (input.description || "").trim(),
      }),
    }, identity);
    if (!res.ok) return { ok: false, error: `timesheet ${res.status}` };
    const entry = await res.json();
    return { ok: true, entryId: String(entry.id), appUrl: entry.app_url };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// Mark a todo complete. Basecamp answers 204 on success and 404 if the todo is
// already completed or gone, which we treat as success — the desired end state
// holds either way.
export async function completeTodo(
  projectId: string,
  todoId: string,
  identity: BcIdentity = SERVICE
): Promise<{ ok: boolean; error?: string }> {
  if (!projectId || !todoId) return { ok: false, error: "missing project or todo id" };
  try {
    const res = await bc(`/buckets/${projectId}/todos/${todoId}/completion.json`, {
      method: "POST",
    }, identity);
    if (res.ok || res.status === 404) return { ok: true };
    return { ok: false, error: `completion ${res.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// Reopen a todo, so unchecking a forecast task doesn't leave Basecamp out of sync.
export async function uncompleteTodo(
  projectId: string,
  todoId: string,
  identity: BcIdentity = SERVICE
): Promise<{ ok: boolean; error?: string }> {
  if (!projectId || !todoId) return { ok: false, error: "missing project or todo id" };
  try {
    const res = await bc(`/buckets/${projectId}/todos/${todoId}/completion.json`, {
      method: "DELETE",
    }, identity);
    if (res.ok || res.status === 404) return { ok: true };
    return { ok: false, error: `completion ${res.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// Name of the todo list Forecast creates its own shadow todos in, for tasks
// someone typed by hand instead of picking an existing Basecamp todo. Kept in
// one list per project rather than scattered across whichever list happened
// to be open, so it's obvious in Basecamp what these entries are for.
const FORECAST_TODOLIST_NAME = "Forecast";

// Find the "Forecast" todo list in a project's first enabled todoset,
// creating it if it doesn't exist yet. Returns null if the project has no
// todoset at all (Basecamp projects can have that tool disabled).
async function getOrCreateForecastTodolist(
  projectId: string,
  identity: BcIdentity
): Promise<string | null> {
  const pr = await bc(`/projects/${projectId}.json`, undefined, identity);
  if (!pr.ok) return null;
  const project = await pr.json();
  const dock: Array<{ id: number; name: string; enabled?: boolean }> = project.dock || [];
  const todoset = dock.find((d) => d.name === "todoset" && d.enabled !== false);
  if (!todoset) return null;

  const lists = await bcCollection<{ id: number; title?: string; name?: string }>(
    `/buckets/${projectId}/todosets/${todoset.id}/todolists.json`,
    4,
    identity
  );
  const existing = lists.find(
    (l) => (l.title || l.name || "").trim().toLowerCase() === FORECAST_TODOLIST_NAME.toLowerCase()
  );
  if (existing) return String(existing.id);

  const created = await bc(
    `/buckets/${projectId}/todosets/${todoset.id}/todolists.json`,
    {
      method: "POST",
      body: JSON.stringify({
        name: FORECAST_TODOLIST_NAME,
        description: "Auto-created by Campaign Desk to hold time-tracking entries for forecast tasks typed by hand.",
      }),
    },
    identity
  );
  if (!created.ok) return null;
  const list = await created.json();
  return list.id ? String(list.id) : null;
}

// Create a shadow Basecamp todo for a forecast task that was typed by hand
// rather than picked from an existing todo, so there's a real recording to
// attach a timesheet entry to. Lives in the project's "Forecast" list (see
// above), created lazily the first time someone logs time on a manual task.
export async function ensureForecastTodo(
  projectId: string,
  content: string,
  identity: BcIdentity = SERVICE
): Promise<{ id: string; appUrl?: string } | null> {
  if (!projectId || !content.trim()) return null;
  try {
    const listId = await getOrCreateForecastTodolist(projectId, identity);
    if (!listId) return null;
    const res = await bc(
      `/buckets/${projectId}/todolists/${listId}/todos.json`,
      { method: "POST", body: JSON.stringify({ content: content.trim().slice(0, 999) }) },
      identity
    );
    if (!res.ok) return null;
    const todo = await res.json();
    if (!todo.id) return null;
    return { id: String(todo.id), appUrl: todo.app_url };
  } catch {
    return null;
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
    const dock: Array<{
      id: number;
      name: string;
      title?: string;
      enabled?: boolean;
    }> = project.dock || [];
    // Client projects carry several card tables, typically VIDEOS, Deliverables
    // and Deliverable Templates. Taking the first kanban_board landed scheduling
    // cards in VIDEOS. Reuse the same Deliverables lookup the approval flow
    // uses, which prefers a plain "Deliverables" board and never matches
    // "Deliverable Templates". Fall back to the first board only when a project
    // has no Deliverables table at all.
    const ct =
      findDeliverablesTables(dock)[0] ||
      dock.find((d) => d.name === "kanban_board" && d.enabled !== false);
    if (!ct) return { ok: false, error: "no card table in this project" };

    const tableRes = await bc(`/buckets/${projectId}/card_tables/${ct.id}.json`);
    if (!tableRes.ok) return { ok: false, error: `card table ${tableRes.status}` };
    const table = await tableRes.json();
    const lists: Array<{ id: number; title: string }> = table.lists || [];
    // Needs Approval: a scheduling card is waiting on the client to pick a day,
    // not work in progress on our side. Falls back to In Progress, then to the
    // first column, for a project whose board is laid out differently.
    const byLabel = (want: string) =>
      lists.find((l) => normalizedLabel(l.title || "") === want);
    const col =
      byLabel("needs approval") || byLabel("in progress") || lists[0];
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
    return {
      ok: true,
      url: card.app_url || card.url,
      cardId: card.id ? String(card.id) : undefined,
      assigned,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// Adds a comment to an existing card. Basecamp comments are flat and attach to
// the parent recording, so the card id is all that's needed. Used for the
// production scheduling follow-ups, which nudge the same card rather than
// filling the board with duplicates.
export async function commentOnCard(
  projectId: string,
  cardId: string,
  contentHtml: string
): Promise<CampfireResult> {
  if (!projectId || !cardId) {
    return { ok: false, error: "No Basecamp card to follow up on" };
  }
  try {
    const res = await bc(`/buckets/${projectId}/recordings/${cardId}/comments.json`, {
      method: "POST",
      body: JSON.stringify({ content: contentHtml }),
    });
    if (!res.ok) return { ok: false, error: `comment ${res.status}` };
    const comment = await res.json();
    return { ok: true, url: comment.app_url || comment.url };
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
// comment. The client contact is assigned before a comment is posted so Basecamp
// routes the notification to the right person.
export async function sendApprovalToDeliverables(input: {
  projectId: string;
  campaignTitle: string;
  // YYYY-MM-DD. Set on create and refreshed on every resend, so the clock on a
  // client's approval starts from the send they were actually notified about.
  dueOn?: string;
  // Built once the recipient is resolved, so the greeting can be a real mention
  // rather than their name as plain text.
  buildContent: (contactMention?: string) => string;
  recipientIdentifiers: string[];
  existingCardId?: string | null;
  // Whose Basecamp login posts this. The route passes the person who clicked
  // send when they have connected, so the client sees a name they know. Falls
  // back to the mascot account, never to another human.
  identity?: BcIdentity;
}): Promise<ApprovalDeliveryResult> {
  const identity = input.identity || SERVICE;
  if (!input.projectId) {
    return { ok: false, error: "No Basecamp project set for this client." };
  }

  try {
    const projectRes = await bc(`/projects/${input.projectId}.json`, undefined, identity);
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
      const tableRes = await bc(`/card_tables/${candidate.id}.json`, undefined, identity);
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

    // The enriched roster: /projects/{id}/people.json returns no email_address
    // and no attachable_sgid, so matching a client by email could never succeed
    // and any mention degraded to plain text.
    const people = await getProjectPeopleForMention(input.projectId, identity);
    // Email first, then an exact full name, and nobody otherwise. No substring
    // matching: a contact called "Michael" would otherwise match whichever
    // Michael sits first in the roster, and on a live project that is as likely
    // to be one of ours as the client.
    const recipient = findClientContact(
      people,
      input.recipientIdentifiers[0] || "",
      input.recipientIdentifiers[1] || ""
    );
    if (!recipient) {
      return {
        ok: false,
        error:
          "Could not match this account's contact to a person on the Basecamp project. " +
          "Check the client's Contact name matches their Basecamp name exactly, and that they are a member of the project.",
      };
    }

    let card: BcCard | null = null;
    if (input.existingCardId) {
      const cardRes = await bc(`/card_tables/cards/${input.existingCardId}.json`, undefined, identity);
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
      }, identity);
      if (!moveRes.ok) {
        return { ok: false, error: `Could not move the card (${moveRes.status}).` };
      }

      const assigneeIds = Array.from(
        new Set([...(card.assignees || []).map((person) => person.id), recipient.id])
      );
      const assignRes = await bc(`/card_tables/cards/${card.id}.json`, {
        method: "PUT",
        body: JSON.stringify({
          title: input.campaignTitle,
          assignee_ids: assigneeIds,
          ...(input.dueOn ? { due_on: input.dueOn } : {}),
        }),
      }, identity);
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
        body: JSON.stringify({
          content: input.buildContent(mentionHtml(recipient)),
        }),
      }, identity);
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
        content: input.buildContent(mentionHtml(recipient)),
        notify: true,
        ...(input.dueOn ? { due_on: input.dueOn } : {}),
      }),
    }, identity);
    if (!createRes.ok) {
      return { ok: false, error: `Could not create the approval card (${createRes.status}).` };
    }
    const created = (await createRes.json()) as BcCard;

    // due_on is repeated here on purpose: the create endpoint has quietly
    // ignored it in the past, and the follow-up PUT is the one Basecamp
    // reliably honours.
    const assignRes = await bc(`/card_tables/cards/${created.id}.json`, {
      method: "PUT",
      body: JSON.stringify({
        assignee_ids: [recipient.id],
        ...(input.dueOn ? { due_on: input.dueOn } : {}),
      }),
    }, identity);
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
/* ------------------------------------------------------- message threads */

// One post on a project's message board, plus whoever has spoken on it since.
// `client` on a person is Basecamp's own flag for a client-side user, which is
// what lets us tell a client's post from one of ours without guessing at email
// domains.
export interface BcMessageThread {
  id: number;
  title: string;
  url: string;
  createdAt: string;
  authorName: string;
  authorIsClient: boolean;
  // Every comment on the thread, oldest first.
  replies: Array<{ createdAt: string; authorName: string; authorIsClient: boolean }>;
}

function personIsClient(p: { client?: boolean; employee?: boolean } | undefined): boolean {
  if (!p) return false;
  // Trust `client` when Basecamp sets it. Falling back to "not an employee"
  // would mark integration bots as clients, so employee is only used to rule a
  // person out, never to rule one in.
  return Boolean(p.client) && !p.employee;
}

// Basecamp pages collections at 15.
const BC_PAGE = 15;
// Ceiling on comment paging per thread, so one runaway thread can't stall a
// whole sweep. 20 pages is 300 comments; a message board thread that long is
// not something this account produces.
const MAX_COMMENT_PAGES = 20;

/**
 * Message-board threads for a project, with their comments.
 *
 * Two things here are correctness-critical rather than performance tuning.
 *
 * Comments come back oldest-first, and the verdict depends on the NEWEST post
 * from each side, so a short page cap does not just lose detail — it loses the
 * end of the conversation and reports an answered thread as unanswered. Pages
 * are therefore derived from comments_count so the sweep always reads through
 * to the last comment.
 *
 * maxThreads is a genuine cap, and it is set high because this report is about
 * old messages: trimming to the most recent threads would drop exactly the ones
 * worth surfacing. The caller is told when it bites rather than left to assume
 * full coverage.
 */
export async function listProjectMessages(
  projectId: string,
  maxThreads = 200
): Promise<{ threads: BcMessageThread[]; droppedThreads: number }> {
  if (!projectId) return { threads: [], droppedThreads: 0 };
  try {
    const pr = await bc(`/projects/${projectId}.json`);
    if (!pr.ok) return { threads: [], droppedThreads: 0 };
    const project = await pr.json();
    const dock: Array<{ id: number; name: string; enabled?: boolean }> = project.dock || [];
    const board = dock.find((d) => d.name === "message_board" && d.enabled !== false);
    if (!board) return { threads: [], droppedThreads: 0 };

    const raw = await bcCollection<{
      id: number;
      subject?: string;
      title?: string;
      created_at: string;
      app_url?: string;
      comments_count?: number;
      creator?: { name?: string; client?: boolean; employee?: boolean };
    }>(
      `/buckets/${projectId}/message_boards/${board.id}/messages.json`,
      Math.ceil(maxThreads / BC_PAGE)
    );

    const threads = raw.slice(0, maxThreads);
    const droppedThreads = Math.max(0, raw.length - threads.length);

    const built = await Promise.all(
      threads.map(async (m) => {
        // Read to the end of the thread: the last comment decides the verdict.
        const pages = Math.min(
          MAX_COMMENT_PAGES,
          Math.max(1, Math.ceil((m.comments_count ?? BC_PAGE) / BC_PAGE))
        );
        // Skip the round trip when Basecamp already says there are none.
        const comments =
          m.comments_count === 0
            ? []
            : await bcCollection<{
                created_at: string;
                creator?: { name?: string; client?: boolean; employee?: boolean };
              }>(`/buckets/${projectId}/recordings/${m.id}/comments.json`, pages);

        return {
          id: m.id,
          title: m.subject || m.title || "Untitled message",
          url: m.app_url || "",
          createdAt: m.created_at,
          authorName: m.creator?.name || "Unknown",
          authorIsClient: personIsClient(m.creator),
          replies: comments
            .map((c) => ({
              createdAt: c.created_at,
              authorName: c.creator?.name || "Unknown",
              authorIsClient: personIsClient(c.creator),
            }))
            .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
        };
      })
    );

    return { threads: built, droppedThreads };
  } catch {
    return { threads: [], droppedThreads: 0 };
  }
}

export async function listProjects(
  identity: BcIdentity = SERVICE
): Promise<Array<{ id: number; name: string }>> {
  const out: Array<{ id: number; name: string }> = [];
  for (let page = 1; page <= 30; page++) {
    const res = await bc(`/projects.json?page=${page}`, undefined, identity);
    if (!res.ok) break;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) break;
    for (const p of arr) out.push({ id: p.id, name: p.name });
    if (arr.length < 15) break;
  }
  return out;
}

export function disconnectBasecamp() {
  getDb()
    .prepare(`DELETE FROM app_settings WHERE key IN (?, ?)`)
    .run("basecamp_tokens", "basecamp_service_identity");
}

// --------------------------------------------------------------- Onboarding

export interface ProjectConstructionResult {
  ok: boolean;
  error?: string;
  projectId?: string;
}

// Creates a project from an existing Basecamp project template (the standard
// new-client setup: message board, to-dos, card table, etc. already laid
// out). Construction is async on Basecamp's side — POST starts it, then this
// polls the same resource until it reports completed. Requires the connected
// identity to be an account admin/owner in Basecamp; a 403 here means that,
// not a bug in this call.
export async function createProjectFromTemplate(
  templateId: string,
  name: string,
  description: string,
  identity: BcIdentity = SERVICE
): Promise<ProjectConstructionResult> {
  const startRes = await bc(
    `/templates/${templateId}/project_constructions.json`,
    { method: "POST", body: JSON.stringify({ project: { name, description } }) },
    identity
  );
  if (!startRes.ok) {
    return { ok: false, error: `start ${startRes.status}` };
  }
  const started = await startRes.json();
  const constructionId = started.id;
  if (!constructionId) return { ok: false, error: "no construction id returned" };

  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const pollRes = await bc(
      `/templates/${templateId}/project_constructions/${constructionId}.json`,
      undefined,
      identity
    );
    if (!pollRes.ok) continue;
    const status = await pollRes.json();
    if (status.status === "completed" && status.project_id) {
      return { ok: true, projectId: String(status.project_id) };
    }
    if (status.status === "failed") {
      return { ok: false, error: "construction failed" };
    }
  }
  return { ok: false, error: "construction did not finish in time" };
}

// Finds an existing Basecamp person by email, account-wide (not just one
// project). Basecamp's API grants project access to people already in the
// account — it does not expose a way to invite a brand-new email by API, so
// the caller must treat a null result as "invite them from Basecamp's People
// settings first," not as a retriable failure.
export async function findPersonByEmail(
  email: string,
  identity: BcIdentity = SERVICE
): Promise<BcPerson | null> {
  if (!email.trim()) return null;
  const res = await bc(`/circles/people.json`, undefined, identity);
  if (!res.ok) return null;
  const all = await res.json();
  if (!Array.isArray(all)) return null;
  const want = email.trim().toLowerCase();
  const match = all.find(
    (p: BcPerson) => (p.email_address || "").toLowerCase() === want
  );
  return match || null;
}

export interface GrantAccessResult {
  ok: boolean;
  error?: string;
}

// Grants an already-known Basecamp person access to a project. This is the
// "add the client to Basecamp" half of onboarding — findPersonByEmail first.
export async function grantProjectAccess(
  projectId: string,
  personId: number,
  identity: BcIdentity = SERVICE
): Promise<GrantAccessResult> {
  const res = await bc(
    `/projects/${projectId}/people/users.json`,
    { method: "PUT", body: JSON.stringify({ grant: [personId] }) },
    identity
  );
  if (res.ok) return { ok: true };
  return { ok: false, error: `${res.status}` };
}
