// Agency (Company) reconnect for the GoHighLevel marketplace app.
//
// The stored refresh token in app_settings (`ghl_tokens`) wins over the env
// seed. When that install is removed, refresh returns invalid_grant and every
// GHL call fails until an admin completes this flow and replaces the row.
//
// Redirect URI: GHL_REDIRECT_URI when it is a public URL, otherwise
// https://hub.marketingempiregroup.com/api/ghl/callback. A localhost value is
// the local MCP tool (http://localhost:8889/callback) and is ignored here.
// Register the hub URL on the marketplace app in addition to that localhost
// callback. Do not replace it.

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { ghlRedirectUri, installAgencyTokens } from "./ghl";

const AUTHORIZE_URL = "https://marketplace.gohighlevel.com/v2/oauth/chooselocation";
const TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
export { DEFAULT_GHL_REDIRECT_URI, ghlRedirectUri } from "./ghl";
const TIMEOUT_MS = 12_000;
const STATE_TTL_MS = 30 * 60 * 1000;

// Scopes for the endpoints this app already calls. Names are the marketplace
// scope ids from the HighLevel OAuth scope list, not invented ones.
//
// locations.readonly            GET /locations/search
// oauth.write                   POST /oauth/locationToken
// workflows.readonly            GET /workflows/
// contacts.readonly             GET /contacts/:id, POST /contacts/search
// contacts.write                POST /contacts/upsert, POST /contacts/:id/tags
// conversations.readonly        GET /conversations/search, conversation messages
// conversations/message.readonly GET /conversations/messages/:id and email messages
// conversations/message.write   POST /conversations/messages
// calendars.readonly            GET /calendars/
// calendars/events.readonly     GET /calendars/events
// forms.readonly                GET /forms/submissions
// locations/customFields.readonly GET /locations/:id/customFields
// locations/tags.readonly       GET /locations/:id/tags
// locations/tags.write          PUT and DELETE /locations/:id/tags/:tagId
// payments/orders.readonly      GET /payments/orders
// emails/schedule.readonly      GET and POST /emails/schedule
// emails/builder.readonly       email campaign reads
// emails/builder.write          POST /emails/.../templates
// phonenumbers.read             GET /phone-system/numbers/location/:id
export const GHL_OAUTH_SCOPES = [
  "locations.readonly",
  "oauth.write",
  "workflows.readonly",
  "contacts.readonly",
  "contacts.write",
  "conversations.readonly",
  "conversations/message.readonly",
  "conversations/message.write",
  "calendars.readonly",
  "calendars/events.readonly",
  "forms.readonly",
  "locations/customFields.readonly",
  "locations/tags.readonly",
  "locations/tags.write",
  "payments/orders.readonly",
  "emails/schedule.readonly",
  "emails/builder.readonly",
  "emails/builder.write",
  "phonenumbers.read",
] as const;

function secret(): string {
  return process.env.SESSION_SECRET || "dev-insecure-secret";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function ghlOauthConfigured(): boolean {
  return Boolean((process.env.GHL_CLIENT_ID || "").trim() && (process.env.GHL_CLIENT_SECRET || "").trim());
}

// "<person>.<nonce>.<issuedAt>.<signature>"
export function makeGhlState(person: string): string {
  const payload = `${person}.${randomBytes(8).toString("hex")}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

export function readGhlState(state: string): { person: string } | null {
  const parts = (state || "").split(".");
  if (parts.length !== 4) return null;
  const [person, nonce, issuedAt, signature] = parts;
  if (!person || !nonce || !issuedAt || !signature) return null;
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
  if (!Number.isFinite(ts) || Date.now() - ts > STATE_TTL_MS || ts > Date.now() + 60_000) {
    return null;
  }
  return { person };
}

export function ghlAuthorizeUrl(person: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    redirect_uri: ghlRedirectUri(),
    client_id: (process.env.GHL_CLIENT_ID || "").trim(),
    scope: GHL_OAUTH_SCOPES.join(" "),
    state: makeGhlState(person),
    loginWindowOpenMode: "self",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export type GhlConnectResult = { ok: true } | { ok: false; error: string };

function scrubSecrets(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /"(access_token|refresh_token|client_secret|id_token)"\s*:\s*"[^"]*"/gi,
      '"$1":"[redacted]"'
    )
    .replace(/\b(access_token|refresh_token|client_secret|id_token)=([^&\s]+)/gi, "$1=[redacted]");
}

function safeProviderError(status: number, body: string): string {
  const scrubbed = scrubSecrets(body).replace(/\s+/g, " ").trim();
  let summary = "";
  try {
    const parsed = JSON.parse(scrubbed) as { error?: unknown; error_description?: unknown };
    const code = typeof parsed.error === "string" ? parsed.error : "";
    const description = typeof parsed.error_description === "string" ? parsed.error_description : "";
    summary = [code, description].filter(Boolean).join(": ");
  } catch {
    summary = scrubbed.slice(0, 180);
  }
  summary = scrubSecrets(summary);
  return `GoHighLevel rejected the connection (${status}).${summary ? ` ${summary}` : ""}`;
}

export async function completeGhlConnect(
  code: string,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch
): Promise<GhlConnectResult> {
  const clientId = (process.env.GHL_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GHL_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    return { ok: false, error: "Set GHL_CLIENT_ID and GHL_CLIENT_SECRET first." };
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    user_type: "Company",
    redirect_uri: redirectUri,
  });

  let payload: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    userType?: string;
    user_type?: string;
    companyId?: string;
    company_id?: string;
  };
  try {
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: safeProviderError(res.status, text) };
    payload = text ? (JSON.parse(text) as typeof payload) : {};
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not reach GoHighLevel.";
    return { ok: false, error: scrubSecrets(message).slice(0, 200) };
  }

  if (!payload.access_token || !payload.refresh_token) {
    return { ok: false, error: "GoHighLevel did not return a usable connection." };
  }

  const userType = String(payload.userType || payload.user_type || "Company");
  if (userType.toLowerCase() !== "company") {
    return {
      ok: false,
      error: "That install was for a sub-account. Start again and choose the agency, not one location.",
    };
  }

  const expectedCompany = (process.env.GHL_COMPANY_ID || "").trim();
  const gotCompany = String(payload.companyId || payload.company_id || "").trim();
  if (expectedCompany && gotCompany && gotCompany !== expectedCompany) {
    return {
      ok: false,
      error: "That connection was for a different agency than this hub is set up to use.",
    };
  }

  installAgencyTokens({
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in,
  });
  return { ok: true };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function ghlResultPage(input: {
  ok: boolean;
  heading: string;
  message: string;
}): string {
  const heading = escapeHtml(input.heading);
  const message = escapeHtml(input.message);
  const tone = input.ok ? "#0f6b3c" : "#8d1d1d";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${heading}</title>
</head>
<body style="margin:0;font-family:Georgia,serif;background:#f6f3ee;color:#1c1915;">
  <main style="max-width:34rem;margin:4rem auto;padding:0 1.25rem;">
    <p style="letter-spacing:.08em;text-transform:uppercase;font-family:sans-serif;font-size:12px;color:#6b645c;">Campaign Desk</p>
    <h1 style="font-size:1.8rem;line-height:1.2;margin:0 0 .75rem;color:${tone};">${heading}</h1>
    <p style="font-size:1.05rem;line-height:1.45;">${message}</p>
    <p style="font-family:sans-serif;font-size:14px;"><a href="/admin/production">Back to Productions</a></p>
  </main>
</body>
</html>`;
}

export async function handleGhlCallback(input: {
  isAdmin: boolean;
  person: string | null;
  code: string | null;
  state: string;
  error: string | null;
  errorDescription: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{ status: number; html: string }> {
  if (!input.isAdmin || !input.person) {
    return {
      status: 401,
      html: ghlResultPage({
        ok: false,
        heading: "GoHighLevel was not connected",
        message: "Sign in as an admin, then use Connect GoHighLevel on the Productions page.",
      }),
    };
  }

  const parsed = readGhlState(input.state);
  if (!parsed || parsed.person !== input.person) {
    return {
      status: 400,
      html: ghlResultPage({
        ok: false,
        heading: "GoHighLevel was not connected",
        message: "That connection attempt expired or did not match this login. Start again from Productions.",
      }),
    };
  }

  if (input.error || !input.code) {
    const denied = scrubSecrets(input.errorDescription || input.error || "").replace(/\s+/g, " ").trim();
    return {
      status: 400,
      html: ghlResultPage({
        ok: false,
        heading: "GoHighLevel was not connected",
        message: denied
          ? `GoHighLevel did not grant access. ${denied.slice(0, 180)}`
          : "GoHighLevel did not grant access. Start again from Productions.",
      }),
    };
  }

  const result = await completeGhlConnect(input.code, ghlRedirectUri(), input.fetchImpl);
  if (!result.ok) {
    return {
      status: 400,
      html: ghlResultPage({
        ok: false,
        heading: "GoHighLevel was not connected",
        message: result.error,
      }),
    };
  }

  return {
    status: 200,
    html: ghlResultPage({
      ok: true,
      heading: "GoHighLevel is connected",
      message:
        "The hub saved the new agency connection and will use it instead of the old one. Scheduling texts can go out again.",
    }),
  };
}
