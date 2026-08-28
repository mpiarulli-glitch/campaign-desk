// Who a Google Calendar request acts as.
//
// Writes must use that person's own token — never a shared app token — so a
// meeting booked from Jack's Forecast lands on Jack's calendar. There is no
// service-account fallback, unlike Basecamp reads.

import { getDb, nowIso, type GoogleConnection } from "./db";
import { decryptSecret, encryptSecret } from "./secrets";

export type { GoogleConnection };

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TIMEOUT_MS = 12_000;

function clientId(): string {
  return process.env.GOOGLE_CLIENT_ID || "";
}
function clientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET || "";
}

export function googleConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

export function getGoogleConnection(person: string): GoogleConnection | null {
  const row = getDb()
    .prepare(`SELECT * FROM google_connections WHERE person = ?`)
    .get(person) as GoogleConnection | undefined;
  return row || null;
}

export function listGoogleConnections(): GoogleConnection[] {
  return getDb()
    .prepare(`SELECT * FROM google_connections ORDER BY person`)
    .all() as GoogleConnection[];
}

export function hasGoogleConnection(person: string | null): boolean {
  if (!person) return false;
  const c = getGoogleConnection(person);
  return Boolean(c && decryptSecret(c.access_token));
}

export function saveConnection(input: {
  person: string;
  googleEmail: string;
  googleName: string;
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
}): void {
  const existing = getGoogleConnection(input.person);
  const ttl = (input.expiresIn ? input.expiresIn * 1000 : 3600_000) - 60_000;
  const refresh = input.refreshToken || (existing ? decryptSecret(existing.refresh_token) || "" : "");
  getDb()
    .prepare(
      `INSERT INTO google_connections
         (person, google_email, google_name, access_token, refresh_token,
          expires_at, connected_at, last_error, last_pulled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(person) DO UPDATE SET
         google_email = excluded.google_email,
         google_name = excluded.google_name,
         access_token = excluded.access_token,
         refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at,
         connected_at = excluded.connected_at,
         last_error = NULL`
    )
    .run(
      input.person,
      input.googleEmail,
      input.googleName,
      encryptSecret(input.accessToken),
      encryptSecret(refresh),
      Date.now() + ttl,
      nowIso(),
      existing?.last_pulled_at || ""
    );
}

export function disconnectGoogle(person: string): void {
  getDb().prepare(`DELETE FROM google_connections WHERE person = ?`).run(person);
}

export function noteGoogleError(person: string, message: string): void {
  getDb()
    .prepare(`UPDATE google_connections SET last_error = ? WHERE person = ?`)
    .run(message.slice(0, 200), person);
}

export function markGooglePulled(person: string): void {
  getDb()
    .prepare(`UPDATE google_connections SET last_pulled_at = ?, last_error = NULL WHERE person = ?`)
    .run(nowIso(), person);
}

const refreshInFlight = new Map<string, Promise<boolean>>();

async function refreshPerson(person: string): Promise<boolean> {
  const existing = refreshInFlight.get(person);
  if (existing) return existing;
  const p = doRefreshPerson(person).finally(() => refreshInFlight.delete(person));
  refreshInFlight.set(person, p);
  return p;
}

async function doRefreshPerson(person: string): Promise<boolean> {
  const conn = getGoogleConnection(person);
  if (!conn) return false;
  const refresh = decryptSecret(conn.refresh_token);
  if (!refresh) {
    noteGoogleError(person, "Stored token could not be read. Reconnect Google Calendar.");
    return false;
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: clientId(),
    client_secret: clientSecret(),
  });
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      noteGoogleError(person, `Google refused the refresh (${res.status}). Reconnect.`);
      return false;
    }
    const d = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!d.access_token) {
      noteGoogleError(person, "Google returned no access token. Reconnect.");
      return false;
    }
    saveConnection({
      person,
      googleEmail: conn.google_email,
      googleName: conn.google_name,
      accessToken: d.access_token,
      refreshToken: d.refresh_token || refresh,
      expiresIn: d.expires_in,
    });
    return true;
  } catch (err) {
    noteGoogleError(person, (err as Error).message);
    return false;
  }
}

export async function googleAccessToken(person: string): Promise<string | null> {
  let conn = getGoogleConnection(person);
  if (!conn) return null;
  if (Date.now() >= conn.expires_at) {
    if (!(await refreshPerson(person))) return null;
    conn = getGoogleConnection(person);
  }
  return conn ? decryptSecret(conn.access_token) : null;
}

export async function forceGoogleRefresh(person: string): Promise<string | null> {
  if (!(await refreshPerson(person))) return null;
  const conn = getGoogleConnection(person);
  return conn ? decryptSecret(conn.access_token) : null;
}
