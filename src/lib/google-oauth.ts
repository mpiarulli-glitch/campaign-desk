// Per-person Google Calendar OAuth.
//
// One Google Cloud OAuth client (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) serves
// everybody. The signed state binds a returning ?code= to the person who started
// the flow, same idea as Basecamp: without it a code could be redeemed into the
// wrong session's connection.
//
// Env:
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
// Redirect URI registered in Google Cloud Console:
//   <NEXT_PUBLIC_APP_URL>/api/google/callback

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { saveConnection } from "./google-identity";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const TIMEOUT_MS = 12_000;
const STATE_TTL_MS = 30 * 60 * 1000;

// calendar.events is the smallest scope that can both list and create/update
// events on calendars the person already has. userinfo.email is only so the UI
// can say who connected; it is not used for writes.
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

export type GoogleReturnTo = "account" | "forecast";

function secret(): string {
  return process.env.SESSION_SECRET || "dev-insecure-secret";
}
function clientId(): string {
  return process.env.GOOGLE_CLIENT_ID || "";
}
function clientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET || "";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function googleConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

// "<person>.<nonce>.<issuedAt>.<returnTo>.<signature>"
export function makeState(person: string, returnTo: GoogleReturnTo = "account"): string {
  const payload = `${person}.${randomBytes(8).toString("hex")}.${Date.now()}.${returnTo}`;
  return `${payload}.${sign(payload)}`;
}

export function readState(
  state: string
): { person: string; returnTo: GoogleReturnTo } | null {
  const parts = (state || "").split(".");
  if (parts.length !== 5) return null;
  const [person, nonce, issuedAt, returnTo, signature] = parts;
  const expected = sign(`${person}.${nonce}.${issuedAt}.${returnTo}`);
  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  const ts = Number(issuedAt);
  if (!Number.isFinite(ts) || Date.now() - ts > STATE_TTL_MS) return null;
  const dest: GoogleReturnTo = returnTo === "forecast" ? "forecast" : "account";
  return { person, returnTo: dest };
}

export function authorizeUrlFor(
  person: string,
  redirectUri: string,
  returnTo: GoogleReturnTo = "account"
): string {
  const p = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES,
    state: makeState(person, returnTo),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `${AUTH_URL}?${p.toString()}`;
}

export type ConnectResult =
  | { ok: true; name: string; email: string }
  | { ok: false; error: string };

export async function googleUserInfo(
  accessToken: string
): Promise<{ email: string; name: string } | null> {
  try {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { email?: string; name?: string };
    const email = String(d?.email || "").trim();
    if (!email) return null;
    return { email, name: String(d?.name || "").trim() };
  } catch {
    return null;
  }
}

export async function completeConnect(
  person: string,
  code: string,
  redirectUri: string
): Promise<ConnectResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: redirectUri,
  });
  let tokens: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ok: false, error: `Google rejected the authorization (${res.status}).` };
    }
    tokens = await res.json();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (!tokens.access_token) {
    return { ok: false, error: "Google did not return a usable token." };
  }
  if (!tokens.refresh_token) {
    return {
      ok: false,
      error:
        "Google did not return a refresh token. Disconnect the app from your Google account and try Connect again.",
    };
  }

  const me = await googleUserInfo(tokens.access_token);
  if (!me) {
    return { ok: false, error: "Could not read your Google identity." };
  }

  saveConnection({
    person,
    googleEmail: me.email,
    googleName: me.name,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
  });
  return { ok: true, name: me.name || me.email, email: me.email };
}
