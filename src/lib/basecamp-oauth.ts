// Per-person Basecamp OAuth.
//
// The same registered integration serves everybody: one BASECAMP_CLIENT_ID, many
// authorizations. What has to be right is binding a returning ?code= to the
// person who started the flow, which is what the signed state is for. Without it
// a code could be redeemed into the wrong session's connection.

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { saveConnection } from "./basecamp-identity";

const LAUNCHPAD_AUTH = "https://launchpad.37signals.com/authorization/new";
const LAUNCHPAD_TOKEN = "https://launchpad.37signals.com/authorization/token";
const TIMEOUT_MS = 12_000;
// A consent screen someone leaves open for an hour is a stale flow, not an
// attack, but there is no reason to honour it either.
const STATE_TTL_MS = 30 * 60 * 1000;

function secret(): string {
  return process.env.SESSION_SECRET || "dev-insecure-secret";
}
function clientId(): string {
  return process.env.BASECAMP_CLIENT_ID || "";
}
function clientSecret(): string {
  return process.env.BASECAMP_CLIENT_SECRET || "";
}
function accountId(): string {
  return process.env.BASECAMP_ACCOUNT_ID || "5338018";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

// "<person>.<nonce>.<issuedAt>.<signature>". The person travels inside the signed
// payload so the callback does not have to trust the session alone.
export function makeState(person: string): string {
  const payload = `${person}.${randomBytes(8).toString("hex")}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

export function readState(state: string): { person: string } | null {
  const parts = (state || "").split(".");
  if (parts.length !== 4) return null;
  const [person, nonce, issuedAt, signature] = parts;
  const expected = sign(`${person}.${nonce}.${issuedAt}`);
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
  return { person };
}

export function authorizeUrlFor(person: string, redirectUri: string): string {
  const p = new URLSearchParams({
    type: "web_server",
    client_id: clientId(),
    redirect_uri: redirectUri,
    state: makeState(person),
  });
  return `${LAUNCHPAD_AUTH}?${p.toString()}`;
}

export type ConnectResult =
  | { ok: true; name: string; email: string }
  | { ok: false; error: string };

export interface Identity {
  id: number;
  name: string;
  email: string;
  inAccount: boolean;
}

/**
 * Who this token belongs to, and whether they are in the MEG account.
 *
 * The membership check is the important half. Basecamp will happily authorize
 * somebody's personal account, and a connection pointing at the wrong account
 * would send this app's writes somewhere nobody is looking.
 */
export async function whoAmI(accessToken: string): Promise<Identity | null> {
  try {
    const res = await fetch("https://launchpad.37signals.com/authorization.json", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "Campaign Desk (Marketing Empire Group)",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const d = await res.json();
    const accounts: Array<{ id: number }> = Array.isArray(d?.accounts) ? d.accounts : [];
    return {
      id: Number(d?.identity?.id) || 0,
      name: [d?.identity?.first_name, d?.identity?.last_name]
        .filter(Boolean)
        .join(" ")
        .trim(),
      email: String(d?.identity?.email_address || ""),
      inAccount: accounts.some((a) => String(a.id) === accountId()),
    };
  } catch {
    return null;
  }
}

// Exchange the code and store the connection against this person.
export async function completeConnect(
  person: string,
  code: string,
  redirectUri: string
): Promise<ConnectResult> {
  const p = new URLSearchParams({
    type: "web_server",
    client_id: clientId(),
    client_secret: clientSecret(),
    code,
    redirect_uri: redirectUri,
  });
  let tokens: { access_token?: string; refresh_token?: string; expires_in?: number };
  try {
    const res = await fetch(`${LAUNCHPAD_TOKEN}?${p.toString()}`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ok: false, error: `Basecamp rejected the authorization (${res.status}).` };
    }
    tokens = await res.json();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (!tokens.access_token || !tokens.refresh_token) {
    return { ok: false, error: "Basecamp did not return a usable token." };
  }

  const me = await whoAmI(tokens.access_token);
  if (!me || !me.id) {
    return { ok: false, error: "Could not read your Basecamp identity." };
  }
  if (!me.inAccount) {
    return {
      ok: false,
      error:
        "That Basecamp login is not a member of the Marketing Empire Group account. Sign in to Basecamp with your work account and try again.",
    };
  }

  saveConnection({
    person,
    bcPersonId: me.id,
    bcName: me.name,
    bcEmail: me.email,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
  });
  return { ok: true, name: me.name, email: me.email };
}
