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
  const res = await fetch(`${LAUNCHPAD_TOKEN}?${p.toString()}`, { method: "POST" });
  if (!res.ok) {
    console.error("[basecamp] token exchange failed", res.status, await res.text().catch(() => ""));
    return false;
  }
  const d = await res.json();
  if (!d.access_token) return false;
  saveTokens(d.access_token, d.refresh_token, d.expires_in);
  return true;
}

async function refreshTokens(): Promise<boolean> {
  const t = getTokens();
  if (!t?.refresh_token) return false;
  const p = new URLSearchParams({
    type: "refresh",
    refresh_token: t.refresh_token,
    client_id: clientId(),
    client_secret: clientSecret(),
  });
  const res = await fetch(`${LAUNCHPAD_TOKEN}?${p.toString()}`, { method: "POST" });
  if (!res.ok) {
    console.error("[basecamp] token refresh failed", res.status);
    return false;
  }
  const d = await res.json();
  if (!d.access_token) return false;
  // Basecamp keeps the same refresh token across refreshes.
  saveTokens(d.access_token, t.refresh_token, d.expires_in);
  return true;
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

export interface BcPerson {
  id: number;
  name: string;
  email_address: string;
  // Used to @-mention this person inline in rich text content
  // (<bc-attachment sgid="...">). Absent for some system/bot accounts.
  attachable_sgid?: string;
}

// People with access to a project. Used to resolve a POC / account manager
// (given as an email or name) to the Basecamp person id we tag on a card.
export async function getProjectPeople(projectId: string): Promise<BcPerson[]> {
  if (!projectId) return [];
  const res = await bc(`/projects/${projectId}/people.json`);
  if (!res.ok) return [];
  const arr = await res.json();
  if (!Array.isArray(arr)) return [];
  return arr.map((p) => ({
    id: p.id,
    name: p.name || "",
    email_address: p.email_address || "",
    attachable_sgid: p.attachable_sgid || undefined,
  }));
}

// Rich-text @-mention markup for a person, to embed directly in card content.
export function mentionHtml(person: BcPerson): string {
  return person.attachable_sgid
    ? `<bc-attachment sgid="${person.attachable_sgid}"></bc-attachment>`
    : `@${person.name}`;
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
