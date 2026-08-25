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
import {
  attachTodoSteps,
  flagAssignedWithSteps,
  type OpenTodoStep,
} from "./todo-steps";
import { shapeAssignments, type BcAssignment } from "./assignments";
import { findSylviaOnRoster } from "./review-cc";

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

// Basecamp paginates people at 15 per page. One page is not enough: Hendo's
// Barrel House has 18 members, and the first page is all MEG staff, which is
// why Brandon never appeared in the approval picker. Pingable people for the
// whole account is larger still (~250), so that walk is allowed more pages.
const PROJECT_PEOPLE_MAX_PAGES = 8;
const PINGABLE_PEOPLE_MAX_PAGES = 30;

function asBcPerson(p: {
  id?: number;
  name?: string;
  email_address?: string;
  client?: boolean;
  employee?: boolean;
  attachable_sgid?: string;
}): BcPerson | null {
  if (!p?.id) return null;
  return {
    id: p.id,
    name: p.name || "",
    email_address: p.email_address || "",
    client: Boolean(p.client),
    employee: Boolean(p.employee),
    attachable_sgid: p.attachable_sgid || undefined,
  };
}

// People with access to a project. Used to resolve a contact / account manager
// (given as an email or name) to the Basecamp person id we tag on a card.
export async function getProjectPeople(
  projectId: string,
  identity: BcIdentity = SERVICE
): Promise<BcPerson[]> {
  if (!projectId) return [];
  try {
    const arr = await bcCollection<{
      id?: number;
      name?: string;
      email_address?: string;
      client?: boolean;
      employee?: boolean;
      attachable_sgid?: string;
    }>(`/projects/${projectId}/people.json`, PROJECT_PEOPLE_MAX_PAGES, identity);
    return arr.map(asBcPerson).filter((person): person is BcPerson => person !== null);
  } catch {
    return [];
  }
}

async function getPingablePeople(
  identity: BcIdentity = SERVICE
): Promise<BcPerson[]> {
  try {
    const arr = await bcCollection<{
      id?: number;
      name?: string;
      email_address?: string;
      client?: boolean;
      employee?: boolean;
      attachable_sgid?: string;
    }>(`/circles/people.json`, PINGABLE_PEOPLE_MAX_PAGES, identity);
    return arr.map(asBcPerson).filter((person): person is BcPerson => person !== null);
  } catch {
    return [];
  }
}

// Copy email, mention token, and client/employee flags from the account-wide
// pingable list onto a project's members. /projects/{id}/people.json omits
// those fields, so without this merge the approval picker cannot tell a client
// contact from MEG staff and mentions silently degrade to plain text.
export function mergePingableDetails(
  members: BcPerson[],
  pingable: BcPerson[]
): BcPerson[] {
  const byId = new Map<number, BcPerson>();
  for (const person of pingable) {
    if (person?.id) byId.set(person.id, person);
  }
  return members.map((member) => {
    const extra = byId.get(member.id);
    if (!extra) return member;
    return {
      ...member,
      email_address: member.email_address || extra.email_address || "",
      attachable_sgid: member.attachable_sgid || extra.attachable_sgid,
      client: member.client || extra.client,
      employee: member.employee || extra.employee,
    };
  });
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
    const pingable = await getPingablePeople(identity);
    if (!pingable.length) return members;
    return mergePingableDetails(members, pingable);
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

// Real Basecamp mention for Sylvia when she is on the project or pingable on
// the account. Falls back to the letters "@Sylvia" so the CC line still reads
// the same if we cannot resolve her.
export async function resolveSylviaMention(
  people: BcPerson[],
  identity: BcIdentity = SERVICE
): Promise<string> {
  let sylvia = findSylviaOnRoster(people);
  if (!sylvia?.attachable_sgid) {
    try {
      const fromAccount = findSylviaOnRoster(await getPingablePeople(identity));
      if (fromAccount?.attachable_sgid) sylvia = fromAccount;
      else if (!sylvia) sylvia = fromAccount;
    } catch {
      // Keep the project hit, or nobody — the CC line still goes out.
    }
  }
  return sylvia?.attachable_sgid ? mentionHtml(sylvia) : "@Sylvia";
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
// is tried first because it is unambiguous; a full name has to match exactly.
//
// Returns null rather than a wrong person. A card with no assignee is a small
// problem; a card assigning the client's work to our own staff, or tagging the
// wrong human, is a bigger one.
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
  // "step" is a checklist subtask under a parent todo. Completing it uses the
  // step endpoint, not the parent todo's.
  kind?: "todo" | "step";
  parentId?: string;
  parentTitle?: string;
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

    // Subtasks are a separate recording type (Kanban::Step). Fetch them while
    // walking lists so the picker isn't another round trip later.
    const stepsPromise = listOpenTodoSteps(projectId, identity);

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
    const todos = perList.flat().filter((t) => t.title);
    const steps = await stepsPromise;
    return attachTodoSteps(todos, steps);
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
    // Subtasks never carry assignees, so flagAssignedWithSteps hands them their
    // parent to-do's answer rather than leaving every subtask unassigned.
    return flagAssignedWithSteps(todos, (t) => t.assigneeIds.includes(opts.bcPersonId!));
  }

  // Neither call depends on the other's result, so run them together instead
  // of paying for both round trips back to back.
  const [todos, people] = await Promise.all([
    listProjectTodos(projectId, identity),
    getProjectPeople(projectId, identity),
  ]);
  if (!todos.length) return { todos, assignedCount: 0 };
  const ids = matchPeople(people, identifiers);
  return flagAssignedWithSteps(
    todos,
    (t) => ids.length > 0 && t.assigneeIds.some((id) => ids.includes(id))
  );
}

interface StepRecordingRaw {
  id: number;
  title?: string;
  content?: string;
  completed?: boolean;
  due_on?: string | null;
  parent?: { id: number; type?: string; title?: string; name?: string };
  assignees?: Array<{ id: number }>;
}

// Open checklist subtasks in a project. These are Kanban::Step recordings
// parented to a Todo — the regular todolist walk does not include them.
async function listOpenTodoSteps(
  projectId: string,
  identity: BcIdentity
): Promise<OpenTodoStep[]> {
  try {
    const raw = await bcCollection<StepRecordingRaw>(
      `/projects/recordings.json?type=${encodeURIComponent("Kanban::Step")}&bucket=${encodeURIComponent(projectId)}&status=active`,
      10,
      identity
    );
    return raw.map((s) => ({
      id: String(s.id),
      title: (s.title || s.content || "").trim(),
      parentId: String(s.parent?.id || ""),
      parentType: s.parent?.type || "",
      parentTitle: (s.parent?.title || s.parent?.name || "").trim(),
      completed: Boolean(s.completed),
      assigneeIds: (s.assignees || []).map((a) => a.id),
      dueOn: s.due_on || null,
    }));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------- my assignments */

/**
 * Everything assigned to the caller, across every project.
 *
 * /my/assignments.json is scoped to whoever's token makes the request, so this
 * MUST run on a person's own connection — called with the service identity it
 * would answer with the mascot account's work. That also means no name matching
 * is involved: Basecamp itself decides what "mine" is.
 *
 * The shaping lives in ./assignments so it can be tested without an account.
 */
export async function listMyAssignments(identity: BcIdentity): Promise<BcAssignment[]> {
  try {
    const res = await bc(`/my/assignments.json`, undefined, identity);
    if (!res.ok) return [];
    return shapeAssignments(await res.json());
  } catch {
    return [];
  }
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

export type CreateScheduleEntryResult =
  | {
      ok: true;
      id: string;
      appUrl: string;
      projectName: string;
      participants: string[];
      startsAt: string;
      endsAt: string;
      allDay: boolean;
      title: string;
    }
  | { ok: false; error: string };

/**
 * Put a meeting on a project's Basecamp calendar (Schedule::Entry).
 *
 * Timesheet entries hang off the recording id this returns, which is why a
 * typed forecast meeting has to land here instead of staying local: logging
 * hours needs a real Basecamp recording on that project.
 */
export async function createScheduleEntry(
  projectId: string,
  input: {
    summary: string;
    startsAt: string;
    endsAt: string;
    allDay: boolean;
    participantIds?: number[];
    description?: string;
  },
  identity: BcIdentity = SERVICE
): Promise<CreateScheduleEntryResult> {
  const summary = input.summary.trim().slice(0, 999);
  if (!projectId) return { ok: false, error: "No Basecamp project set." };
  if (!summary) return { ok: false, error: "A meeting needs a name." };
  try {
    const pr = await bc(`/projects/${projectId}.json`, undefined, identity);
    if (!pr.ok) return { ok: false, error: `Could not open that Basecamp project (${pr.status}).` };
    const project = await pr.json();
    const dock: Array<{ id: number; name: string; enabled?: boolean }> = project.dock || [];
    const schedule = dock.find((d) => d.name === "schedule" && d.enabled !== false);
    if (!schedule) {
      return { ok: false, error: "That Basecamp project has no calendar." };
    }
    const body: Record<string, unknown> = {
      summary,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      all_day: input.allDay,
      notify: false,
    };
    if (input.description) body.description = input.description;
    if (input.participantIds && input.participantIds.length) {
      body.participant_ids = input.participantIds;
    }
    const res = await bc(
      `/buckets/${projectId}/schedules/${schedule.id}/entries.json`,
      { method: "POST", body: JSON.stringify(body) },
      identity
    );
    if (!res.ok) {
      return { ok: false, error: `Could not add that meeting to Basecamp (${res.status}).` };
    }
    const entry = await res.json();
    if (!entry.id) return { ok: false, error: "Basecamp did not return a calendar entry." };
    return {
      ok: true,
      id: String(entry.id),
      appUrl: entry.app_url || "",
      projectName: project.name || entry.bucket?.name || "",
      participants: (entry.participants || [])
        .map((p: { name?: string }) => p.name || "")
        .filter(Boolean),
      startsAt: entry.starts_at || input.startsAt,
      endsAt: entry.ends_at || input.endsAt,
      allDay: Boolean(entry.all_day ?? input.allDay),
      title: (entry.summary || summary).trim(),
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message || "Could not add that meeting to Basecamp." };
  }
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
    if (res.ok) return { ok: true };
    // Subtasks are steps, not todos. A 404 here is either "already done" or
    // "this id is a checklist step" — try the step endpoint before treating
    // the miss as success.
    const step = await completeTodoStep(projectId, todoId, "on", identity);
    if (step.ok) return { ok: true };
    if (res.status === 404) return { ok: true };
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
    if (res.ok) return { ok: true };
    const step = await completeTodoStep(projectId, todoId, "off", identity);
    if (step.ok) return { ok: true };
    if (res.status === 404) return { ok: true };
    return { ok: false, error: `completion ${res.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Tick a subtask (Kanban::Step) on or off.
 *
 * The recording's own `completion_url` is /buckets/{project}/steps/{id}/
 * completions.json — note the missing `card_tables` segment that the rest of the
 * step API uses. Card-table steps answer on the `card_tables` path, and in
 * practice both routes accept a to-do subtask, so this tries the one Basecamp
 * hands back first and falls back to the other.
 *
 * `ok` is a real 2xx and nothing else, so callers using this as a fallback for a
 * to-do id can tell "that id was a step and it flipped" from "that id is not a
 * step either". `status` carries the last response code for that decision.
 */
export async function completeTodoStep(
  projectId: string,
  stepId: string,
  completion: "on" | "off",
  identity: BcIdentity = SERVICE
): Promise<{ ok: boolean; status: number; error?: string }> {
  if (!projectId || !stepId) {
    return { ok: false, status: 0, error: "missing project or step id" };
  }
  const paths = [
    `/buckets/${projectId}/steps/${stepId}/completions.json`,
    `/buckets/${projectId}/card_tables/steps/${stepId}/completions.json`,
  ];
  let lastStatus = 0;
  for (const path of paths) {
    try {
      const res = await bc(
        path,
        { method: "PUT", body: JSON.stringify({ completion }) },
        identity
      );
      if (res.ok) return { ok: true, status: res.status };
      lastStatus = res.status;
    } catch (err) {
      return { ok: false, status: 0, error: (err as Error).message };
    }
  }
  return { ok: false, status: lastStatus, error: `step completion ${lastStatus}` };
}

/**
 * Tick a subtask, treating "it isn't there any more" as done.
 *
 * A forecast row linked to a subtask outlives the subtask: someone can delete it
 * in Basecamp, or tick it off there first. Both answer 404, and in both cases the
 * local tick has nothing left to mirror, so reporting a failure would only ask
 * the person to fix something that is already the way they wanted it.
 */
export async function setForecastStepCompletion(
  projectId: string,
  stepId: string,
  completed: boolean,
  identity: BcIdentity = SERVICE
): Promise<{ ok: boolean; error?: string }> {
  const result = await completeTodoStep(
    projectId,
    stepId,
    completed ? "on" : "off",
    identity
  );
  if (result.ok || result.status === 404) return { ok: true };
  return { ok: false, error: result.error };
}

/**
 * Create a checklist subtask on a Basecamp to-do.
 *
 * To-do subtasks are Kanban::Step recordings even when the parent is a normal
 * Todo, so the create path is the card-table steps endpoint with the parent
 * to-do's id in the card slot. A few accounts still want the `kanban_step`
 * wrapper or the older `/todos/{id}/steps` route; those are tried only if the
 * first shape is rejected, so a success does not pay for three round trips.
 */
export async function createTodoStep(
  projectId: string,
  todoId: string,
  title: string,
  identity: BcIdentity = SERVICE
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const trimmed = title.trim().slice(0, 999);
  if (!projectId || !todoId || !trimmed) {
    return { ok: false, error: "missing project, todo, or title" };
  }
  const attempts: Array<{ path: string; body: string }> = [
    {
      path: `/buckets/${projectId}/card_tables/cards/${todoId}/steps.json`,
      body: JSON.stringify({ title: trimmed }),
    },
    {
      path: `/buckets/${projectId}/card_tables/cards/${todoId}/steps.json`,
      body: JSON.stringify({ kanban_step: { title: trimmed } }),
    },
    {
      path: `/buckets/${projectId}/todos/${todoId}/steps.json`,
      body: JSON.stringify({ title: trimmed }),
    },
  ];
  let lastError = "create step failed";
  for (const attempt of attempts) {
    try {
      const res = await bc(
        attempt.path,
        { method: "POST", body: attempt.body },
        identity
      );
      if (res.ok) {
        const step = await res.json().catch(() => null);
        const id = step?.id != null ? String(step.id) : "";
        if (id) return { ok: true, id };
        lastError = "create step returned no id";
        continue;
      }
      lastError = `create step ${res.status}`;
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: lastError };
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
  return { ok: false, error: lastError };
}

/**
 * Rename a to-do subtask. Title has to travel with every update — Basecamp
 * treats omitted fields as a revert, so a title-less PUT would blank the step.
 */
export async function updateTodoStep(
  projectId: string,
  stepId: string,
  title: string,
  identity: BcIdentity = SERVICE
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = title.trim().slice(0, 999);
  if (!projectId || !stepId || !trimmed) {
    return { ok: false, error: "missing project, step, or title" };
  }
  const attempts: Array<{ path: string; body: string }> = [
    {
      path: `/buckets/${projectId}/card_tables/steps/${stepId}.json`,
      body: JSON.stringify({ title: trimmed }),
    },
    {
      path: `/buckets/${projectId}/card_tables/steps/${stepId}.json`,
      body: JSON.stringify({ kanban_step: { title: trimmed } }),
    },
    {
      path: `/buckets/${projectId}/steps/${stepId}.json`,
      body: JSON.stringify({ title: trimmed }),
    },
  ];
  let lastError = "update step failed";
  for (const attempt of attempts) {
    try {
      const res = await bc(
        attempt.path,
        { method: "PUT", body: attempt.body },
        identity
      );
      if (res.ok) return { ok: true };
      lastError = `update step ${res.status}`;
      if (res.status === 404) return { ok: true };
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: lastError };
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
  return { ok: false, error: lastError };
}

/**
 * Remove a recording from the Basecamp UI (recoverable trash, not a hard
 * delete). Used when a forecast step is removed so the matching to-do
 * subtask does not linger as an open checklist item.
 */
export async function trashRecording(
  projectId: string,
  recordingId: string,
  identity: BcIdentity = SERVICE
): Promise<{ ok: boolean; error?: string }> {
  if (!projectId || !recordingId) {
    return { ok: false, error: "missing project or recording id" };
  }
  const paths = [
    `/buckets/${projectId}/recordings/${recordingId}/status/trashed.json`,
    `/recordings/${recordingId}/status/trashed.json`,
  ];
  let lastStatus = 0;
  for (const path of paths) {
    try {
      const res = await bc(path, { method: "PUT", body: JSON.stringify({}) }, identity);
      if (res.ok || res.status === 404) return { ok: true };
      lastStatus = res.status;
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: `trash ${res.status}` };
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
  return { ok: false, error: `trash ${lastStatus}` };
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

export const CAMPAIGN_REVIEW_TODOLIST_NAME = "Campaign Review";
export const OPS_TODOLIST_NAME = "Tasks";

const LIST_DESCRIPTIONS: Record<string, string> = {
  [CAMPAIGN_REVIEW_TODOLIST_NAME]:
    "Internal campaign review asks from Campaign Desk. Assigned to the account manager who should sign off before the client sees it.",
  [OPS_TODOLIST_NAME]: "Assigned from Campaign Desk.",
};

async function getOrCreateNamedTodolist(
  projectId: string,
  listName: string,
  identity: BcIdentity,
  fallbackToFirst = false
): Promise<{ id: string } | { error: string }> {
  const wanted = listName.trim();
  if (!wanted) return { error: "To-do list name is required." };

  const pr = await bc(`/projects/${projectId}.json`, undefined, identity);
  if (!pr.ok) return { error: `Could not open that Basecamp project (${pr.status}).` };
  const project = await pr.json();
  const dock: Array<{ id: number; name: string; enabled?: boolean }> = project.dock || [];
  const todoset = dock.find((d) => d.name === "todoset" && d.enabled !== false);
  if (!todoset) {
    return { error: "This Basecamp project has to-dos turned off." };
  }

  const lists = await bcCollection<{ id: number; title?: string; name?: string }>(
    `/buckets/${projectId}/todosets/${todoset.id}/todolists.json`,
    4,
    identity
  );
  const wantedKey = wanted.toLowerCase();
  const existing = lists.find(
    (l) => (l.title || l.name || "").trim().toLowerCase() === wantedKey
  );
  if (existing) return { id: String(existing.id) };

  const created = await bc(
    `/buckets/${projectId}/todosets/${todoset.id}/todolists.json`,
    {
      method: "POST",
      body: JSON.stringify({
        name: wanted,
        description:
          LIST_DESCRIPTIONS[wanted] || "Assigned from Campaign Desk.",
      }),
    },
    identity
  );
  if (created.ok) {
    const list = await created.json();
    if (list.id) return { id: String(list.id) };
  }

  if (fallbackToFirst) {
    const first = lists[0];
    if (first?.id) return { id: String(first.id) };
  }

  const label = wanted === CAMPAIGN_REVIEW_TODOLIST_NAME ? "Campaign Review" : wanted;
  if (!created.ok) {
    return { error: `Could not create the ${label} to-do list (${created.status}).` };
  }
  return { error: "Basecamp did not return a to-do list." };
}

export async function createAssignedTodo(input: {
  projectId: string;
  title: string;
  description?: string;
  assigneeIds: number[];
  dueOn?: string | null;
  identity?: BcIdentity;
  /** Defaults to Campaign Review so internal review stays on that list. */
  listName?: string;
}): Promise<{ ok: true; todoId: string; todoUrl: string } | { ok: false; error: string }> {
  const identity = input.identity ?? SERVICE;
  if (!input.projectId) return { ok: false, error: "No Basecamp project set." };
  const title = input.title.trim().slice(0, 999);
  if (!title) return { ok: false, error: "To-do title is required." };
  const dueOn = (input.dueOn || "").trim();
  const listName = (input.listName || CAMPAIGN_REVIEW_TODOLIST_NAME).trim();
  try {
    const list = await getOrCreateNamedTodolist(
      input.projectId,
      listName,
      identity,
      listName.toLowerCase() === OPS_TODOLIST_NAME.toLowerCase()
    );
    if ("error" in list) return { ok: false, error: list.error };
    const res = await bc(
      `/buckets/${input.projectId}/todolists/${list.id}/todos.json`,
      {
        method: "POST",
        body: JSON.stringify({
          content: title,
          description: input.description || "",
          assignee_ids: input.assigneeIds,
          notify: input.assigneeIds.length > 0,
          ...(dueOn ? { due_on: dueOn } : {}),
        }),
      },
      identity
    );
    if (!res.ok) {
      return { ok: false, error: `Could not create the Basecamp to-do (${res.status}).` };
    }
    const todo = await res.json();
    if (!todo.id) return { ok: false, error: "Basecamp did not return a to-do." };
    return {
      ok: true,
      todoId: String(todo.id),
      todoUrl: todo.app_url || "",
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message || "Could not create the Basecamp to-do." };
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
  contentHtml: string,
  identity: BcIdentity = SERVICE
): Promise<CampfireResult> {
  if (!projectId || !cardId) {
    return { ok: false, error: "No Basecamp card to follow up on" };
  }
  try {
    const res = await bc(
      `/buckets/${projectId}/recordings/${cardId}/comments.json`,
      { method: "POST", body: JSON.stringify({ content: contentHtml }) },
      identity
    );
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

// Who ends up owning the approval card. The recipient is always first: they are
// the person being asked, and the card is how Basecamp notifies them. Extras
// are dropped unless they are really on the project, so a pick left over from a
// stale page cannot fail the send with a 422 from Basecamp.
export function resolveApprovalAssignees(
  recipientId: number,
  extraIds: number[] | undefined,
  projectPersonIds: number[]
): number[] {
  const onProject = new Set(projectPersonIds);
  const ids = [recipientId];
  for (const id of extraIds || []) {
    if (id !== recipientId && onProject.has(id) && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}

// The due date part of a card write. Undefined means the send form said nothing
// about the due date, and sending no key at all is what leaves a date already on
// the card alone. An empty string is an explicit clear, which Basecamp wants as
// null.
export function approvalDueFields(
  dueOn: string | null | undefined
): { due_on?: string | null } {
  if (dueOn === undefined) return {};
  return { due_on: dueOn || null };
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

export type DeliverablesColumnKind =
  | "needs_approval"
  | "approved"
  | "scheduled";

// Score a normalized column title for a workflow step. Lower is a better match;
// -1 means it is not a candidate. "Needs Approval" must never win as Approved.
export function scoreDeliverablesColumn(
  title: string,
  kind: DeliverablesColumnKind
): number {
  const label = normalizedLabel(title);
  if (kind === "needs_approval") {
    if (label === "needs approval") return 0;
    if (label.includes("needs") && label.includes("approval")) return 1;
    return -1;
  }
  if (kind === "approved") {
    if (label.includes("need") && label.includes("approval")) return -1;
    if (label === "approved") return 0;
    if (/\bapproved\b/.test(label)) return 1;
    return -1;
  }
  const hasScheduled = label.includes("scheduled");
  const hasPublished =
    label.includes("published") && !label.includes("unpublished");
  if (hasScheduled && hasPublished) return 0;
  if (hasScheduled) return 1;
  if (hasPublished) return 2;
  return -1;
}

export function findDeliverablesColumn(
  lists: Array<{ id: number; title: string }>,
  kind: DeliverablesColumnKind
): { id: number; title: string } | undefined {
  const scored = lists
    .map((list) => ({
      list,
      score: scoreDeliverablesColumn(list.title, kind),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score);
  return scored[0]?.list;
}

interface DeliverablesBoard {
  lists: Array<{ id: number; title: string }>;
  tableColumnIds: number[];
  needsApproval: { id: number; title: string };
}

async function loadDeliverablesBoard(
  projectId: string,
  identity: BcIdentity
): Promise<{ ok: true; board: DeliverablesBoard } | { ok: false; error: string }> {
  const projectRes = await bc(`/projects/${projectId}.json`, undefined, identity);
  if (!projectRes.ok) {
    return {
      ok: false,
      error: `Basecamp project lookup failed (${projectRes.status}).`,
    };
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

  const checked: string[] = [];
  let lastStatus = 0;
  for (const candidate of candidates) {
    const tableRes = await bc(
      `/card_tables/${candidate.id}.json`,
      undefined,
      identity
    );
    if (!tableRes.ok) {
      lastStatus = tableRes.status;
      continue;
    }
    const table = await tableRes.json();
    const lists: Array<{ id: number; title: string }> = table.lists || [];
    checked.push(candidate.title.trim() || `table ${candidate.id}`);
    const needsApproval = findDeliverablesColumn(lists, "needs_approval");
    if (needsApproval) {
      return {
        ok: true,
        board: {
          lists,
          tableColumnIds: lists.map((list) => list.id),
          needsApproval,
        },
      };
    }
  }

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

export interface CardMoveResult {
  ok: boolean;
  error?: string;
  columnTitle?: string;
}

// Move an existing Deliverables card to Approved or Scheduled/Published. Used
// when a campaign is approved in Campaign Desk, or when its status is marked
// scheduled. Failures are returned to the caller so the campaign write itself
// is never blocked on Basecamp.
export async function moveDeliverablesCard(input: {
  projectId: string;
  cardId: string;
  column: Exclude<DeliverablesColumnKind, "needs_approval">;
  identity?: BcIdentity;
}): Promise<CardMoveResult> {
  const identity = input.identity || SERVICE;
  if (!input.projectId) {
    return { ok: false, error: "No Basecamp project set for this client." };
  }
  if (!input.cardId) {
    return { ok: false, error: "No Deliverables card is linked to this campaign." };
  }

  try {
    const loaded = await loadDeliverablesBoard(input.projectId, identity);
    if (!loaded.ok) return loaded;

    const target = findDeliverablesColumn(loaded.board.lists, input.column);
    if (!target) {
      const wanted =
        input.column === "approved" ? "Approved" : "Scheduled/Published";
      return {
        ok: false,
        error: `The Deliverables card table has no ${wanted} column.`,
      };
    }

    const cardRes = await bc(
      `/card_tables/cards/${input.cardId}.json`,
      undefined,
      identity
    );
    if (!cardRes.ok) {
      return {
        ok: false,
        error: `Deliverables card lookup failed (${cardRes.status}).`,
      };
    }
    const card = (await cardRes.json()) as BcCard;
    const parentId = card.parent?.id;
    if (parentId && !loaded.board.tableColumnIds.includes(parentId)) {
      return {
        ok: false,
        error:
          "The linked card is not on this project's Deliverables table, so it was left where it is.",
      };
    }
    if (parentId === target.id) {
      return { ok: true, columnTitle: target.title };
    }

    const moveRes = await bc(
      `/card_tables/cards/${input.cardId}/moves.json`,
      {
        method: "POST",
        body: JSON.stringify({ column_id: target.id, position: 1 }),
      },
      identity
    );
    if (!moveRes.ok) {
      return { ok: false, error: `Could not move the card (${moveRes.status}).` };
    }
    return { ok: true, columnTitle: target.title };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// Send the approved client-review message to the client's Deliverables card
// table. The first send creates a card directly in Needs Approval. Later sends
// reuse that card, move it back to Needs Approval, and add the message as a
// comment. The client contact is assigned before a comment is posted so Basecamp
// routes the notification to the right person.
export async function sendApprovalToDeliverables(input: {
  projectId: string;
  campaignTitle: string;
  // Built once the recipient is resolved, so the greeting can be a real mention
  // rather than their name as plain text. Second argument is Sylvia's mention
  // for the CC line.
  buildContent: (contactMention?: string, ccMention?: string) => string;
  recipientIdentifiers: string[];
  existingCardId?: string | null;
  // An explicit pick from the send form. Beats the saved contact, which is why
  // a client with nobody on file can still be sent to: the sender chooses from
  // the project roster instead of the send being withheld.
  recipientId?: number;
  // Anyone else who should own the card. The recipient is always assigned;
  // these are added alongside.
  extraAssigneeIds?: number[];
  // YYYY-MM-DD for the card's due date, "" to clear it, undefined to leave
  // whatever the card already has alone.
  dueOn?: string | null;
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
    const loaded = await loadDeliverablesBoard(input.projectId, identity);
    if (!loaded.ok) return loaded;
    const { needsApproval, tableColumnIds } = loaded.board;

    // The enriched roster: /projects/{id}/people.json returns no email_address
    // and no attachable_sgid, so matching a client by email could never succeed
    // and any mention degraded to plain text.
    const people = await getProjectPeopleForMention(input.projectId, identity);
    // Email first, then an exact full name, and nobody otherwise. No substring
    // matching: a contact called "Michael" would otherwise match whichever
    // Michael sits first in the roster, and on a live project that is as likely
    // to be one of ours as the client.
    const recipient = input.recipientId
      ? people.find((person) => person.id === input.recipientId) || null
      : findClientContact(
          people,
          input.recipientIdentifiers[0] || "",
          input.recipientIdentifiers[1] || ""
        );
    if (!recipient) {
      return {
        ok: false,
        error: input.recipientId
          ? "The person picked to receive this is not on the client's Basecamp project. Reload the page and pick again."
          : "Could not match this account's contact to a person on the Basecamp project. " +
            "Check the client's Contact name matches their Basecamp name exactly, and that they are a member of the project.",
      };
    }

    const chosenAssigneeIds = resolveApprovalAssignees(
      recipient.id,
      input.extraAssigneeIds,
      people.map((person) => person.id)
    );
    const dueFields = approvalDueFields(input.dueOn);
    const ccMention = await resolveSylviaMention(people, identity);
    const content = input.buildContent(mentionHtml(recipient), ccMention);

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
        new Set([
          ...(card.assignees || []).map((person) => person.id),
          ...chosenAssigneeIds,
        ])
      );
      const assignRes = await bc(`/card_tables/cards/${card.id}.json`, {
        method: "PUT",
        body: JSON.stringify({ assignee_ids: assigneeIds, ...dueFields }),
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
          content,
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
        content,
        notify: true,
        ...dueFields,
      }),
    }, identity);
    if (!createRes.ok) {
      return { ok: false, error: `Could not create the approval card (${createRes.status}).` };
    }
    const created = (await createRes.json()) as BcCard;

    const assignRes = await bc(`/card_tables/cards/${created.id}.json`, {
      method: "PUT",
      body: JSON.stringify({ assignee_ids: chosenAssigneeIds }),
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
  const all = await getPingablePeople(identity);
  if (!all.length) return null;
  const want = email.trim().toLowerCase();
  return (
    all.find((person) => (person.email_address || "").toLowerCase() === want) ||
    null
  );
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
