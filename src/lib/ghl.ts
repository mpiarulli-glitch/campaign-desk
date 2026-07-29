/**
 * GoHighLevel (LeadConnector) client.
 *
 * This is a port of the shared client in `code/ghl-mcp/src/ghl-client.ts`,
 * whose own header says it is "used by both the MCP server and the dashboard
 * app". Same OAuth application, same endpoints, same refresh semantics.
 *
 * One deliberate difference: that module caches tokens in `.tokens.json` on
 * disk. Campaign Desk runs on Railway where the app filesystem is ephemeral
 * outside the mounted volume, so a file cache would be wiped on every deploy
 * and the rotated refresh token lost. Tokens are kept in `app_settings`
 * instead, which lives in the SQLite volume.
 *
 * The behaviours worth keeping from the original, and why:
 *   - Expiry is read from the JWT's own `exp` claim, not from `expires_in`.
 *   - Refreshing ROTATES the refresh token; the old one dies immediately.
 *   - `invalid_grant` means a sibling process already rotated it. Re-read the
 *     store and use its token rather than failing.
 *   - Location requests retry once on 401 with a fresh location token.
 */

import { getDb, nowIso } from "./db";

const BASE = "https://services.leadconnectorhq.com";
const API_VERSION = process.env.GHL_API_VERSION || "2021-07-28";

const TOKEN_KEY = "ghl_tokens";
const REQUEST_TIMEOUT_MS = 25_000;
const WORKFLOW_CACHE_TTL_MS = 10 * 60 * 1000;

// A full sweep is 2 requests per location (mint a token, then read workflows),
// so ~300 requests across 150 subaccounts. GHL rate limits hard: at
// concurrency 8 with no backoff, a third of the accounts came back 429 and
// were silently reported as failures. Modest concurrency plus real backoff
// gets the whole agency read cleanly, just a little slower.
const CONCURRENCY = 4;
const MAX_RETRIES = 4;

/** Sleep helper for backoff. */
function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * fetch that retries on 429 and 5xx.
 *
 * Honours `Retry-After` when GHL sends it, otherwise backs off exponentially
 * with jitter so parallel workers don't all wake at the same instant and
 * re-trigger the limit.
 */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastRes: Response | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    } catch (err) {
      clearTimeout(timer);
      const why = err instanceof Error && err.name === "AbortError" ? "timed out" : "network error";
      if (attempt === MAX_RETRIES) throw new GhlError(`GoHighLevel request ${why}`);
      await wait(500 * 2 ** attempt + Math.random() * 250);
      continue;
    }
    clearTimeout(timer);

    if (res.status !== 429 && res.status < 500) return res;

    lastRes = res;
    if (attempt === MAX_RETRIES) break;

    const retryAfter = Number(res.headers.get("Retry-After"));
    const backoff = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter, 30) * 1000
      : Math.min(800 * 2 ** attempt, 8000);
    await wait(backoff + Math.random() * 400);
  }

  return lastRes as Response;
}

export class GhlError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "GhlError";
  }
}

interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

function config() {
  return {
    companyId: process.env.GHL_COMPANY_ID || "",
    clientId: process.env.GHL_CLIENT_ID || "",
    clientSecret: process.env.GHL_CLIENT_SECRET || "",
    redirectUri: process.env.GHL_REDIRECT_URI || "",
    seedAccessToken: process.env.GHL_AGENCY_ACCESS_TOKEN || "",
    seedRefreshToken: process.env.GHL_REFRESH_TOKEN || "",
  };
}

export function ghlCompanyId(): string {
  return config().companyId;
}

export function isGhlConfigured(): boolean {
  const c = config();
  return Boolean(c.clientId && c.clientSecret && c.companyId && (loadTokens() || c.seedRefreshToken));
}

/* ------------------------------------------------------------ token store */

function loadTokens(): TokenData | null {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(TOKEN_KEY) as { value: string } | undefined;
  if (!row?.value) return null;
  try {
    const d = JSON.parse(row.value) as TokenData;
    return d.refresh_token ? d : null;
  } catch {
    return null;
  }
}

function saveTokens(token: TokenData): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(TOKEN_KEY, JSON.stringify(token), nowIso());
}

/** Read `exp` out of the JWT. More reliable than trusting `expires_in`. */
function jwtExpiry(token: string): number {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return 0;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
    return (payload.exp || 0) * 1000;
  } catch {
    return 0;
  }
}

function isExpired(token: TokenData): boolean {
  if (!token.expires_at) return true;
  return Date.now() >= token.expires_at - 60_000;
}

/* ----------------------------------------------------------- agency token */

let agencyToken: TokenData | null = null;
let refreshInFlight: Promise<TokenData> | null = null;

function seedFromEnv(): TokenData | null {
  // The store always wins: it holds the most recently rotated refresh token.
  // Falling back to the env-baked one after rotation causes invalid_grant.
  const stored = loadTokens();
  if (stored) return stored;

  const c = config();
  if (!c.seedAccessToken && !c.seedRefreshToken) return null;
  return {
    access_token: c.seedAccessToken,
    refresh_token: c.seedRefreshToken,
    expires_at: jwtExpiry(c.seedAccessToken),
  };
}

async function doRefresh(): Promise<TokenData> {
  const c = config();
  const current = agencyToken ?? seedFromEnv();
  if (!current?.refresh_token) throw new GhlError("No GoHighLevel refresh token available");

  const params = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: "refresh_token",
    refresh_token: current.refresh_token,
    user_type: "Company",
  });
  if (c.redirectUri) params.set("redirect_uri", c.redirectUri);

  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");

    // Another process (the MCP server, or a second app instance) already
    // rotated this exact token. Pick up its result instead of failing.
    if (detail.includes("invalid_grant")) {
      const stored = loadTokens();
      if (stored && stored.refresh_token !== current.refresh_token && !isExpired(stored)) {
        agencyToken = stored;
        return stored;
      }
    }

    throw new GhlError(
      `GoHighLevel refused the refresh token (${res.status}). Re-authorise the app.${
        detail ? ` ${detail.slice(0, 140)}` : ""
      }`,
      res.status
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
  };

  const next: TokenData = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: jwtExpiry(data.access_token) || Date.now() + (data.expires_in || 86_400) * 1000,
  };

  // Persist before the token is used for anything else. If the process dies
  // now, the stored value is the one GHL considers valid.
  saveTokens(next);
  agencyToken = next;
  return next;
}

export async function getAgencyToken(): Promise<string> {
  if (!agencyToken) agencyToken = seedFromEnv();
  if (!agencyToken) throw new GhlError("GoHighLevel is not configured");

  if (isExpired(agencyToken)) {
    const stored = loadTokens();
    if (stored && !isExpired(stored)) {
      agencyToken = stored;
    } else {
      // Share one refresh across callers so the rotating token can't race.
      if (!refreshInFlight) {
        refreshInFlight = doRefresh().finally(() => {
          refreshInFlight = null;
        });
      }
      agencyToken = await refreshInFlight;
    }
  }

  return agencyToken.access_token;
}

/* --------------------------------------------------------- location token */

const locationTokens = new Map<string, { access_token: string; expires_at: number }>();

export async function getLocationToken(locationId: string): Promise<string> {
  const hit = locationTokens.get(locationId);
  if (hit && hit.expires_at > Date.now()) return hit.access_token;

  const agency = await getAgencyToken();
  const res = await fetchWithRetry(`${BASE}/oauth/locationToken`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${agency}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Version: API_VERSION,
    },
    body: JSON.stringify({ companyId: ghlCompanyId(), locationId }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GhlError(
      `No location token for ${locationId} (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ""}`,
      res.status
    );
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  const entry = {
    access_token: data.access_token,
    expires_at: jwtExpiry(data.access_token) || Date.now() + (data.expires_in || 86_400) * 1000,
  };
  locationTokens.set(locationId, entry);
  return entry.access_token;
}

/* ---------------------------------------------------------------- request */

interface RequestOptions {
  locationId?: string;
  params?: Record<string, string | number | boolean>;
  agencyLevel?: boolean;
}

export async function ghlRequest<T = unknown>(
  method: string,
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { locationId, params, agencyLevel = false } = options;

  let token: string;
  if (agencyLevel) token = await getAgencyToken();
  else if (locationId) token = await getLocationToken(locationId);
  else throw new GhlError("Either locationId or agencyLevel must be provided");

  let url = `${BASE}${endpoint}`;
  if (params) {
    const query = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ).toString();
    if (query) url += `?${query}`;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    Version: API_VERSION,
  };
  if (locationId && !agencyLevel) headers["location_id"] = locationId;

  const send = (h: Record<string, string>) => fetchWithRetry(url, { method, headers: h });

  let res = await send(headers);

  // A stale location token gets one retry with a freshly minted one.
  if (res.status === 401 && !agencyLevel && locationId) {
    locationTokens.delete(locationId);
    headers.Authorization = `Bearer ${await getLocationToken(locationId)}`;
    res = await send(headers);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GhlError(
      `GoHighLevel API error (${res.status})${detail ? `: ${detail.slice(0, 160)}` : ""}`,
      res.status
    );
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/* ------------------------------------------------------------- endpoints */

export interface GhlLocation {
  id: string;
  name: string;
}

export async function listLocations(): Promise<GhlLocation[]> {
  const data = await ghlRequest<{ locations?: Array<{ id: string; name: string }> }>(
    "GET",
    "/locations/search",
    { agencyLevel: true, params: { companyId: ghlCompanyId(), limit: 500 } }
  );
  return (data.locations ?? []).map((l) => ({ id: l.id, name: l.name }));
}

export interface GhlWorkflow {
  id: string;
  name: string;
  /** "published" is the only status that actually fires. */
  status: string;
  locationId: string;
  updatedAt: string;
  createdAt: string;
}

export async function listWorkflows(locationId: string): Promise<GhlWorkflow[]> {
  const data = await ghlRequest<{ workflows?: unknown[] }>("GET", "/workflows/", {
    locationId,
    params: { locationId },
  });

  return (data.workflows ?? []).map((raw) => {
    const w = raw as Record<string, unknown>;
    return {
      id: String(w.id ?? ""),
      name: String(w.name ?? "Untitled workflow"),
      status: String(w.status ?? "unknown"),
      locationId: String(w.locationId ?? locationId),
      updatedAt: String(w.updatedAt ?? ""),
      createdAt: String(w.createdAt ?? ""),
    };
  });
}

/* ------------------------------------------------------------------ sweep */

export interface GhlWorkflowSweep {
  fetchedAt: string;
  locations: Array<{
    locationId: string;
    locationName: string;
    workflows: GhlWorkflow[];
    error?: string;
  }>;
}

let sweepCache: { at: number; data: GhlWorkflowSweep } | null = null;

async function pooled<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Pull workflows for every location on the agency.
 *
 * All of them, not just the ones mapped to a Campaign Desk client: the point
 * is to see what is switched on across the whole account, including
 * subaccounts nobody has claimed yet. A full sweep of ~150 locations takes
 * about 7 seconds at this concurrency, and the result is cached.
 *
 * A location that fails is recorded against that location rather than failing
 * the sweep: one un-authorised subaccount must not blank the whole panel.
 */
export async function sweepWorkflows(force = false): Promise<GhlWorkflowSweep> {
  if (!force && sweepCache && Date.now() - sweepCache.at < WORKFLOW_CACHE_TTL_MS) {
    return sweepCache.data;
  }

  const all = await listLocations();

  const locations = await pooled(all, async (loc) => {
    try {
      return {
        locationId: loc.id,
        locationName: loc.name,
        workflows: await listWorkflows(loc.id),
      };
    } catch (err) {
      return {
        locationId: loc.id,
        locationName: loc.name,
        workflows: [] as GhlWorkflow[],
        error: err instanceof Error ? err.message : "Failed to load workflows",
      };
    }
  });

  const data: GhlWorkflowSweep = { fetchedAt: new Date().toISOString(), locations };
  sweepCache = { at: Date.now(), data };
  return data;
}

export function clearGhlCache(): void {
  sweepCache = null;
  agencyToken = null;
  locationTokens.clear();
}
