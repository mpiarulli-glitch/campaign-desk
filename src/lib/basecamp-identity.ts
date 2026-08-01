// Who a Basecamp request acts as.
//
// Basecamp attributes every write to the owner of the bearer token, so "log this
// hour as Jack" is not a field on a request — it is a different token. This
// module owns that mapping: a person's stored OAuth tokens, refreshing them, and
// resolving an identity to a usable access token.
//
// Two identities exist:
//
//   service   the single connection in app_settings. Used for work with no
//             signed-in human behind it: approval cards, scheduled reminders,
//             the schedule sweep. Attribution is whoever connected the app.
//   person    that person's own connection. Used for anything they did.
//
// Reads fall back to the service token when someone has not connected, so the
// app keeps working. Writes never fall back — logging Jack's hours under
// somebody else's name is the exact bug this exists to prevent.

import { getDb, nowIso, type BasecampConnection } from "./db";
import { decryptSecret, encryptSecret } from "./secrets";

export type BcIdentity = { kind: "service" } | { kind: "person"; slug: string };

export const SERVICE: BcIdentity = { kind: "service" };

export function asPerson(slug: string): BcIdentity {
  return { kind: "person", slug };
}

export function identityKey(id: BcIdentity): string {
  return id.kind === "service" ? "service" : `person:${id.slug}`;
}

/* ------------------------------------------------------------- storage */

export function getConnection(person: string): BasecampConnection | null {
  const row = getDb()
    .prepare(`SELECT * FROM basecamp_connections WHERE person = ?`)
    .get(person) as BasecampConnection | undefined;
  return row || null;
}

export function listConnections(): BasecampConnection[] {
  return getDb()
    .prepare(`SELECT * FROM basecamp_connections ORDER BY person`)
    .all() as BasecampConnection[];
}

export function hasConnection(person: string | null): boolean {
  if (!person) return false;
  const c = getConnection(person);
  // A row whose tokens cannot be decrypted is not a connection. That happens if
  // SESSION_SECRET changed, and the honest answer is "reconnect".
  return Boolean(c && decryptSecret(c.access_token));
}

export function saveConnection(input: {
  person: string;
  bcPersonId: number;
  bcName: string;
  bcEmail: string;
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
}): void {
  // Basecamp access tokens last two weeks; expire a minute early so a request is
  // never made with a token that dies mid-flight.
  const ttl = (input.expiresIn ? input.expiresIn * 1000 : 14 * 24 * 3600 * 1000) - 60_000;
  getDb()
    .prepare(
      `INSERT INTO basecamp_connections
         (person, bc_person_id, bc_name, bc_email, access_token, refresh_token,
          expires_at, connected_at, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(person) DO UPDATE SET
         bc_person_id = excluded.bc_person_id,
         bc_name = excluded.bc_name,
         bc_email = excluded.bc_email,
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         connected_at = excluded.connected_at,
         last_error = NULL`
    )
    .run(
      input.person,
      input.bcPersonId,
      input.bcName,
      input.bcEmail,
      encryptSecret(input.accessToken),
      encryptSecret(input.refreshToken),
      Date.now() + ttl,
      nowIso()
    );
}

export function disconnectPerson(person: string): void {
  getDb().prepare(`DELETE FROM basecamp_connections WHERE person = ?`).run(person);
}

function noteError(person: string, message: string): void {
  getDb()
    .prepare(`UPDATE basecamp_connections SET last_error = ? WHERE person = ?`)
    .run(message.slice(0, 200), person);
}

/* -------------------------------------------------------------- refresh */

const LAUNCHPAD_TOKEN = "https://launchpad.37signals.com/authorization/token";
const TIMEOUT_MS = 12_000;

function clientId(): string {
  return process.env.BASECAMP_CLIENT_ID || "";
}
function clientSecret(): string {
  return process.env.BASECAMP_CLIENT_SECRET || "";
}

// Concurrent requests for the same person all see the same expired token; without
// this each would fire its own refresh. Keyed per person so one person's stalled
// refresh cannot block everybody else's, which a single global promise would.
const refreshInFlight = new Map<string, Promise<boolean>>();

async function refreshPerson(person: string): Promise<boolean> {
  const existing = refreshInFlight.get(person);
  if (existing) return existing;
  const p = doRefreshPerson(person).finally(() => refreshInFlight.delete(person));
  refreshInFlight.set(person, p);
  return p;
}

async function doRefreshPerson(person: string): Promise<boolean> {
  const conn = getConnection(person);
  if (!conn) return false;
  const refresh = decryptSecret(conn.refresh_token);
  if (!refresh) {
    noteError(person, "Stored token could not be read. Reconnect Basecamp.");
    return false;
  }
  const params = new URLSearchParams({
    type: "refresh",
    refresh_token: refresh,
    client_id: clientId(),
    client_secret: clientSecret(),
  });
  try {
    const res = await fetch(`${LAUNCHPAD_TOKEN}?${params.toString()}`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      noteError(person, `Basecamp refused the refresh (${res.status}). Reconnect.`);
      return false;
    }
    const d = await res.json();
    if (!d.access_token) {
      noteError(person, "Basecamp returned no access token. Reconnect.");
      return false;
    }
    saveConnection({
      person,
      bcPersonId: conn.bc_person_id,
      bcName: conn.bc_name,
      bcEmail: conn.bc_email,
      accessToken: d.access_token,
      // Basecamp keeps the same refresh token across refreshes.
      refreshToken: refresh,
      expiresIn: d.expires_in,
    });
    return true;
  } catch (err) {
    noteError(person, (err as Error).message);
    return false;
  }
}

/**
 * A usable access token for this person, refreshing if it has expired.
 *
 * Null means "not connected, or connection broken", which callers turn into
 * either a service-token fallback (reads) or a refusal (writes).
 */
export async function personAccessToken(person: string): Promise<string | null> {
  let conn = getConnection(person);
  if (!conn) return null;
  if (Date.now() >= conn.expires_at) {
    if (!(await refreshPerson(person))) return null;
    conn = getConnection(person);
  }
  return conn ? decryptSecret(conn.access_token) : null;
}

// Force a refresh after a 401, which can happen before the recorded expiry if the
// token was revoked in Basecamp.
export async function forcePersonRefresh(person: string): Promise<string | null> {
  if (!(await refreshPerson(person))) return null;
  const conn = getConnection(person);
  return conn ? decryptSecret(conn.access_token) : null;
}
